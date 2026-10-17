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

// WHAT: Import path and fs built-in Node.js modules.
// WHY: We need path to safely resolve directories across different operating systems,
// and fs to verify whether the client/dist production build folder exists before serving it.
const path = require('path');
const fs = require('fs');

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



// ─── UNKNOWN /api ROUTE FALLBACK ──────────────────────────────────────────
// WHAT: Catch-all fallback handler for any unrecognized /api endpoints.
// WHY: If a request path begins with /api but did not match any of the registered routes above,
// reply with HTTP 404 and a JSON object {"error": "Not found"}. This ensures API callers receive
// clean structured JSON error responses rather than an HTML 404 page.
app.all('/api/*', (req, res) => {
  console.log('Received request for unknown API route:', req.method, req.originalUrl);
  res.status(404).json({ error: 'Not found' });
});


// ─── SERVE STATIC FRONTEND (REACT CLIENT) ─────────────────────────────────
// WHAT: Build the absolute path to the client/dist folder using path.join and __dirname.
// WHY: Building the path with the path module ensures it works reliably regardless of what
// current working directory the server was launched from (e.g. from root or from server/).
const clientDistPath = path.join(__dirname, '../client/dist');

// WHAT: Check if the client/dist directory exists on disk before serving.
// WHY: If someone runs the server in development without building the client first,
// we log a clear message and DO NOT crash the server.
if (fs.existsSync(clientDistPath)) {
  console.log('Serving built frontend static files from:', clientDistPath);
  app.use(express.static(clientDistPath));
} else {
  console.log('client/dist not found, run the build');
}


// ─── CLIENT SPA ROUTING FALLBACK ──────────────────────────────────────────
// WHAT: For any other GET request that does NOT start with /api/, send client/dist/index.html.
// WHY: Single Page Applications (SPAs) manage routing on the client side. Sending index.html
// allows the React application to load and display the correct view when a user refreshes or bookmarks a URL.
// We use the regular expression /^\/(?!api\/).*/ and NOT a "*" string, because the "*" wildcard
// pattern breaks in newer versions of Express.
app.get(/^\/(?!api\/).*/, (req, res) => {
  const indexPath = path.join(clientDistPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('client/dist not found, run the build');
  }
});


// ─── START THE SERVER ─────────────────────────────────────────────────────

// WHAT: Determine which port the server should listen on.
// WHY: Render provides the listening port in process.env.PORT. Defaults to 3000 locally.
const PORT = process.env.PORT || 3000;

// WHAT: Bind the server to host "0.0.0.0".
// WHY: Binding to "0.0.0.0" allows Render's reverse proxy router to route external traffic to this process.
const HOST = '0.0.0.0';

// WHAT: Start the Express server and begin listening for incoming network requests.
app.listen(PORT, HOST, () => {
  console.log('====================================================');
  console.log('EventBridge Express server is running on port ' + PORT);
  console.log('Bound to host:   ' + HOST);
  console.log('Health check:    http://localhost:' + PORT + '/api/health');
  console.log('Keepalive check: http://localhost:' + PORT + '/api/keepalive');
  console.log('Webhook route:   http://localhost:' + PORT + '/api/webhook');
  console.log('Mock downstream: http://localhost:' + PORT + '/api/mock-downstream');
  console.log('Mock mode route: http://localhost:' + PORT + '/api/mock-downstream/mode');
  console.log('Login route:     http://localhost:' + PORT + '/api/login');
  console.log('Events route:    http://localhost:' + PORT + '/api/events');
  console.log('SSE Stream:      http://localhost:' + PORT + '/api/stream');
  console.log('====================================================');

  // ─── STARTUP ENVIRONMENT CHECK ──────────────────────────────────────────
  // WHAT: Log an Environment check showing whether each required variable is set.
  // WHY: Verifies that all required configuration is present on Render at startup.
  // CRITICAL RULE: Print names only with true or false for "is it set". NEVER print any value.
  console.log('--- Environment check ---');
  console.log('PORT is set:', Boolean(process.env.PORT));
  console.log('SUPABASE_URL is set:', Boolean(process.env.SUPABASE_URL));
  console.log('SUPABASE_SERVICE_ROLE_KEY is set:', Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY));
  console.log('WEBHOOK_SECRET is set:', Boolean(process.env.WEBHOOK_SECRET));
  console.log('ADMIN_PASSWORD is set:', Boolean(process.env.ADMIN_PASSWORD));
  console.log('SESSION_SECRET is set:', Boolean(process.env.SESSION_SECRET));
  console.log('DOWNSTREAM_URL is set:', Boolean(process.env.DOWNSTREAM_URL));
  console.log('-------------------------');

  // WHAT: Test the Supabase connection once when the server starts.
  // WHY: Immediately tells the developer whether the database configuration is working.
  testSupabaseConnection();

  // WHAT: Start the background event sweeper.
  // WHY: Immediately checks for any events abandoned in "Received" state before this startup,
  // and schedules ongoing checks every 30 seconds.
  startSweeper();
});
