// WHAT: Import Node's built-in crypto module.
// WHY: We need it to create SHA-256 hashes and to use timingSafeEqual,
// which compares two values in a way that prevents timing-based attacks.
const crypto = require('crypto');

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

// WHAT: Export checkSecret so webhook.js and mockDownstream.js can both use it.
// WHY: Reusing one authentication function keeps our security logic in one place.
module.exports = {
  checkSecret
};
