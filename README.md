# Task ID: EventBridge

EventBridge is a webhook event dashboard built with a React (Vite) frontend, Node.js + Express backend, and Supabase (PostgreSQL) database.

## Project Structure

```
EventBridge/
├── client/              # React + Vite frontend
└── server/              # Express backend
    ├── auth.js          # Shared secret verification helper
    ├── index.js         # Entry point, route registration
    ├── mockDownstream.js# Pretend external service and failure mode toggle
    ├── pipeline.js      # Background delivery pipeline (fetch + status updates)
    ├── supabase.js      # Supabase client and connection test
    ├── webhook.js       # POST /api/webhook handler
    ├── .env.example     # Environment variable template (copy to .env and fill in)
    └── package.json
```

## Getting Started

### 1. Configure the backend

```bash
cd server
copy .env.example .env   # Windows
# cp .env.example .env   # Mac / Linux
```

Open `server/.env` and fill in your real values for `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WEBHOOK_SECRET`, and `DOWNSTREAM_URL`.

### 2. Run the backend

```bash
cd server
npm install
npm start
```

### 3. Run the frontend

```bash
cd client
npm install
npm run dev
```

| Method | Route | Description | Protected |
|--------|-------|-------------|-----------|
| GET | `/api/health` | Check that the server is running | No |
| POST | `/api/webhook` | Receive, store, and trigger event pipeline | Yes (`x-webhook-secret`) |
| POST | `/api/mock-downstream` | Mock destination service (200 OK or 503 error) | No |
| POST | `/api/mock-downstream/mode` | Toggle mock service health (`{"healthy": true\|false}`) | Yes (`x-webhook-secret`) |
| POST | `/api/login` | Sign in as admin, sets session cookie | No (password check) |
| POST | `/api/logout` | Sign out, clears session cookie | No |
| GET | `/api/me` | Check admin authentication status | No |
| GET | `/api/events` | List 100 recent events (public summary) | No |
| GET | `/api/events/:id` | Full event details (payload & failure reason) | Yes (Admin cookie) |
| GET | `/api/stream` | Server-Sent Events (SSE) live updates stream | No |
| POST | `/api/events/:id/retry` | Atomically claim and retry a failed event | Yes (Admin cookie) |

## How to Send a Webhook

Use `curl.exe` from PowerShell to send a test event to the running server.  
Replace `your-webhook-secret-here` with the value of `WEBHOOK_SECRET` in your `server/.env`.

> **Windows / PowerShell note:** Use **double quotes** around the `-d` body and **backslash-escape** the inner quotes (`\"`).  
> Single quotes look fine but PowerShell passes them literally to `curl.exe`, making the body invalid JSON.

```powershell
# ✅ Correct — works on Windows PowerShell
curl.exe -X POST http://localhost:3000/api/webhook `
  -H "Content-Type: application/json" `
  -H "x-webhook-secret: your-webhook-secret-here" `
  -d "{\"event\": \"order.created\", \"orderId\": \"abc-123\", \"amount\": 49.99}"
```

```bash
# ✅ Correct — works on Mac / Linux / Git Bash
curl -X POST http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your-webhook-secret-here" \
  -d '{"event": "order.created", "orderId": "abc-123", "amount": 49.99}'
```

**Expected response (new event):**
```json
{ "id": "uuid-here", "status": "Received", "duplicate": false }
```

**Expected response (duplicate — same body sent again with no idempotency-key header):**
```json
{ "id": "uuid-here", "status": "Received", "duplicate": true }
```

To use an explicit idempotency key instead of body-hashing, add `-H "idempotency-key: my-unique-key-123"`.

## Testing a failure

EventBridge includes a built-in mock downstream service and a switch to simulate downstream outages for testing and demos.

### 1. Turn downstream OFF (simulate an outage)

```powershell
# Windows PowerShell
curl.exe -X POST http://localhost:3000/api/mock-downstream/mode `
  -H "Content-Type: application/json" `
  -H "x-webhook-secret: your-webhook-secret-here" `
  -d "{\"healthy\": false}"
```

```bash
# Mac / Linux
curl -X POST http://localhost:3000/api/mock-downstream/mode \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your-webhook-secret-here" \
  -d '{"healthy": false}'
```

*Response:* `{"healthy": false}`

### 2. Send a new webhook while downstream is OFF

Send a new event with a unique payload or idempotency key.  
The webhook route immediately returns `201 Created` with status `"Received"`.  
In the background, the pipeline forwards the event to `DOWNSTREAM_URL`, receives a `503 Service Unavailable`, and updates the event row in Supabase:
* `status`: `"Failed"`
* `failure_reason`: `"Downstream returned status 503"`
* `attempt_count`: `1`

### 3. Turn downstream back ON (restore service)

```powershell
# Windows PowerShell
curl.exe -X POST http://localhost:3000/api/mock-downstream/mode `
  -H "Content-Type: application/json" `
  -H "x-webhook-secret: your-webhook-secret-here" `
  -d "{\"healthy\": true}"
```

```bash
# Mac / Linux
curl -X POST http://localhost:3000/api/mock-downstream/mode \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your-webhook-secret-here" \
  -d '{"healthy": true}'
```

*Response:* `{"healthy": true}`

Subsequent webhook events will now complete successfully with status `"Completed"`.
 
## Retrying a failed event

When an event downstream delivery fails, signed-in administrators can retry the event.

The retry endpoint uses an atomic database claim (`UPDATE events SET status = 'Received' WHERE id = :id AND status = 'Failed'`) so concurrent retry clicks cannot trigger duplicate pipeline deliveries.

### 1. Sign in as admin to save the session cookie

```powershell
# Windows PowerShell
curl.exe -c cookies.txt -X POST http://localhost:3000/api/login `
  -H "Content-Type: application/json" `
  -d "{\"password\": \"recruitingmewasyoursmartestdecision\"}"
```

```bash
# Mac / Linux
curl -c cookies.txt -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"password": "recruitingmewasyoursmartestdecision"}'
```

*Response:* `{"loggedIn": true}`

### 2. Request a retry for the failed event ID

```powershell
# Windows PowerShell
curl.exe -b cookies.txt -i -X POST http://localhost:3000/api/events/YOUR_EVENT_ID/retry
```

```bash
# Mac / Linux
curl -b cookies.txt -i -X POST http://localhost:3000/api/events/YOUR_EVENT_ID/retry
```

**Expected response (success):**
`HTTP/1.1 202 Accepted`
```json
{
  "id": "YOUR_EVENT_ID",
  "status": "Received"
}
```

**If already retrying or completed:**
`HTTP/1.1 409 Conflict`
```json
{
  "error": "Event is not in Failed state (already retrying or completed)"
}
```

**If the event does not exist:**
`HTTP/1.1 404 Not Found`
```json
{
  "error": "Not Found",
  "message": "Event not found."
}
```
