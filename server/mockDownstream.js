// WHAT: Import our shared secret verification helper from auth.js.
// WHY: We reuse the exact same timing-safe secret check to protect administrative actions
// like toggling the mock downstream mode.
const { checkSecret } = require('./auth');

// WHAT: Import getSetting and setSetting from settings.js.
// WHY: In Phase 6.5a, we stop using the in-memory isHealthy variable. Storing the mock downstream
// mode in the Supabase "settings" table ensures the health setting survives server restarts
// and remains consistent across multiple server instances or worker processes.
const { getSetting, setSetting } = require('./settings');

// WHAT: Import broadcast from sse.js.
// WHY: When the mock mode is toggled, we broadcast "mock-status" to all open browser dashboards.
const { broadcast } = require('./sse');

// WHAT: Helper function to persist mock downstream health in the database.
// WHY: Exported so other backend modules or tests can toggle mock health programmatically.
async function setMockHealthy(boolean) {
  const valueString = boolean ? 'true' : 'false';
  console.log('setMockHealthy called with:', boolean, '-> saving "' + valueString + '" to database...');
  await setSetting('mock_healthy', valueString);
  return boolean;
}

// WHAT: Route handler for POST /api/mock-downstream.
// WHY: This acts as the destination API that our EventBridge pipeline forwards events to.
// Reads the current mock_healthy setting from the database on every request.
// If mock_healthy is "true", it simulates a healthy downstream service (200 OK).
// If mock_healthy is "false", it simulates a service outage (503 Service Unavailable).
async function handleMockDownstream(req, res) {
  console.log('--- Incoming POST /api/mock-downstream ---');

  // WHAT: Read the artificial delay in milliseconds from environment variables (default 0).
  // WHY: Adding a delay allows testers to observe an event sitting in the "Received" state
  // before transitioning to "Completed" or "Failed" live on the dashboard.
  const delayMs = parseInt(process.env.DOWNSTREAM_DELAY_MS || '0', 10);
  if (delayMs > 0) {
    console.log('Mock downstream: waiting ' + delayMs + 'ms before replying...');
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  // WHAT: Read the "mock_healthy" flag from the database settings table.
  // WHY: Rule: If reading fails, log it and reply 503 {"ok":false}.
  let isHealthy = false;
  try {
    const settingValue = await getSetting('mock_healthy');
    isHealthy = settingValue === 'true';
  } catch (readError) {
    console.error('Mock downstream failed to read mock_healthy setting from database:', readError.message);
    return res.status(503).json({ ok: false });
  }

  // WHAT: Decide whether to succeed or fail based on current mock mode.
  if (isHealthy) {
    console.log('Mock downstream status: HEALTHY (from database). Responding 200 OK.');
    return res.status(200).json({ ok: true });
  } else {
    console.log('Mock downstream status: UNHEALTHY (from database). Responding 503 Service Unavailable.');
    return res.status(503).json({
      ok: false,
      error: 'Service unavailable'
    });
  }
}

// WHAT: Route handler for POST /api/mock-downstream/mode.
// WHY: This is the administrative toggle switch. A tester or presenter can POST
// {"healthy": false} or {"healthy": true} to change how the mock downstream behaves.
async function handleMockDownstreamMode(req, res) {
  console.log('--- Incoming POST /api/mock-downstream/mode ---');

  // WHAT: Protect this endpoint with our webhook secret.
  // WHY: Only authorized callers should be able to flip our mock service between healthy and broken.
  const isAuthorized = checkSecret(req);
  if (!isAuthorized) {
    console.log('Rejected unauthorized mock downstream mode change request.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // WHAT: Inspect the incoming JSON body to check the "healthy" field.
  // WHY: express.json() parses the body into req.body. We must strictly ensure
  // that req.body.healthy is a genuine boolean (true or false).
  const requestedHealth = req.body ? req.body.healthy : undefined;

  // WHAT: Validate that the "healthy" property is explicitly a boolean.
  // WHY: Strings like "true" or numbers like 1 are not valid booleans; reject bad input.
  if (typeof requestedHealth !== 'boolean') {
    console.log('Rejected invalid mode request: "healthy" must be a boolean (true or false).');
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Body must be JSON with a boolean "healthy" field, e.g. {"healthy": false}.'
    });
  }

  // WHAT: Update the mock_healthy setting in the database settings table.
  // WHY: Future calls to /api/mock-downstream across any process will use this new setting.
  try {
    await setMockHealthy(requestedHealth);
    console.log('Mock downstream health mode updated in database. Current isHealthy:', requestedHealth);

    // WHAT: Broadcast mock-status over SSE to all open browser windows.
    // WHY: Rule: "Also make the EXISTING secret-protected route POST /api/mock-downstream/mode broadcast 'mock-status' the same way, so changes made with curl show up in open browsers."
    try {
      broadcast('mock-status', { healthy: requestedHealth });
    } catch (broadcastErr) {
      console.error('Error broadcasting mock-status over SSE:', broadcastErr.message);
    }

    // WHAT: Reply with the new state.
    // WHY: Confirms to the caller that the mode switch took effect.
    return res.status(200).json({
      healthy: requestedHealth
    });
  } catch (err) {
    console.error('Failed to update mock downstream mode in database:', err.message);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Could not update mock health setting.'
    });
  }
}

// WHAT: Export the handlers and the setMockHealthy function.
// WHY: index.js needs the handlers to mount them as Express routes, and other modules can use setMockHealthy.
module.exports = {
  handleMockDownstream,
  handleMockDownstreamMode,
  setMockHealthy
};
