// WHAT: Import our shared secret verification helper from auth.js.
// WHY: We reuse the exact same timing-safe secret check to protect administrative actions
// like toggling the mock downstream mode.
const { checkSecret } = require('./auth');

// WHAT: An in-memory variable tracking whether our pretend external service is healthy.
// WHY: In real life, third-party services occasionally go down. This flag lets us
// simulate outages on demand to prove our retry and failure pipeline works during demos.
let isHealthy = true;

// WHAT: Route handler for POST /api/mock-downstream.
// WHY: This acts as the destination API that our EventBridge pipeline forwards events to.
// If isHealthy is true, it simulates a successful external receiver (200 OK).
// If isHealthy is false, it simulates a third-party downtime or outage (503 Service Unavailable).
function handleMockDownstream(req, res) {
  console.log('--- Incoming POST /api/mock-downstream ---');

  // WHAT: Check our health flag.
  // WHY: Decide whether to succeed or fail based on current mock mode.
  if (isHealthy) {
    console.log('Mock downstream status: HEALTHY. Responding 200 OK.');
    return res.status(200).json({ ok: true });
  } else {
    console.log('Mock downstream status: UNHEALTHY. Responding 503 Service Unavailable.');
    return res.status(503).json({
      ok: false,
      error: 'Service unavailable'
    });
  }
}

// WHAT: Route handler for POST /api/mock-downstream/mode.
// WHY: This is the administrative toggle switch. A tester or presenter can POST
// {"healthy": false} or {"healthy": true} to change how the mock downstream behaves.
function handleMockDownstreamMode(req, res) {
  console.log('--- Incoming POST /api/mock-downstream/mode ---');

  // WHAT: Protect this endpoint with our webhook secret.
  // WHY: Only authorized users should be able to flip our mock service between healthy and broken.
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

  // WHAT: Update our in-memory flag.
  // WHY: Future calls to /api/mock-downstream will now use this new health state.
  isHealthy = requestedHealth;
  console.log('Mock downstream health mode updated. Current isHealthy:', isHealthy);

  // WHAT: Reply with the new state.
  // WHY: Confirms to the tester that the mode switch took effect.
  return res.status(200).json({
    healthy: isHealthy
  });
}

// WHAT: Export the handlers and the getter function.
// WHY: index.js needs the handlers to mount them as Express routes.
module.exports = {
  handleMockDownstream,
  handleMockDownstreamMode
};
