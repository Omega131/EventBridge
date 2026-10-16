// WHAT: Import Node's built-in crypto module.
// WHY: We need it to create SHA-256 hashes and to use timingSafeEqual,
// which compares two values in a way that prevents timing-based attacks.
const crypto = require('crypto');

// WHAT: Import jsonwebtoken.
// WHY: Used to sign and verify JSON Web Tokens (JWTs) for authenticated admin sessions.
const jwt = require('jsonwebtoken');

// ─── LOGIN RATE LIMITING CONFIGURATION ───────────────────────────────────

// WHAT: Maximum number of failed login attempts allowed within the time window.
// WHY: Blocks brute-force automated password guessing attacks.
const MAX_FAILED_LOGINS = 5;

// WHAT: The duration of the rate-limiting tracking window in minutes.
// WHY: 15 minutes is a standard security window that slows down attackers significantly
// while not locking out legitimate administrators indefinitely.
const WINDOW_MINUTES = 15;
const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;

// WHAT: An in-memory object tracking failed login attempts keyed by client IP.
// WHY: Keyed by IP: { count: number, firstFailureTime: number (timestamp in ms) }.
const failedLogins = {};

// WHAT: Clean up expired rate limiting entries every 15 minutes.
// WHY: Prevents the failedLogins object from growing indefinitely in server memory.
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;
  for (const ip in failedLogins) {
    if (now - failedLogins[ip].firstFailureTime > WINDOW_MS) {
      delete failedLogins[ip];
      cleanedCount++;
    }
  }
  if (cleanedCount > 0) {
    console.log('Rate Limiter: Cleaned up ' + cleanedCount + ' expired IP record(s) from memory.');
  }
}, WINDOW_MS);
// WHAT: Call unref() on the cleanup timer.
// WHY: Ensures the background cleanup timer does not prevent Node from gracefully shutting down.
if (cleanupInterval && typeof cleanupInterval.unref === 'function') {
  cleanupInterval.unref();
}

// WHAT: Check whether an IP address is currently rate-limited.
// WHY: If the IP has 5 or more failures inside the 15-minute window, block the attempt before checking password.
function isLoginRateLimited(ip) {
  const record = failedLogins[ip];
  if (!record) {
    return false;
  }

  const now = Date.now();
  // If the window has expired, delete the old record and do not rate limit
  if (now - record.firstFailureTime > WINDOW_MS) {
    delete failedLogins[ip];
    return false;
  }

  return record.count >= MAX_FAILED_LOGINS;
}

// WHAT: Record a failed login attempt for an IP address.
// WHY: Increments the failure count or starts a new 15-minute window if the previous one expired.
function recordFailedLogin(ip) {
  const now = Date.now();
  const record = failedLogins[ip];

  if (!record || (now - record.firstFailureTime > WINDOW_MS)) {
    // Start a brand-new 15-minute window
    failedLogins[ip] = {
      count: 1,
      firstFailureTime: now
    };
    console.log('Rate Limiter: Recorded 1st failed login for IP: ' + ip);
  } else {
    // Increment count in current window
    record.count += 1;
    console.log('Rate Limiter: Recorded failed login for IP: ' + ip + ' (Count: ' + record.count + ' of ' + MAX_FAILED_LOGINS + ')');
  }
}

// WHAT: Clear failed login tracking for an IP address after a successful login.
// WHY: When an administrator provides the correct password, we reset their count immediately.
function clearFailedLogins(ip) {
  if (failedLogins[ip]) {
    console.log('Rate Limiter: Resetting failed login counter for IP: ' + ip + ' after successful authentication.');
    delete failedLogins[ip];
  }
}


// ─── WEBHOOK SECRET VERIFICATION ──────────────────────────────────────────

// WHAT: This function checks whether the incoming request carries the correct
//       webhook secret in its "x-webhook-secret" header.
// WHY:  Without a secret check, anyone on the internet could POST fake events
//       or toggle our mock downstream settings. This is our shared security guard.
function checkSecret(req) {
  const incomingHeader = req.headers['x-webhook-secret'];

  if (!incomingHeader) {
    console.log('Secret check failed: x-webhook-secret header is missing.');
    return false;
  }

  const expectedHash = crypto
    .createHash('sha256')
    .update(process.env.WEBHOOK_SECRET)
    .digest();

  const incomingHash = crypto
    .createHash('sha256')
    .update(incomingHeader)
    .digest();

  const secretsMatch = crypto.timingSafeEqual(expectedHash, incomingHash);

  if (!secretsMatch) {
    console.log('Secret check failed: x-webhook-secret header did not match.');
  }

  return secretsMatch;
}


// ─── ADMIN PASSWORD VERIFICATION ──────────────────────────────────────────

// WHAT: Compare a user-submitted password with the ADMIN_PASSWORD environment variable.
// WHY:  Protects the admin login route. Just like checkSecret, we hash both values with SHA-256
//       and compare with timingSafeEqual to avoid timing side-channel attacks.
function checkPassword(givenPassword) {
  if (typeof givenPassword !== 'string' || !givenPassword) {
    return false;
  }

  if (!process.env.ADMIN_PASSWORD) {
    console.error('Security alert: ADMIN_PASSWORD is not set in environment.');
    return false;
  }

  const expectedHash = crypto
    .createHash('sha256')
    .update(process.env.ADMIN_PASSWORD)
    .digest();

  const givenHash = crypto
    .createHash('sha256')
    .update(givenPassword)
    .digest();

  return crypto.timingSafeEqual(expectedHash, givenHash);
}


// WHAT: Import getSetting from settings.js.
// WHY: We need to read the current auth_version from the Supabase settings table to embed
// the version in newly issued tokens and verify that incoming tokens haven't been revoked.
const { getSetting } = require('./settings');

// ─── JWT TOKEN GENERATION ──────────────────────────────────────────────────

// WHAT: Generate a signed JSON Web Token (JWT) representing an admin session with a version.
// WHY:  createToken is async because it reads the current "auth_version" from the database settings table.
// Embedding the version "v" in the token allows instant global revocation ("Sign out everywhere"):
// if auth_version is incremented in the database, all tokens with older "v" numbers become invalid.
async function createToken() {
  console.log('Reading auth_version from database for new token...');
  const versionStr = await getSetting('auth_version');
  const versionNum = parseInt(versionStr, 10);

  console.log('Creating signed admin session token with auth_version:', versionNum);

  return jwt.sign(
    { role: 'admin', v: versionNum },
    process.env.SESSION_SECRET,
    { expiresIn: '12h' }
  );
}


// ─── TOKEN VALIDATION & REVOCATION CHECK ───────────────────────────────────

// WHAT: Verify a session JWT token and check that its version matches the current database auth_version.
// WHY: JWTs are stateless by design. To enable instant global sign-out across all devices ("Sign out everywhere"),
// each token embeds a version number "v". If the database's auth_version has been incremented,
// all tokens with older version numbers become instantly invalid.
//
// RULE: Fail closed: If reading the database fails, the thrown error propagates so callers
// deny access with HTTP 500 instead of allowing a potentially revoked token.
async function isTokenValid(token) {
  if (!token || typeof token !== 'string') {
    return false;
  }

  // WHAT: Verify token signature and expiration with SESSION_SECRET.
  // WHY: Wrapped in try/catch so malformed or expired tokens return false cleanly without crashing.
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.SESSION_SECRET);
  } catch (err) {
    console.log('Token signature verification failed:', err.message);
    return false;
  }

  // WHAT: Check that the token carries the admin role and a numeric version v.
  // WHY: Tokens issued before this change or tokens missing "v" must be rejected.
  if (!decoded || decoded.role !== 'admin' || typeof decoded.v !== 'number') {
    console.log('Token rejected: Missing admin role or numeric version (v).');
    return false;
  }

  // WHAT: Read the active auth_version from the database settings table.
  // WHY: If the database read fails, an Error is thrown and propagates to the caller (fail closed).
  const currentVersionStr = await getSetting('auth_version');
  const currentVersion = parseInt(currentVersionStr, 10);

  // WHAT: Compare token version with current database version.
  // WHY: Only tokens matching the current database version are allowed.
  if (decoded.v === currentVersion) {
    return true;
  } else {
    console.log(
      'Token revoked by version mismatch: Token has v=' + decoded.v +
      ', but current auth_version in database is ' + currentVersion + '.'
    );
    return false;
  }
}


// ─── REQUIRE LOGIN MIDDLEWARE ──────────────────────────────────────────────

// WHAT: Express middleware to protect routes that require authentication.
// WHY:  Reads the "eventbridge_token" cookie, verifies signature and version via isTokenValid,
//       and blocks unauthorized access with a 401 status. Fails closed with 500 if DB read fails.
async function requireLogin(req, res, next) {
  const token = req.cookies ? req.cookies.eventbridge_token : undefined;

  if (!token) {
    console.log('Access denied: No eventbridge_token cookie found.');
    return res.status(401).json({ error: 'Not signed in' });
  }

  try {
    const valid = await isTokenValid(token);
    if (!valid) {
      console.log('Access denied: Invalid, expired, or revoked eventbridge_token cookie.');
      return res.status(401).json({ error: 'Not signed in' });
    }

    // Attach decoded token payload to req.user for use in protected routes
    req.user = jwt.decode(token);
    console.log('Authentication successful for role:', req.user.role, 'version:', req.user.v);
    next();
  } catch (dbErr) {
    // FAIL CLOSED: If checking the database fails, deny access with 500
    console.error('requireLogin: Database read failed while checking auth_version (failing closed):', dbErr.message);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication service temporarily unavailable'
    });
  }
}

// WHAT: Export all authentication and rate-limiting helpers.
// WHY: Used by webhook.js, mockDownstream.js, and routes.js.
module.exports = {
  checkSecret,
  checkPassword,
  createToken,
  isTokenValid,
  requireLogin,
  failedLogins,
  MAX_FAILED_LOGINS,
  WINDOW_MINUTES,
  isLoginRateLimited,
  recordFailedLogin,
  clearFailedLogins
};
