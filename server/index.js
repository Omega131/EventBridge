// WHAT: Load environment variables from the server/.env file using dotenv.
// WHY: We want to configure server settings (like PORT and Supabase secrets)
// without hardcoding sensitive or environment-specific values in our code.
const dotenv = require('dotenv');
dotenv.config();

// WHAT: Import the Express library.
// WHY: Express is a minimal Node.js framework that makes it easy to handle HTTP requests
// and build REST APIs for our web application.
const express = require('express');

// WHAT: Import the Supabase connection test function from our supabase.js file.
// WHY: We want to test our database connection right when the backend server launches.
const { testSupabaseConnection } = require('./supabase');

// WHAT: Import the webhook route handler from webhook.js.
// WHY: Keeping the webhook logic in its own file makes index.js easy to read.
//      index.js only wires things together; webhook.js holds the actual logic.
const { handleWebhook } = require('./webhook');

// WHAT: Import the mock downstream handlers from mockDownstream.js.
// WHY: Provides an endpoint to simulate an external receiver, and a mode toggle to simulate outages.
const {
  handleMockDownstream,
  handleMockDownstreamMode
} = require('./mockDownstream');


// ─── STARTUP GUARD: WEBHOOK_SECRET ────────────────────────────────────────

// WHAT: Check that WEBHOOK_SECRET is set BEFORE starting the server.
// WHY:  If this variable is missing, the webhook endpoint cannot verify incoming
//       requests and would accept events from anyone. That is a security hole.
//       It is far safer to refuse to start than to run in an insecure state.
if (!process.env.WEBHOOK_SECRET) {
  console.error('====================================================');
  console.error('ERROR: WEBHOOK_SECRET is not set in server/.env.');
  console.error('The server cannot start without a webhook secret.');
  console.error('Add WEBHOOK_SECRET to your server/.env file and restart.');
  console.error('====================================================');
  process.exit(1); // WHAT: Exit the Node process with an error code.
                   // WHY:  Stops the server immediately so the problem is impossible to miss.
}


// ─── EXPRESS APP SETUP ────────────────────────────────────────────────────

// WHAT: Create an instance of an Express application.
// WHY: The "app" object is where we register our API routes and middleware.
const app = express();

// ─── ROUTES ───────────────────────────────────────────────────────────────

// IMPORTANT: The webhook route is registered FIRST — before app.use(express.json()).
// WHY: Express runs middleware in the order you register it. If express.json() ran
//      first, it would read and consume the raw bytes from the request body stream,
//      leaving nothing for express.raw() to work with. By placing the webhook route
//      above the global JSON middleware, express.raw() gets to buffer the body bytes
//      as a raw Buffer, which is exactly what we need in webhook.js.

// WHAT: Register POST /api/webhook with express.raw() middleware on this route only.
// WHY:  express.raw({ type: '*/*' }) stores the full request body as a Buffer object
//       (raw bytes). We convert it to a string ourselves in webhook.js so we can:
//         1. Hash the exact bytes for the idempotency key fallback.
//         2. JSON.parse it with our own error handling.
//       { type: '*/*' } means we accept any Content-Type, which matters because
//       different webhook providers send different content type headers.
app.post(
  '/api/webhook',
  express.raw({ type: '*/*' }), // WHAT: Buffer the body as raw bytes for this route only.
  handleWebhook                 // WHAT: Hand off to our handler in webhook.js.
);

// WHAT: Add built-in JSON middleware for all other routes.
// WHY: Future routes (like GET /api/events) will send and receive normal JSON.
//      This only applies to routes registered AFTER this line.
app.use(express.json());

// WHAT: Define a GET route at "/api/health".
// WHY: A health check endpoint verifies the server is alive without touching the database.
app.get('/api/health', (req, res) => {
  console.log('Received GET request on /api/health');
  res.json({ status: 'ok' });
});

// WHAT: Register mock downstream service endpoints.
// WHY: Simulates an external API that our pipeline forwards events to.
// POST /api/mock-downstream receives forwarded events (replies 200 or 503 based on health mode).
// POST /api/mock-downstream/mode allows toggling between healthy (true) and unhealthy (false).
app.post('/api/mock-downstream', handleMockDownstream);
app.post('/api/mock-downstream/mode', handleMockDownstreamMode);


// ─── START THE SERVER ─────────────────────────────────────────────────────

// WHAT: Determine which port the server should listen on.
// WHY: In production or local environments, PORT can be set via environment variables.
//      If no PORT is set, we fallback to port 3000 as the default.
const PORT = process.env.PORT || 3000;

// WHAT: Start the Express server and begin listening for incoming network requests.
// WHY: This keeps our Node process running in the background waiting for HTTP traffic.
app.listen(PORT, () => {
  console.log('====================================================');
  console.log('EventBridge Express server is running on port ' + PORT);
  console.log('Health check:    http://localhost:' + PORT + '/api/health');
  console.log('Webhook route:   http://localhost:' + PORT + '/api/webhook');
  console.log('Mock downstream: http://localhost:' + PORT + '/api/mock-downstream');
  console.log('Mock mode route: http://localhost:' + PORT + '/api/mock-downstream/mode');
  console.log('====================================================');

  // WHAT: Test the Supabase connection once when the server starts.
  // WHY: Immediately tells the developer whether the database configuration is working.
  testSupabaseConnection();
});
