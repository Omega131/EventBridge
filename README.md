# Task ID: EventBridge

EventBridge is a webhook event dashboard built with a React (Vite) frontend, Node.js + Express backend, and Supabase (PostgreSQL) database.

## Project Structure

```
EventBridge/
├── client/          # React + Vite frontend
└── server/          # Express backend
    ├── index.js     # Entry point, route registration
    ├── supabase.js  # Supabase client and connection test
    ├── webhook.js   # POST /api/webhook handler
    ├── .env.example # Environment variable template (copy to .env and fill in)
    └── package.json
```

## Getting Started

### 1. Configure the backend

```bash
cd server
copy .env.example .env   # Windows
# cp .env.example .env   # Mac / Linux
```

Open `server/.env` and fill in your real values for `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `WEBHOOK_SECRET`.

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

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/health` | Check that the server is running |
| POST | `/api/webhook` | Receive and store a webhook event |

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
