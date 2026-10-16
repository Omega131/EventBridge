// WHAT: Import Express to create a modular router.
// WHY: Using an express.Router keeps our route definitions neatly grouped in one file,
// making server/index.js clean and focused purely on server startup and middleware.
const express = require('express');
const router = express.Router();

// WHAT: Import jsonwebtoken.
// WHY: Used in the /api/me endpoint to quickly check whether the session token is valid.
const jwt = require('jsonwebtoken');

// WHAT: Import our authentication helpers from auth.js.
// WHY: We need checkPassword to verify login credentials, createToken to make JWTs,
// and requireLogin middleware to protect admin-only routes.
const { checkPassword, createToken, requireLogin } = require('./auth');

// WHAT: Import our Supabase database client from supabase.js.
// WHY: We need database access to read event rows.
const { supabase } = require('./supabase');


// ─── ROUTE 1: POST /api/login ──────────────────────────────────────────────
// WHAT: Verify admin password and issue a signed session cookie.
// WHY:  Allows administrators to sign in and view full event payloads and retry failures.
router.post('/login', (req, res) => {
  console.log('--- Incoming POST /api/login ---');

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
    // IMPORTANT: We log that a failed login happened, but NEVER log the password string itself.
    console.log('Login attempt failed: incorrect password.');
    return res.status(401).json({ error: 'Wrong password' });
  }

  // WHAT: Create a signed JWT token valid for 12 hours.
  // WHY: Encapsulates the admin role securely in a signed token.
  const token = createToken();

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
  return res.status(200).json({ loggedIn: true });
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
//       This route MUST ALWAYS return HTTP 200 (never 401), so it does NOT use requireLogin.
router.get('/me', (req, res) => {
  // Read the cookie if present
  const token = req.cookies ? req.cookies.eventbridge_token : undefined;

  if (!token) {
    return res.status(200).json({ loggedIn: false });
  }

  // WHAT: Verify the token signature.
  // WHY: Confirms the cookie hasn't expired or been forged.
  try {
    jwt.verify(token, process.env.SESSION_SECRET);
    return res.status(200).json({ loggedIn: true });
  } catch (err) {
    // If expired or invalid, treat as logged out
    return res.status(200).json({ loggedIn: false });
  }
});


// ─── ROUTE 4: GET /api/events (PUBLIC) ─────────────────────────────────────
// WHAT: Return a list of the 100 most recent events with summary columns only.
// WHY:  Anyone can view the dashboard event list, but sensitive payloads and failure
//       reasons are intentionally excluded to protect private customer data.
router.get('/events', async (req, res) => {
  console.log('--- Incoming GET /api/events (public) ---');

  try {
    // WHAT: Select ONLY id, created_at, status, attempt_count.
    // WHY: Rule: Never expose payload or failure_reason to public visitors.
    // Order by created_at DESC (newest first), with id DESC as tie-breaker. Limit 100.
    const { data: events, error } = await supabase
      .from('events')
      .select('id, created_at, status, attempt_count')
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

// WHAT: Export the router so index.js can mount it.
module.exports = router;
