// WHAT: Import Node's built-in crypto module.
// WHY: We need it to create SHA-256 hashes and to use timingSafeEqual,
// which compares two values in a way that prevents timing-based attacks.
const crypto = require('crypto');

// WHAT: Import jsonwebtoken.
// WHY: Used to sign and verify JSON Web Tokens (JWTs) for authenticated admin sessions.
const jwt = require('jsonwebtoken');

// WHAT: This function checks whether the incoming request carries the correct
//       webhook secret in its "x-webhook-secret" header.
// WHY:  Without a secret check, anyone on the internet could POST fake events
//       or toggle our mock downstream settings. This is our shared security guard.
//
// How it works step by step:
//   1. Read the "x-webhook-secret" header value from the request.
//   2. Hash both the incoming value and our stored process.env.WEBHOOK_SECRET with SHA-256.
//      (We never compare raw strings because that can leak secret information.)
//   3. Use crypto.timingSafeEqual to compare the two hashes.
//      (timingSafeEqual always takes the exact same time regardless of how many
//       characters match, which completely blocks "timing attacks".)
//   4. Return true if they match, false otherwise.
function checkSecret(req) {
  // WHAT: Read the header the caller sent.
  // WHY: This is where callers are expected to put the shared secret.
  const incomingHeader = req.headers['x-webhook-secret'];

  // WHAT: If the header is completely absent, reject immediately.
  // WHY: There is nothing to compare — fail fast.
  if (!incomingHeader) {
    console.log('Secret check failed: x-webhook-secret header is missing.');
    return false;
  }

  // WHAT: Hash the expected secret (from our environment variable).
  // WHY: We compare hashes, not plain-text strings, so the raw secret value
  //      is never held in memory in a form that could be accidentally logged.
  const expectedHash = crypto
    .createHash('sha256')
    .update(process.env.WEBHOOK_SECRET)
    .digest();

  // WHAT: Hash the value the caller provided in the header.
  // WHY: Same reason — we only compare hashes.
  const incomingHash = crypto
    .createHash('sha256')
    .update(incomingHeader)
    .digest();

  // WHAT: Compare the two hashes using timingSafeEqual.
  // WHY: crypto.timingSafeEqual prevents timing attacks. It returns true only
  //      if every byte matches. Both buffers are guaranteed to be 32 bytes (SHA-256).
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
  // WHAT: Ensure the input is a valid string.
  // WHY: If the caller provided null, undefined, or a non-string object, reject immediately.
  if (typeof givenPassword !== 'string' || !givenPassword) {
    return false;
  }

  // WHAT: Ensure process.env.ADMIN_PASSWORD is set.
  // WHY: Guard against missing server configuration.
  if (!process.env.ADMIN_PASSWORD) {
    console.error('Security alert: ADMIN_PASSWORD is not set in environment.');
    return false;
  }

  // WHAT: Hash the expected admin password from process.env with SHA-256.
  // WHY: Normalizes length to 32 bytes and keeps plain text out of direct comparison.
  const expectedHash = crypto
    .createHash('sha256')
    .update(process.env.ADMIN_PASSWORD)
    .digest();

  // WHAT: Hash the user-submitted password with SHA-256.
  // WHY: Produces an identical 32-byte digest if the password matches.
  const givenHash = crypto
    .createHash('sha256')
    .update(givenPassword)
    .digest();

  // WHAT: Compare both digests in constant time using crypto.timingSafeEqual.
  // WHY: Prevents attackers from measuring response delays to guess the password character by character.
  return crypto.timingSafeEqual(expectedHash, givenHash);
}

// ─── JWT TOKEN GENERATION ──────────────────────────────────────────────────

// WHAT: Generate a signed JSON Web Token (JWT) representing an admin session.
// WHY:  Once the user logs in with the correct password, we give their browser this
//       signed token stored in an httpOnly cookie so they remain logged in for 12 hours.
function createToken() {
  return jwt.sign(
    { role: 'admin' },
    process.env.SESSION_SECRET,
    { expiresIn: '12h' }
  );
}

// ─── REQUIRE LOGIN MIDDLEWARE ──────────────────────────────────────────────

// WHAT: Express middleware to protect routes that require authentication.
// WHY:  Reads the "eventbridge_token" cookie, verifies its signature with SESSION_SECRET,
//       and blocks unauthorized access with a 401 status.
function requireLogin(req, res, next) {
  // WHAT: Read the cookie parsed by cookie-parser.
  // WHY: In web applications, httpOnly cookies are the most secure way to hold session tokens.
  const token = req.cookies ? req.cookies.eventbridge_token : undefined;

  // WHAT: If no token was sent in the request cookies, reject with 401.
  // WHY: The client is not signed in.
  if (!token) {
    console.log('Access denied: No eventbridge_token cookie found.');
    return res.status(401).json({ error: 'Not signed in' });
  }

  // WHAT: Verify the token signature and expiration date.
  // WHY: jwt.verify throws an error if the token has expired, been tampered with, or was signed with a different key.
  try {
    const decoded = jwt.verify(token, process.env.SESSION_SECRET);
    // Attach decoded user data to req.user for use in downstream route handlers if needed
    req.user = decoded;
    console.log('Authentication successful for role:', decoded.role);
    next();
  } catch (err) {
    console.log('Access denied: Invalid or expired eventbridge_token cookie:', err.message);
    return res.status(401).json({ error: 'Not signed in' });
  }
}

// WHAT: Export all authentication helpers.
// WHY: Used by webhook.js, mockDownstream.js, and routes.js.
module.exports = {
  checkSecret,
  checkPassword,
  createToken,
  requireLogin
};
