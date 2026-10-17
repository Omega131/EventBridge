// WHAT: Import Express to create a modular router.
// WHY: Using an express.Router keeps our route definitions neatly grouped in one file,
// making server/index.js clean and focused purely on server startup and middleware.
const express = require('express');
const router = express.Router();

// WHAT: Import jsonwebtoken.
// WHY: Used in the /api/me endpoint to quickly check whether the session token is valid.
const jwt = require('jsonwebtoken');

// WHAT: Import our authentication helpers and rate limiting functions from auth.js.
// WHY: We need checkPassword to verify login credentials, createToken to make JWTs,
// requireLogin middleware to protect admin-only routes, isTokenValid to verify token versions,
// and rate-limiting helpers to guard against brute-force login attacks.
const {
  checkPassword,
  createToken,
  requireLogin,
  isTokenValid,
  isLoginRateLimited,
  recordFailedLogin,
  clearFailedLogins
} = require('./auth');

// WHAT: Import getSetting and setSetting from settings.js.
// WHY: Used to read and update persistent settings such as mock_healthy and auth_version.
const { getSetting, setSetting } = require('./settings');

// WHAT: Import setMockHealthy from mockDownstream.js.
// WHY: Used by the admin POST /api/mock/mode endpoint to toggle the mock downstream service.
const { setMockHealthy } = require('./mockDownstream');

// WHAT: Import our Supabase database client from supabase.js.
// WHY: We need database access to read and manage event rows.
const { supabase } = require('./supabase');

// WHAT: Import SSE client management and broadcast functions from sse.js.
// WHY: The GET /api/stream route needs to register incoming browser connections,
// and admin actions broadcast events to update all connected dashboards in real time.
const { addClient, removeClient, broadcast, publishEvent } = require('./sse');

// WHAT: Import runPipeline from pipeline.js.
// WHY: Once an event is claimed for retry, we run it through the delivery pipeline again.
const { runPipeline } = require('./pipeline');


// ─── ROUTE: GET /api/keepalive (PUBLIC KEEPALIVE ENDPOINT) ────────────────
// WHAT: Run one tiny query against the database (SELECT id FROM events LIMIT 1).
// WHY: An uptime monitor (such as UptimeRobot or Cron-job.org) will call this endpoint
// periodically so both the Render host and the Supabase database stay awake and active.
// We do NOT log successful calls because this endpoint will be called very frequently.
// If the database returns an error, we log the error and reply with HTTP 500 {"ok": false}.
router.get('/keepalive', async (req, res) => {
  try {
    const { error } = await supabase
      .from('events')
      .select('id')
      .limit(1);

    if (error) {
      console.error('Keepalive error: Supabase query failed:', error.message);
      return res.status(500).json({ ok: false });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Keepalive error: Unexpected exception during database check:', err.message);
    return res.status(500).json({ ok: false });
  }
});


// ─── ROUTE: GET /api/stream (PUBLIC SSE STREAM) ───────────────────────────
// WHAT: Provide a Server-Sent Events (SSE) stream for real-time dashboard updates.
// WHY:  Allows any visitor (public, no login required) to receive live updates
//       whenever an event is received, completed, or failed.
router.get('/stream', (req, res) => {
  console.log('--- Incoming GET /api/stream (SSE connection) ---');

  // WHAT: Set mandatory HTTP headers for Server-Sent Events.
  // WHY:
  //   - Content-Type: "text/event-stream" tells the client (browser) to keep the connection
  //     open and parse incoming text as an event stream instead of a normal web page.
  //   - Cache-Control: "no-cache" prevents intermediate proxies or browsers from caching SSE events.
  //   - Connection: "keep-alive" ensures the TCP connection stays open persistently.
  //   - X-Accel-Buffering: "no" disables response buffering in reverse proxies like Nginx,
  //     ensuring events are sent to the client immediately without being held in a buffer.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // WHAT: Send response headers to the client immediately.
  // WHY: Express normally waits until the response ends before sending headers.
  // Since an SSE stream never ends, we must explicitly call res.flushHeaders() to send HTTP 200 OK now.
  res.flushHeaders();

  // WHAT: Send an initial SSE comment to confirm the connection is active.
  // WHY: The browser's EventSource object receives confirmation immediately.
  res.write(': connected\n\n');

  // WHAT: Register this client's response object in our list of active listeners.
  // WHY: Enables sse.js to push future event-update messages to this connection.
  addClient(res);

  // WHAT: Listen for the HTTP request "close" event.
  // WHY: When a user closes the tab, navigates away, or loses internet connection,
  // the client socket emits "close". We clean up by removing the client from our array.
  req.on('close', () => {
    console.log('Client closed SSE connection on GET /api/stream.');
    removeClient(res);
  });

  // IMPORTANT: We NEVER call res.end() here!
  // An SSE connection must stay open indefinitely to allow the server to push new events over time.
});


// ─── ROUTE 1: POST /api/login ──────────────────────────────────────────────
// WHAT: Verify admin password and issue a signed session cookie.
// WHY:  Allows administrators to sign in and view full event payloads and retry failures.
// Protected by IP-based rate limiting (5 attempts per 15 minutes) to block brute-force attacks.
router.post('/login', async (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  console.log('--- Incoming POST /api/login from IP: ' + clientIp + ' ---');

  // WHAT: Check rate limiting BEFORE checking the password.
  // WHY: If this IP has count >= 5 failed attempts inside the 15-minute window,
  // reply 429 {"error":"Too many attempts. Try again later."} and log it.
  if (isLoginRateLimited(clientIp)) {
    console.warn('Rate limit exceeded: Blocking login attempt from IP:', clientIp);
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }

  // WHAT: Read the password from the JSON body.
  // WHY: The client sends {"password": "..."}.
  const password = req.body ? req.body.password : undefined;

  // WHAT: Validate that password was sent and is a string.
  // WHY: Guard against malformed JSON or unexpected non-string types.
  if (typeof password !== 'string') {
    console.log('Login rejected: Password must be a string.');
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Request body must be JSON with a string "password" field.'
    });
  }

  // WHAT: Verify the password using our constant-time checkPassword helper.
  // WHY: Validates against ADMIN_PASSWORD without risking timing attacks.
  const isValid = checkPassword(password);
  if (!isValid) {
    // Record failed login attempt for this IP
    recordFailedLogin(clientIp);
    // IMPORTANT: We log that a failed login happened, but NEVER log the password string itself.
    console.log('Login attempt failed: incorrect password.');
    return res.status(401).json({ error: 'Wrong password' });
  }

  // WHAT: On a correct password, delete the IP's entry from the rate limit tracker.
  // WHY: Legitimate administrator provided valid credentials; reset counter.
  clearFailedLogins(clientIp);

  try {
    // WHAT: Create a signed JWT token embedding the current database auth_version.
    // WHY: Reading auth_version allows future global revocations ("Sign out everywhere").
    const token = await createToken();

    // WHAT: Set the "eventbridge_token" cookie on the response.
    // WHY:
    //   - httpOnly: true prevents client-side JavaScript (XSS) from reading the token.
    //   - sameSite: "strict" prevents the browser from sending the cookie on cross-site requests (CSRF protection).
    //   - secure: true only in production (HTTPS), false in local development (HTTP).
    //   - maxAge: 12 hours in milliseconds (12 * 60 * 60 * 1000 = 43,200,000 ms).
    const twelveHoursInMs = 12 * 60 * 60 * 1000;
    res.cookie('eventbridge_token', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: twelveHoursInMs
    });

    console.log('Admin login successful. Session cookie set.');
    return res.status(200).json({
      loggedIn: true,
      webhookSecret: process.env.WEBHOOK_SECRET
    });
  } catch (err) {
    console.error('Login error while generating session token:', err.message);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Could not complete login.'
    });
  }
});


// ─── ROUTE 2: POST /api/logout ─────────────────────────────────────────────
// WHAT: Log the admin out by clearing the session cookie.
// WHY:  Clears credentials from the user's browser immediately.
router.post('/logout', (req, res) => {
  console.log('--- Incoming POST /api/logout ---');

  // WHAT: Clear the session cookie.
  // WHY: Setting an expired cookie instructs the browser to delete it immediately.
  res.clearCookie('eventbridge_token', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production'
  });

  console.log('Admin logged out. Session cookie cleared.');
  return res.status(200).json({ loggedIn: false });
});


// ─── ROUTE 3: GET /api/me ──────────────────────────────────────────────────
// WHAT: Check whether the current visitor is signed in as admin.
// WHY:  The frontend calls this when the page loads to decide whether to display
//       the admin view (payloads, retry buttons) or the public view.
//       This route uses the exact same isTokenValid check as requireLogin so they can never disagree.
//       If the database read fails, deny the request with 500 and log it (fail closed).
router.get('/me', async (req, res) => {
  // Read the cookie if present
  const token = req.cookies ? req.cookies.eventbridge_token : undefined;

  if (!token) {
    return res.status(200).json({ loggedIn: false });
  }

  // WHAT: Verify the token signature and database auth_version using isTokenValid.
  // WHY: Guarantees requireLogin and GET /api/me stay completely synchronized.
  try {
    const valid = await isTokenValid(token);
    if (valid) {
      return res.status(200).json({
        loggedIn: true,
        webhookSecret: process.env.WEBHOOK_SECRET
      });
    } else {
      return res.status(200).json({ loggedIn: false });
    }
  } catch (dbErr) {
    // FAIL CLOSED: If checking the database fails, reply 500
    console.error('GET /api/me error: Database read failed while verifying token (failing closed):', dbErr.message);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication service temporarily unavailable'
    });
  }
});


// ─── ROUTE 4: GET /api/events (PUBLIC) ─────────────────────────────────────
// WHAT: Return a list of the 100 most recent events with summary columns only.
// WHY:  Anyone can view the dashboard event list, but sensitive payloads and failure
//       reasons are intentionally excluded to protect private customer data.
router.get('/events', async (req, res) => {
  console.log('--- Incoming GET /api/events (public) ---');

  try {
    // WHAT: Select ONLY id, created_at, updated_at, status, attempt_count.
    // WHY: Rule: Never expose payload or failure_reason to public visitors.
    // Order by created_at DESC (newest first), with id DESC as tie-breaker. Limit 100.
    const { data: events, error } = await supabase
      .from('events')
      .select('id, created_at, updated_at, status, attempt_count')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Database error in GET /api/events:', error.message);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Could not fetch events.'
      });
    }

    console.log('Successfully fetched ' + (events ? events.length : 0) + ' public events.');
    return res.status(200).json(events || []);
  } catch (err) {
    console.error('Unexpected error in GET /api/events:', err.message);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Could not fetch events.'
    });
  }
});


// ─── ROUTE 5: GET /api/events/:id (ADMIN ONLY) ─────────────────────────────
// WHAT: Return the complete event row (including payload and failure_reason).
// WHY:  Signed-in administrators need full details to inspect payloads and debug failures.
// Protected by requireLogin middleware.
router.get('/events/:id', requireLogin, async (req, res) => {
  const eventId = req.params.id;
  console.log('--- Incoming GET /api/events/' + eventId + ' (admin) ---');

  // WHAT: Validate UUID format with regex before querying the database.
  // WHY: Supabase/PostgreSQL will reject malformed UUID strings with error 22P02.
  // Checking upfront lets us return a clear 400 Bad Request instead of failing unexpectedly.
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(eventId)) {
    console.log('Invalid UUID format supplied:', eventId);
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid event ID format. Must be a valid UUID.'
    });
  }

  try {
    // WHAT: Fetch the full row matching the requested id.
    // WHY: Admins are authorized to inspect the full event row.
    const { data: eventRow, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (error) {
      // PostgreSQL error code '22P02': invalid syntax for type uuid
      if (error.code === '22P02') {
        console.log('PostgreSQL reported invalid UUID format:', eventId);
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid event ID format.'
        });
      }

      // PGRST116: 0 rows found when .single() expects exactly 1 row
      if (error.code === 'PGRST116') {
        console.log('Event not found for ID:', eventId);
        return res.status(404).json({
          error: 'Not Found',
          message: 'Event not found.'
        });
      }

      console.error('Database error in GET /api/events/:id:', error.message);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Could not fetch event details.'
      });
    }

    if (!eventRow) {
      console.log('Event not found for ID:', eventId);
      return res.status(404).json({
        error: 'Not Found',
        message: 'Event not found.'
      });
    }

    console.log('Successfully fetched full event details for ID:', eventId);
    return res.status(200).json(eventRow);
  } catch (err) {
    console.error('Unexpected error in GET /api/events/:id:', err.message);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Could not fetch event details.'
    });
  }
});


// ─── ROUTE 6: POST /api/events/:id/retry (ADMIN ONLY) ──────────────────────
// WHAT: Atomically claim and retry a previously failed event.
// WHY: Allows an administrator to trigger re-delivery of an event whose downstream call failed.
// Protected by requireLogin middleware.
router.post('/events/:id/retry', requireLogin, async (req, res) => {
  const eventId = req.params.id;
  console.log('--- Incoming POST /api/events/' + eventId + '/retry (admin) ---');
  console.log('Retry requested for event ID:', eventId);

  // ── STEP 1: VALIDATE UUID FORMAT ─────────────────────────────────────────
  // WHAT: Validate that :id looks like a valid UUID before talking to the database.
  // WHY: Rejects malformed IDs immediately with 400 Bad Request and avoids DB type errors.
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(eventId)) {
    console.log('Retry rejected: Invalid UUID format supplied:', eventId);
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid event ID format. Must be a valid UUID.'
    });
  }

  try {
    // ── STEP 2: ATOMICALLY CLAIM THE EVENT IN A SINGLE DATABASE UPDATE ──────
    // WHAT: Update status to 'Received' WHERE id = :id AND status = 'Failed', returning the updated row.
    // WHY: CRITICAL CONCURRENCY RULE: By combining the status check ('Failed') and the status change
    // ('Received') into a SINGLE SQL UPDATE statement, PostgreSQL guarantees atomicity.
    // If two administrators click retry at the exact same millisecond, only ONE request can win the update.
    // We NEVER read the row first and then update it, because between the read and the update another
    // process could have modified it (a race condition).
    console.log('Attempting to claim event ID:', eventId, 'for retry...');
    const nowIsoString = new Date().toISOString();

    const { data: updatedRows, error: updateError } = await supabase
      .from('events')
      .update({
        status: 'Received',
        updated_at: nowIsoString
      })
      .eq('id', eventId)
      .eq('status', 'Failed')
      .select();

    // ── STEP 3A: HANDLE DATABASE ERRORS ────────────────────────────────────
    // WHAT: Check if Supabase returned a database execution error.
    // WHY: Keep the server stable and log the error for debugging without crashing.
    if (updateError) {
      console.error('Database error while attempting to claim event for retry:', updateError.message);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Could not process event retry. Please try again.'
      });
    }

    // ── STEP 3B: ZERO ROWS RETURNED (CLAIM FAILED) ─────────────────────────
    // WHAT: Zero rows matched our UPDATE condition (id = :id AND status = 'Failed').
    // WHY: This means either the event does not exist at all, or it is not currently in 'Failed' state.
    // We do a second lookup of the ID ONLY to decide whether to return 404 or 409.
    if (!updatedRows || updatedRows.length === 0) {
      console.log('Claim failed for event ID:', eventId, '(0 rows updated). Checking event status...');

      const { data: existingRows, error: lookupError } = await supabase
        .from('events')
        .select('id, status')
        .eq('id', eventId);

      if (lookupError) {
        console.error('Database error during retry lookup for event ID ' + eventId + ':', lookupError.message);
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'Could not verify event status.'
        });
      }

      // Event does not exist in the database -> 404 Not Found
      if (!existingRows || existingRows.length === 0) {
        console.log('Retry rejected: Event does not exist for ID:', eventId);
        return res.status(404).json({
          error: 'Not Found',
          message: 'Event not found.'
        });
      }

      // Event exists, but its status was not 'Failed' (e.g. 'Received' or 'Completed') -> 409 Conflict
      const currentStatus = existingRows[0].status;
      console.log('Retry rejected: not Failed for ID ' + eventId + '. Current status is "' + currentStatus + '".');
      return res.status(409).json({
        error: 'Event is not in Failed state (already retrying or completed)'
      });
    }

    // ── STEP 3C: ONE ROW RETURNED (CLAIM WON) ──────────────────────────────
    // WHAT: Exactly one row was updated. This request won the claim!
    // WHY: We now publish the new 'Received' status to all connected dashboards,
    // reply 202 Accepted to the caller, and kick off runPipeline in the background.
    const claimedRow = updatedRows[0];
    console.log('Claimed ' + eventId + ' successfully for retry.');

    // WHAT: Broadcast the newly claimed 'Received' row over SSE.
    // WHY: All open dashboards immediately show the badge transition back to "Received".
    try {
      publishEvent(claimedRow);
    } catch (publishErr) {
      console.error('Error publishing retry status via SSE:', publishErr.message);
    }

    // WHAT: Reply 202 Accepted.
    // WHY: HTTP 202 indicates that the retry request has been accepted for processing,
    // but the actual delivery pipeline will complete asynchronously.
    res.status(202).json({
      id: claimedRow.id,
      status: 'Received'
    });

    // WHAT: Launch the background pipeline without awaiting it.
    // WHY: The client receives a fast 202 response and does not wait for external HTTP calls.
    // runPipeline will reload the payload from the database and handle timeout & retry attempts.
    console.log('Triggering background pipeline for retried event ID:', eventId);
    runPipeline(eventId).catch((pipelineErr) => {
      console.error('Unexpected pipeline error during retry of event ' + eventId + ':', pipelineErr.message);
    });
    return;

  } catch (err) {
    console.error('Unexpected error in POST /api/events/:id/retry:', err.message);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Could not process event retry.'
    });
  }
});


// ─── ROUTE 7: GET /api/mock/status (PUBLIC) ────────────────────────────────
// WHAT: Return the current health status of the mock downstream service.
// WHY:  Allows frontend dashboards and external monitors to check whether the mock
//       service is currently healthy (200 OK) or simulating an outage (503 Error).
router.get('/mock/status', async (req, res) => {
  console.log('--- Incoming GET /api/mock/status ---');

  try {
    // WHAT: Read the "mock_healthy" setting from the database settings table.
    // WHY: Value is stored as "true" or "false" string; convert to boolean.
    const settingValue = await getSetting('mock_healthy');
    const isHealthy = settingValue === 'true';

    console.log('Current mock downstream health status:', isHealthy);
    return res.status(200).json({ healthy: isHealthy });
  } catch (err) {
    console.error('Failed to read mock_healthy setting from database:', err.message);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Could not fetch mock downstream status.'
    });
  }
});


// ─── ROUTE 8: POST /api/mock/mode (ADMIN ONLY) ─────────────────────────────
// WHAT: Toggle the mock downstream service health setting.
// WHY:  Allows signed-in administrators to switch mock downstream between healthy and broken.
// Protected by requireLogin middleware.
router.post('/mock/mode', requireLogin, async (req, res) => {
  console.log('--- Incoming POST /api/mock/mode (admin) ---');

  // WHAT: Validate that the incoming body contains a boolean "healthy" field.
  // WHY: The requirement specifies: body must be {"healthy": boolean}, anything else is 400.
  const requestedHealth = req.body ? req.body.healthy : undefined;
  if (typeof requestedHealth !== 'boolean') {
    console.log('Rejected invalid mock mode request: "healthy" must be a boolean (true or false).');
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Body must be JSON with a boolean "healthy" field, e.g. {"healthy": false}.'
    });
  }

  try {
    // WHAT: Persist the new health mode to the database settings table.
    // WHY: Survives restarts and keeps worker instances in sync.
    await setMockHealthy(requestedHealth);
    console.log('Mock downstream mode updated to:', requestedHealth);

    // WHAT: Broadcast "mock-status" over SSE to all open browser windows.
    // WHY: Open dashboards immediately update their mock status indicator.
    try {
      broadcast('mock-status', { healthy: requestedHealth });
    } catch (broadcastErr) {
      console.error('Error broadcasting mock-status over SSE:', broadcastErr.message);
    }

    // WHAT: Reply with the updated health status.
    return res.status(200).json({ healthy: requestedHealth });
  } catch (err) {
    console.error('Failed to update mock downstream mode:', err.message);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Could not update mock health setting.'
    });
  }
});


// ─── ROUTE 9: POST /api/admin/clear-events (ADMIN ONLY) ────────────────────
// WHAT: Delete every event in the events table and notify all connected clients.
// WHY:  Provides an administrative reset mechanism for cleaning up test runs and demos.
// Protected by requireLogin middleware.
router.post('/admin/clear-events', requireLogin, async (req, res) => {
  console.log('--- Incoming POST /api/admin/clear-events (admin) ---');

  // WHAT: Verify explicit confirmation in request body.
  // WHY: Guard against accidental clicks; body must be exactly {"confirm": "DELETE ALL"}.
  const confirm = req.body ? req.body.confirm : undefined;
  if (confirm !== 'DELETE ALL') {
    console.log('Clear events rejected: missing or invalid confirmation string.');
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Body must be exactly {"confirm": "DELETE ALL"}'
    });
  }

  try {
    // WHAT: Delete every row in the events table in a single Supabase delete call.
    // WHY: Supabase requires a filter on delete, so we match all IDs that are not the nil UUID
    // and request count: "exact" so we know exactly how many rows were removed.
    console.log('Executing database delete on all events table rows...');
    const { count, error } = await supabase
      .from('events')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (error) {
      console.error('Database error in clear-events:', error.message);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Could not clear events table.'
      });
    }

    const deletedCount = count !== null ? count : 0;
    // CRITICAL SECURITY RULE: Log the number only, NEVER log any payload or sensitive data.
    console.log('Admin clear-events completed. Total rows deleted:', deletedCount);

    // WHAT: Broadcast "events-cleared" over SSE to all connected clients.
    // WHY: All open dashboards immediately clear their in-memory event lists.
    try {
      broadcast('events-cleared', {});
    } catch (broadcastErr) {
      console.error('Error broadcasting events-cleared over SSE:', broadcastErr.message);
    }

    // WHAT: Reply with the count of deleted events.
    return res.status(200).json({ deleted: deletedCount });
  } catch (err) {
    console.error('Unexpected error in clear-events:', err.message);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Could not clear events table.'
    });
  }
});


// ─── ROUTE 10: POST /api/admin/sign-out-everywhere (ADMIN ONLY) ────────────
// WHAT: Invalidate all existing admin session tokens across all browsers and devices.
// WHY:  JWTs are stateless by default and cannot be revoked without a centralized check.
// By incrementing the "auth_version" integer in the database settings table, every
// previously issued token (which carries the older version number in its payload)
// will fail validation on its next request in isTokenValid(). This instantly signs out
// all active sessions everywhere without needing a token blocklist.
// Protected by requireLogin middleware.
router.post('/admin/sign-out-everywhere', requireLogin, async (req, res) => {
  console.log('--- Incoming POST /api/admin/sign-out-everywhere (admin) ---');

  try {
    // WHAT: Read current auth_version from the database settings table.
    const currentVersionStr = await getSetting('auth_version');
    const currentVersion = parseInt(currentVersionStr, 10);
    const newVersion = currentVersion + 1;

    console.log('Incrementing auth_version in database from ' + currentVersion + ' to ' + newVersion + '...');

    // WHAT: Save incremented auth_version to the database.
    // WHY: This invalidates all currently outstanding tokens across all devices simultaneously.
    await setSetting('auth_version', String(newVersion));

    // WHAT: Clear the session cookie for the current caller.
    // WHY: Clears the local browser's cookie immediately.
    res.clearCookie('eventbridge_token', {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production'
    });

    console.log('Sign out everywhere complete: auth_version is now ' + newVersion + '. Session cookie cleared.');
    return res.status(200).json({ loggedIn: false });
  } catch (err) {
    console.error('Error during sign-out-everywhere:', err.message);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Could not process sign out everywhere.'
    });
  }
});


// WHAT: Export the router so index.js can mount it.
module.exports = router;
