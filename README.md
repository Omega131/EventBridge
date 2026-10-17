<h1 align="center">EventBridge</h1>

<h2 align="center"><strong>Reliable webhook ingestion, delivery, and real-time observability platform.</strong><br>Task ID: EventBridge</h2>

<details>
<summary style="font-size: 20px; font-weight: bold; cursor: pointer;">Table of Contents</summary>

- [Architecture Diagram](#architecture-diagram)
- [Live Demo & Video](#live-demo--video)
- [Credentials for Reviewer and Evaluation](#credentials-for-reviewer-and-evaluation)
- [The Problem](#the-problem)
- [Our Solution](#our-solution)
- [How a Reviewer Can Test It](#how-a-reviewer-can-test-it)
- [Architecture & Event Lifecycle](#architecture--event-lifecycle)
- [Tech Stack and Rationale](#tech-stack-and-rationale)
- [Design Decisions](#design-decisions)
- [Database Schema (What Gets Stored on the Server)](#database-schema-what-gets-stored-on-the-server)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Local Setup Guide](#local-setup-guide)
- [Deployment](#deployment)
- [Known Limitations](#known-limitations)
- [Branches](#branches)
- [Credits and References](#credits-and-references)
- [What I Learned](#what-i-learned)
- [License](#license)

</details>

---

# Architecture Diagram

```mermaid
flowchart TD
    Sender[External Webhook Sender] -->|POST /api/webhook + x-webhook-secret| WebhookRoute[Express /api/webhook]
    WebhookRoute -->|Verify Secret & Resolve Idempotency Key| SupabaseDB[(Supabase PostgreSQL: events table)]
    WebhookRoute -->|201 Created / 200 Duplicate| Sender
    WebhookRoute -->|Async trigger eventId| Pipeline[Background Delivery Pipeline]
    Pipeline -->|HTTP POST 5s Timeout| Downstream[Downstream Receiver / Mock Downstream]
    Downstream -->|HTTP 2xx or Failure| Pipeline
    Pipeline -->|Update status, attempt_count, failure_reason| SupabaseDB
    Pipeline -->|publishEvent row| SSEEmitter[SSE Broadcaster]
    WebhookRoute -->|publishEvent Received| SSEEmitter
    SSEEmitter -->|text/event-stream event-update| Browsers[Browser Clients / EventSource]
    Browsers -->|POST /api/events/:id/retry Admin| RetryRoute[Express /api/events/:id/retry]
    RetryRoute -->|Atomic UPDATE status=Received WHERE status=Failed| SupabaseDB
    RetryRoute -->|Async runPipeline| Pipeline
    Sweeper[Background Stale Sweeper] -->|Sweep Received > 60s to Failed| SupabaseDB
    Sweeper -->|publishEvent Failed| SSEEmitter
```

---

## Live Demo & Video

- **Production URL**: <LIVE_URL>
- **Demonstration Video**: <VIDEO_URL>

Note: On the free cloud hosting tier (Render), the application container automatically spins down after 15 minutes of inactivity. The initial HTTP request after an idle window may take approximately 50 to 60 seconds while the container initializes.

---

## Credentials for Reviewer and Evaluation

The following credentials are configured for evaluation and grading:

- **Administrator Password**: `recruitingmewasyoursmartestdecision`
- **Deployed Production Webhook Secret**: `a3aa976dcbfb608f8a3e0d182cc40967548434e40a8f4c2c51b0f411ecaac7c2`

These credentials are also shared through the project submission form.

---

## The Problem

Modern distributed applications rely heavily on webhooks for asynchronous integration across payment processors, version control, and SaaS platforms. Traditional naive webhook receivers face recurring operational failures:

- **Missing Idempotency**: Network retries from upstream webhook providers cause identical payloads to execute multiple times, creating duplicate invoices, duplicate orders, or corrupted account states.
- **Vulnerability to Timing Attacks**: Naive string comparisons on incoming authentication tokens expose secret lengths and character prefixes through execution time differences.
- **Blocking Ingestion**: Calling downstream destination APIs synchronously during webhook receipt causes timeouts on the sender side and degrades throughput.
- **Silent Abandonment on Crashes**: Background promises running in Node memory are terminated when servers reboot or restart, leaving in-flight events stuck in intermediate states indefinitely.
- **Race Conditions on Manual Retries**: When multiple administrators or automated scripts trigger retries simultaneously, naive select-then-update logic allows duplicate delivery runs to execute in parallel.
- **Payload Data Leakage**: Exposing raw webhook bodies over public telemetry streams leaks customer PII and authorization tokens to unauthorized observers.

---

## Our Solution

EventBridge resolves these challenges through a hardened ingestion and telemetry architecture:

1. **Fast, Authenticated Ingestion with Idempotency**  
   Buffers incoming raw request bytes before JSON parsing, executes constant-time secret verification via `crypto.timingSafeEqual`, resolves a unique idempotency key (header or SHA-256 body hash), and performs an insert-then-catch operation against a PostgreSQL unique constraint. New events receive `201 Created`; duplicate deliveries receive `200 OK` and skip downstream dispatch.

2. **Decoupled Asynchronous Delivery Pipeline**  
   The HTTP ingestion endpoint returns immediately upon database persistence. A background delivery worker (`pipeline.js`) loads the stored payload, forwards it to the downstream endpoint with a strict 5-second `AbortSignal` timeout, records delivery attempts, and updates the database record to `Completed` or `Failed` without throwing unhandled exceptions.

3. **Atomic Conditional Retry Engine with Double-Click Protection**  
   Administrative retries execute a single conditional SQL statement (`UPDATE events SET status = 'Received' WHERE id = :id AND status = 'Failed'`). PostgreSQL row locks guarantee that only one concurrent caller claims the event. In the frontend, synchronous ref locks (`isRetryingRef`) prevent rapid double-clicks, and locks reset cleanly upon completion so failed events can be retried immediately.

4. **Real-Time Telemetry via Server-Sent Events (SSE)**  
   The backend exposes `GET /api/stream` using the Server-Sent Events standard (`text/event-stream`). Active browser connections receive real-time monotonic state updates as events are received, completed, failed, or retried, maintained with 25-second heartbeat comment pings.

5. **Stale In-Flight Sweeper**  
   A background process (`sweeper.js`) inspects the database every 30 seconds for events left in `Received` state for longer than 60 seconds (abandoned by process restarts). Swept events are transitioned to `Failed` with diagnostic error messaging rather than being automatically re-delivered, preventing duplicate side effects and allowing administrator inspection.

6. **Privacy-Preserving Public Visibility with Role-Protected Payloads**  
   Public visitors can monitor event throughput, status badges, timestamps, and attempt counts. Raw payload contents and downstream error diagnostics are strictly excluded from public APIs and SSE streams, accessible only through authenticated endpoints protected by `httpOnly`, version-validated JWT cookies.

---

## How a Reviewer Can Test It

Follow these numbered steps using curl to test the entire operational flow.

Replace `<LIVE_URL>` with your deployed domain (or `http://localhost:3000` for local runs):

```bash
export BASE_URL="<LIVE_URL>"
export SECRET="a3aa976dcbfb608f8a3e0d182cc40967548434e40a8f4c2c51b0f411ecaac7c2"
```

### 1. Ingest a Valid Webhook

Dispatch a valid webhook payload with the shared secret header:

```bash
curl -i -X POST "$BASE_URL/api/webhook" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $SECRET" \
  -d '{"event": "order.created", "orderId": "ord_1001", "amount": 89.50}'
```

Expected response: `HTTP/1.1 201 Created`
```json
{
  "id": "<UUID>",
  "status": "Received",
  "duplicate": false
}
```

### 2. Send the Same Webhook Again (Deduplication Check)

Send the exact same payload a second time without an explicit idempotency key:

```bash
curl -i -X POST "$BASE_URL/api/webhook" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $SECRET" \
  -d '{"event": "order.created", "orderId": "ord_1001", "amount": 89.50}'
```

Expected response: `HTTP/1.1 200 OK`
```json
{
  "id": "<SAME_UUID>",
  "status": "Completed",
  "duplicate": true
}
```

PostgreSQL detects the duplicate hash, updates the record timestamp, and skips downstream delivery.

### 3. Send Request with an Invalid Secret (401 Check)

```bash
curl -i -X POST "$BASE_URL/api/webhook" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: invalid_secret_token" \
  -d '{"event": "test"}'
```

Expected response: `HTTP/1.1 401 Unauthorized`
```json
{
  "error": "Unauthorized"
}
```

### 4. Watch the Dashboard

Open `$BASE_URL` in a browser. Events appear in real time via Server-Sent Events without manual page refreshes.

### 5. Sign In as Administrator

Authenticate to obtain an `httpOnly` admin session cookie:

```bash
curl -i -c cookies.txt -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"password": "recruitingmewasyoursmartestdecision"}'
```

Expected response: `HTTP/1.1 200 OK`
```json
{
  "loggedIn": true,
  "webhookSecret": "<SECRET>"
}
```

### 6. Turn Mock Downstream Off (Simulate Outage)

Toggle the downstream receiver to outage mode:

```bash
curl -i -b cookies.txt -X POST "$BASE_URL/api/mock/mode" \
  -H "Content-Type: application/json" \
  -d '{"healthy": false}'
```

Expected response: `HTTP/1.1 200 OK`
```json
{
  "healthy": false
}
```

### 7. Create a Failed Event

Dispatch a unique event while downstream is offline:

```bash
curl -i -X POST "$BASE_URL/api/webhook" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $SECRET" \
  -d '{"event": "payment.failed_test", "timestamp": "'$(date +%s)'"}'
```

Ingestion responds with `201 Created`. The delivery pipeline receives `503 Service Unavailable`, transitions status to `Failed`, and records the failure reason.

### 8. Press Retry to Recover the Event

In the browser drawer (or via curl), turn the mock downstream back on:

```bash
curl -i -b cookies.txt -X POST "$BASE_URL/api/mock/mode" \
  -H "Content-Type: application/json" \
  -d '{"healthy": true}'
```

Trigger an immediate retry on the failed event ID:

```bash
curl -i -b cookies.txt -X POST "$BASE_URL/api/events/<EVENT_UUID>/retry"
```

Expected response: `HTTP/1.1 202 Accepted`
```json
{
  "id": "<EVENT_UUID>",
  "status": "Received"
}
```

The pipeline re-delivers the payload, succeeds with `200 OK`, transitions status to `Completed`, and clears the failure message.

---

## Architecture & Event Lifecycle

1. **Received**: The incoming webhook passes timing-safe secret verification and body parsing. It is stored in Supabase with `status: 'Received'` and `attempt_count: 0`. The server publishes the `Received` state over SSE and replies with `201 Created`.
2. **Completed or Failed**: The background pipeline forwards the stored payload to `DOWNSTREAM_URL` with a 5-second timeout. If downstream responds with HTTP 2xx, status transitions to `Completed`. If it returns non-2xx, times out, or encounters network errors, status transitions to `Failed` with an incremented `attempt_count` and recorded `failure_reason`. The updated row is broadcast over SSE.
3. **Manual Retry**: An authenticated administrator inspects a `Failed` event and clicks "Retry Webhook Delivery". The server conditionally updates the row to `Received`, broadcasts the change via SSE, and re-launches the delivery pipeline. If downstream fails again, the event returns to `Failed` and the retry button remains immediately enabled.

---

## Tech Stack and Rationale

| Technology | Role | Rationale |
|---|---|---|
| React 19 + Vite | Frontend Dashboard | Fast local builds, minimal bundle overhead, responsive state synchronization, and component modularity. |
| Node.js + Express | Backend Application Server | Middleware ordering flexibility allowing raw body buffering before JSON parsing, native async/await, and single-port SPA serving. |
| Supabase (PostgreSQL) | Database & Storage | ACID transactions, native UUID keys, strict unique constraints for deduplication, and atomic conditional update semantics. |
| Server-Sent Events (SSE) | Real-Time Broadcast | Unidirectional server-to-client streaming using standard HTTP (`text/event-stream`), built-in browser reconnection, and zero WebSocket upgrade complexity. |

---

## Design Decisions

- **Insert-Then-Catch for Idempotency**: Rather than running a read query before write (which leaves a concurrency race condition window), the webhook route runs a direct `INSERT`. PostgreSQL enforces a `UNIQUE` constraint on `idempotency_key`. Collisions raise database error `23505`, which is caught to update the timestamp and return `200 OK` with `duplicate: true`, eliminating race conditions.
- **Atomic Conditional UPDATE for Retry**: To prevent concurrent duplicate retries, the server runs `UPDATE events SET status = 'Received', updated_at = now() WHERE id = :id AND status = 'Failed' RETURNING *`. PostgreSQL row locks ensure only one caller can match the condition and win the claim; concurrent callers receive zero rows and an immediate `409 Conflict`.
- **Timing-Safe Secret Comparison**: Plain string equality (`===`) exits early on the first mismatched character. We hash both strings with SHA-256 into 32-byte buffers and compare with `crypto.timingSafeEqual`, guaranteeing constant execution time and eliminating timing side-channel attacks.
- **httpOnly Cookie with Versioned JWT**: Admin authentication issues an `httpOnly`, `sameSite: 'strict'`, `secure` cookie named `eventbridge_token`. To enable instantaneous global token revocation without a database blocklist, tokens embed a numeric `auth_version`. The server increments `auth_version` in Supabase during "Sign Out Everywhere", immediately invalidating older tokens across all devices.
- **Payload Privacy on Public APIs**: Public endpoints (`GET /api/events`) and public SSE streams omit raw payloads and internal failure traces to protect customer PII and API keys. Full payloads are accessible only through `GET /api/events/:id` guarded by admin session verification.
- **Server-Sent Events over WebSockets**: The dashboard requires only one-way server-to-browser notifications. SSE operates over regular HTTP, requires no custom gateway, and includes native browser reconnection.

---

## Database Schema (What Gets Stored on the Server)

The database consists of two tables created in Supabase PostgreSQL:

### 1. `events` Table

Persists incoming webhook deliveries, idempotency signatures, and execution statuses:

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY | Unique event identifier (`gen_random_uuid()`) |
| `idempotency_key` | TEXT | UNIQUE, NOT NULL | Deduplication key (header or SHA-256 body hash) |
| `payload` | JSONB | NOT NULL | Raw ingested webhook payload |
| `status` | TEXT | NOT NULL | Current state (`'Received'`, `'Completed'`, `'Failed'`) |
| `attempt_count` | INTEGER | NOT NULL | Number of delivery attempts (defaults to `0`) |
| `failure_reason` | TEXT | NULLABLE | Downstream error trace or timeout message |
| `created_at` | TIMESTAMPTZ | NOT NULL | Initial ingestion timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL | Timestamp of last state change |

```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT UNIQUE NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'Received',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_created_at ON events (created_at DESC);
CREATE INDEX idx_events_status_updated ON events (status, updated_at);
```

### 2. `settings` Table

Maintains runtime configurations across server restarts and process instances:

| Column | Type | Constraints | Description |
|---|---|---|---|
| `key` | TEXT | PRIMARY KEY | Configuration key name |
| `value` | TEXT | NOT NULL | String-serialized configuration value |
| `updated_at` | TIMESTAMPTZ | NOT NULL | Last update timestamp |

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
  ('mock_healthy', 'true'),
  ('auth_version', '1');
```

---

## API Reference

| Method | Path | Auth Required | Purpose | Status Codes |
|---|---|---|---|---|
| GET | `/api/health` | None | Basic server liveness check (does not touch database) | 200 |
| GET | `/api/keepalive` | None | Lightweight database uptime ping (`SELECT id FROM events LIMIT 1`) | 200, 500 |
| POST | `/api/webhook` | `x-webhook-secret` header | Ingest incoming webhook with secret and idempotency validation | 201, 200, 400, 401, 500 |
| POST | `/api/mock-downstream` | None | Simulated destination endpoint (200 OK or 503 Outage) | 200, 503 |
| POST | `/api/mock-downstream/mode` | `x-webhook-secret` header | Secret-protected switch to toggle mock downstream health | 200, 400, 401, 500 |
| GET | `/api/mock/status` | None | Read current mock downstream health mode from database | 200, 500 |
| POST | `/api/mock/mode` | Admin Session Cookie | Toggle mock downstream health mode from admin UI | 200, 400, 401, 500 |
| POST | `/api/login` | Password body | Verify password, enforce IP rate limit, issue session cookie | 200, 400, 401, 429, 500 |
| POST | `/api/logout` | None | Clear `eventbridge_token` session cookie | 200 |
| GET | `/api/me` | None (inspects cookie) | Check whether current session has active admin authorization | 200, 500 |
| GET | `/api/events` | None | List 100 recent events (summary columns only, no payloads) | 200, 500 |
| GET | `/api/events/:id` | Admin Session Cookie | Retrieve full event record including payload and failure reason | 200, 400, 401, 404, 500 |
| POST | `/api/events/:id/retry` | Admin Session Cookie | Atomically claim and re-deliver a failed event | 202, 400, 401, 404, 409, 500 |
| POST | `/api/admin/clear-events` | Admin Session Cookie | Purge all events from database (`{"confirm": "DELETE ALL"}`) | 200, 400, 401, 500 |
| POST | `/api/admin/sign-out-everywhere` | Admin Session Cookie | Increment database `auth_version` to revoke all active tokens | 200, 401, 500 |
| GET | `/api/stream` | None | Server-Sent Events stream delivering live dashboard updates | 200 |

---

## Project Structure

```
EventBridge/
├── client/              # React + Vite frontend
│   ├── src/             # Dashboard components, telemetry, and sound engine
│   └── package.json
├── server/              # Express backend
│   ├── auth.js          # Shared secret verification and JWT auth helpers
│   ├── index.js         # Server entrypoint and route mounting
│   ├── mockDownstream.js# Mock receiver and outage simulation toggle
│   ├── pipeline.js      # Background delivery pipeline
│   ├── routes.js        # API routes (events, retry, auth, keepalive)
│   ├── settings.js      # Persistent key-value configuration in Supabase
│   ├── sse.js           # Server-Sent Events broadcaster and heartbeats
│   ├── supabase.js      # Supabase client and connection test
│   ├── sweeper.js       # Background stale event recovery sweeper
│   ├── webhook.js       # Webhook ingestion handler and idempotency logic
│   ├── .env.example     # Environment variable configuration template
│   └── package.json
├── .env.example         # Root environment variable template
├── package.json         # Unified build and start scripts for Render
└── README.md
```

---

## Local Setup Guide

### 1. Prerequisites

- Node.js (v18.0.0 or higher, tested with Node v20/v26)
- npm (v9.0.0 or higher)
- A Supabase project (or PostgreSQL instance with the schema above)

### 2. Clone the Repository

```bash
git clone <REPO_URL>
cd EventBridge
```

### 3. Configure Environment Variables

Copy the environment template in the `server` directory:

```bash
# Windows
copy server\.env.example server\.env

# Mac / Linux
cp server/.env.example server/.env
```

Configure the variable names in `server/.env`:

| Variable | Purpose |
|---|---|
| `PORT` | Local server listening port (default: `3000`). |
| `NODE_ENV` | Environment mode (`development` or `production`). |
| `SUPABASE_URL` | Base URL of your Supabase project (e.g. `https://xyz.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret service role key with administrative database access. |
| `WEBHOOK_SECRET` | Secret token string required to authorize `POST /api/webhook`. |
| `ADMIN_PASSWORD` | Password required to log in to the administrator dashboard. |
| `SESSION_SECRET` | Secret key used to sign and verify JWT session cookies. |
| `DOWNSTREAM_URL` | Target endpoint for webhook forwarding (optional, defaults to local mock). |
| `DOWNSTREAM_DELAY_MS` | Artificial response delay in milliseconds for testing (default: `0`). |

### 4. Install Dependencies

Install dependencies across both client and server:

```bash
npm install --prefix client
npm install --prefix server
```

### 5. Run in Development Mode (Dual Process)

Run the backend Express server:

```bash
cd server
npm run dev
```

In a separate terminal, run the Vite development server:

```bash
cd client
npm run dev
```

Open `http://localhost:5173` in your browser.

### 6. Run Single-Port Unified Production Service

To test the unified production build locally:

```bash
npm run build
npm start
```

Open `http://localhost:3000` in your browser.

---

## Deployment

EventBridge is configured for deployment as a single unified service on Render backed by Supabase.

### Build and Start Settings

- **Environment**: Node
- **Build Command**: `npm run build`  
  *(Installs client dependencies, compiles the Vite production bundle into `client/dist`, and installs server dependencies).*
- **Start Command**: `npm start`  
  *(Executes `node server/index.js`, serving the API and static frontend from host `0.0.0.0` on port `$PORT`).*

### Render Environment Variables

Configure the following environment variable names in the Render Dashboard under **Environment**:

- `NODE_ENV`: Set to `production`
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role secret key
- `WEBHOOK_SECRET`: Production webhook authorization secret
- `ADMIN_PASSWORD`: Administrator dashboard password
- `SESSION_SECRET`: Long random cryptographic string for JWT cookies
- `DOWNSTREAM_URL`: (Optional) Downstream destination. Defaults to `http://127.0.0.1:$PORT/api/mock-downstream`

### Uptime Keepalive Monitor

To prevent the Render free tier from idling after 15 minutes and to keep the Supabase connection warm, configure an external uptime monitor (such as UptimeRobot or cron-job.org) with:

- Target URL: `https://<YOUR_APP_NAME>.onrender.com/api/keepalive`
- Method: `GET`
- Interval: Every 5 to 10 minutes

---

## Known Limitations

- **In-Memory Background Pipeline & Stale Sweeper**: Webhook delivery runs asynchronously in the memory space of the active Node process. If the server crashes or restarts during delivery, the in-memory promise is lost, leaving the database row in the `Received` state. A background sweeper (`sweeper.js`) runs every 30 seconds and transitions any event stuck in `Received` for longer than 60 seconds to `Failed`, allowing an administrator to inspect and retry it. A distributed production architecture would replace in-memory execution with a persistent queue (such as Redis/BullMQ or AWS SQS).
- **In-Memory SSE Client Registry**: Active browser connections are tracked in an in-memory array (`clients[]`) on a single server process. In a multi-instance autoscaled environment, events ingested on instance A would not broadcast to browsers connected to instance B. Scaling horizontally requires an external pub/sub message broker (such as Redis Pub/Sub, PostgreSQL LISTEN/NOTIFY, or Supabase Realtime).
- **Single Shared Administrator Password**: Authentication relies on a single shared secret configured in `ADMIN_PASSWORD`. There are no multi-user profiles, individual account provisions, or granular role-based permissions.
- **Free-Tier Cold Starts**: On free hosting plans, instances spin down after inactivity, causing initial cold-start latency of up to 60 seconds on incoming requests.

---

## Branches

| Branch | Status | Contents |
|---|---|---|
| `main` | Deployed | Active production branch containing the full Express backend, React client, unified Render single-service deployment, keepalive monitor, and retry re-usability bugfix. |
| `UI-testing` | Not merged / Not deployed | Experimental feature branch containing UI redesign prototypes, Web Audio sound synthesis, and Webhook Studio presets. Stable changes were incorporated into main. |

---

## Credits and References

| Resource | URL | Purpose |
|---|---|---|
| MDN Webhooks Glossary | https://developer.mozilla.org/en-US/docs/Glossary/Webhook | Architectural reference for webhook receiving and verification patterns. |
| MDN Server-Sent Events | https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events | Standard specification for `EventSource` and `text/event-stream` protocols. |
| Express Documentation | https://expressjs.com/ | Node.js routing, raw body buffering, and static file serving. |
| Supabase JavaScript Client | https://supabase.com/docs/reference/javascript | PostgreSQL data queries, error handling, and connection initialization. |
| Supabase Realtime & Architecture | https://supabase.com/docs/guides/realtime | Relational design and PostgreSQL database connection management. |
| Render Documentation | https://render.com/docs | Single-service web deployment configuration and build scripts. |
| jsonwebtoken | https://github.com/auth0/node-jsonwebtoken | Signing, verifying, and decoding JWT session cookies. |
| canvas-confetti | https://github.com/catdad/canvas-confetti | Lightweight micro-animations for user action feedback. |
| Lucide React | https://lucide.dev/ | Dashboard iconography and telemetry status indicators. |
| Tailwind CSS | https://tailwindcss.com/ | Modern utility classes for responsive dashboard layout. |
| Vite | https://vite.dev/ | Frontend compilation, bundling, and local development server. |
| Additional References | <ADD ANY TUTORIAL OR REPO I USED> | Placeholder for external tutorials or reference repositories consulted. |

---

## What I Learned

- **Idempotency**: <WRITE WHAT YOU LEARNED ABOUT IDEMPOTENCY AND INSERT-THEN-CATCH CONCURRENCY>
- **Server-Sent Events**: <WRITE WHAT YOU LEARNED ABOUT SSE VS WEBSOCKETS FOR UNIDIRECTIONAL TELEMETRY>
- **Concurrency & Atomicity**: <WRITE WHAT YOU LEARNED ABOUT ATOMIC CONDITIONAL SQL UPDATES FOR CLAIMING RETRIES>
- **Unified Deployment**: <WRITE WHAT YOU LEARNED ABOUT SERVING SINGLE-PAGE APPS AND APIS FROM ONE EXPRESS SERVICE>

---

## License

MIT. See [LICENSE](LICENSE).
