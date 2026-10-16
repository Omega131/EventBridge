// WHAT: Load environment variables from the server/.env file using dotenv.
// WHY: We want to configure server settings (like PORT, secrets, and database credentials)
// without hardcoding sensitive values in our source code.
const dotenv = require('dotenv');
dotenv.config();

// WHAT: Import the Express library.
// WHY: Express is a minimal Node.js framework that makes it easy to handle HTTP requests
// and build REST APIs for our web application.
const express = require('express');

// WHAT: Import cookie-parser middleware.
// WHY: Parses the "Cookie" header sent by browsers and populates req.cookies,
// which our authentication system needs to read the "eventbridge_token" session cookie.
const cookieParser = require('cookie-parser');

// WHAT: Import the Supabase connection test function from our supabase.js file.
// WHY: We want to test our database connection right when the backend server launches.
const { testSupabaseConnection } = require('./supabase');

// WHAT: Import the webhook route handler from webhook.js.
// WHY: Keeps the webhook listening and idempotency logic isolated.
const { handleWebhook } = require('./webhook');

// WHAT: Import the mock downstream handlers from mockDownstream.js.
// WHY: Provides an endpoint to simulate an external receiver, and a mode toggle to simulate outages.
const {
  handleMockDownstream,
  handleMockDownstreamMode
} = require('./mockDownstream');

// WHAT: Import our new API routes (login, logout, me, public events, admin event details).
// WHY: Keeping route handlers in routes.js keeps index.js clean and focused on server configuration.
const apiRoutes = require('./routes');

// WHAT: Import startSweeper from sweeper.js.
// WHY: Background sweeper that periodically detects and fails abandoned in-flight events.
const { startSweeper } = require('./sweeper');


// ─── STARTUP GUARDS: REQUIRED SECRETS ─────────────────────────────────────

// WHAT: Check that WEBHOOK_SECRET is set BEFORE starting the server.
// WHY:  Without a webhook secret, incoming webhook requests cannot be verified.
if (!process.env.WEBHOOK_SECRET) {
  console.error('====================================================');
  console.error('ERROR: WEBHOOK_SECRET is not set in server/.env.');
  console.error('The server cannot start without a webhook secret.');
  console.error('Add WEBHOOK_SECRET to your server/.env file and restart.');
  console.error('====================================================');
  process.exit(1);
}

// WHAT: Check that ADMIN_PASSWORD is set BEFORE starting the server.
// WHY:  Without an admin password, the login system cannot authenticate the dashboard user.
if (!process.env.ADMIN_PASSWORD) {
  console.error('====================================================');
  console.error('ERROR: ADMIN_PASSWORD is not set in server/.env.');
  console.error('The server cannot start without an admin password.');
  console.error('Add ADMIN_PASSWORD to your server/.env file and restart.');
  console.error('====================================================');
  process.exit(1);
}

// WHAT: Check that SESSION_SECRET is set BEFORE starting the server.
// WHY:  Without a session secret, JWT tokens cannot be signed or verified securely.
if (!process.env.SESSION_SECRET) {
  console.error('====================================================');
  console.error('ERROR: SESSION_SECRET is not set in server/.env.');
  console.error('The server cannot start without a session secret.');
  console.error('Add SESSION_SECRET to your server/.env file and restart.');
  console.error('====================================================');
  process.exit(1);
}


// ─── EXPRESS APP SETUP & MIDDLEWARE ORDERING ──────────────────────────────

// WHAT: Create an instance of an Express application.
const app = express();

// WHAT: Configure Express to trust the reverse proxy (Render, Heroku, Cloudflare, etc.).
// WHY: Behind Render's reverse proxy, req.ip would otherwise be the proxy server's internal address,
// causing every user on the internet to share the same rate-limiting counter. Setting "trust proxy"
// to 1 tells Express to trust the first hop and read the client's true IP from the X-Forwarded-For header.
app.set('trust proxy', 1);

// WHAT: Enable cookie parsing across all routes.
// WHY: Cookie parsing only reads the "Cookie" HTTP header string into req.cookies.
// It does NOT consume the incoming request body stream, so placing it here is completely safe.
app.use(cookieParser());


// ─── ROUTES & BODY PARSERS ────────────────────────────────────────────────

// IMPORTANT: The webhook route is registered FIRST — before app.use(express.json()).
// WHY: Express runs middleware in the order you register it. If express.json() ran
//      first, it would read and consume the raw bytes from the request body stream,
//      leaving nothing for express.raw() to work with. By placing the webhook route
//      above the global JSON middleware, express.raw() gets to buffer the body bytes
//      as a raw Buffer, which is exactly what we need in webhook.js for SHA-256 hashing.
app.post(
  '/api/webhook',
  express.raw({ type: '*/*' }), // WHAT: Buffer the body as raw bytes for this route only.
  handleWebhook                 // WHAT: Hand off to our handler in webhook.js.
);

// WHAT: Add built-in JSON middleware for all other routes.
// WHY: All subsequent routes (login, mock downstream, events) receive standard JSON payloads.
// This only applies to routes registered AFTER this line.
app.use(express.json());

// WHAT: Define a GET route at "/api/health".
// WHY: A health check endpoint verifies the server is alive without touching the database.
app.get('/api/health', (req, res) => {
  console.log('Received GET request on /api/health');
  res.json({ status: 'ok' });
});

// WHAT: Register mock downstream service endpoints.
// WHY: Simulates an external API that our pipeline forwards events to.
app.post('/api/mock-downstream', handleMockDownstream);
app.post('/api/mock-downstream/mode', handleMockDownstreamMode);

// WHAT: Mount our new API router under the /api prefix.
// WHY: Connects /api/login, /api/logout, /api/me, /api/events, and /api/events/:id.
app.use('/api', apiRoutes);


// ─── START THE SERVER ─────────────────────────────────────────────────────

// WHAT: Determine which port the server should listen on.
const PORT = process.env.PORT || 3000;

// WHAT: Start the Express server and begin listening for incoming network requests.
app.listen(PORT, () => {
  console.log('====================================================');
  console.log('EventBridge Express server is running on port ' + PORT);
  console.log('Health check:    http://localhost:' + PORT + '/api/health');
  console.log('Webhook route:   http://localhost:' + PORT + '/api/webhook');
  console.log('Mock downstream: http://localhost:' + PORT + '/api/mock-downstream');
  console.log('Mock mode route: http://localhost:' + PORT + '/api/mock-downstream/mode');
  console.log('Login route:     http://localhost:' + PORT + '/api/login');
  console.log('Events route:    http://localhost:' + PORT + '/api/events');
  console.log('SSE Stream:      http://localhost:' + PORT + '/api/stream');
  console.log('====================================================');

  // WHAT: Test the Supabase connection once when the server starts.
  // WHY: Immediately tells the developer whether the database configuration is working.
  testSupabaseConnection();

  // WHAT: Start the background event sweeper.
  // WHY: Immediately checks for any events abandoned in "Received" state before this startup,
  // and schedules ongoing checks every 30 seconds.
  startSweeper();
});
