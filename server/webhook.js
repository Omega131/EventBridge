// WHAT: Import Node's built-in crypto module.
// WHY: We need it to create SHA-256 hashes for the idempotency key fallback.
const crypto = require('crypto');

// WHAT: Import the Supabase client we created in supabase.js.
// WHY: We need it to insert and query rows in the "events" table.
const { supabase } = require('./supabase');

// WHAT: Import the checkSecret authentication helper from auth.js.
// WHY: We reuse the exact same timing-safe secret check across webhooks and mock endpoints.
const { checkSecret } = require('./auth');

// WHAT: Import the runPipeline function from pipeline.js.
// WHY: Once an event is successfully stored with status 'Received', we run it through the pipeline.
const { runPipeline } = require('./pipeline');

// WHAT: Import publishEvent from sse.js.
// WHY: Broadcasts real-time event status updates to all connected SSE clients.
const { publishEvent } = require('./sse');


// ─── HELPER FUNCTION 2: getIdempotencyKey ──────────────────────────────────

// WHAT: Work out a unique "idempotency key" for this event.
// WHY:  An idempotency key lets us detect duplicate deliveries. If the same
//       webhook is sent twice (which happens with many providers), we can
//       identify it and avoid storing the event twice.
//
// Priority order:
//   1. "idempotency-key" header  — generic standard
//   2. "x-github-delivery" header — GitHub-specific unique delivery ID
//   3. SHA-256 hash of the raw body — fallback when no header is provided
function getIdempotencyKey(req, rawBodyString) {
  // WHAT: Check for a generic idempotency-key header first.
  // WHY: This is the most explicit and intentional signal from the caller.
  const idempotencyHeader = req.headers['idempotency-key'];
  if (idempotencyHeader) {
    console.log('Idempotency key source: idempotency-key header');
    return idempotencyHeader;
  }

  // WHAT: Check for GitHub's delivery ID header next.
  // WHY: GitHub automatically sets this on every webhook delivery, making it
  //      a reliable unique key for GitHub events.
  const githubDelivery = req.headers['x-github-delivery'];
  if (githubDelivery) {
    console.log('Idempotency key source: x-github-delivery header');
    return githubDelivery;
  }

  // WHAT: Fall back to hashing the raw request body.
  // WHY: If neither header is present, two requests with identical bodies are
  //      almost certainly duplicates. The hash is a deterministic fingerprint
  //      of the content.
  console.log('Idempotency key source: SHA-256 hash of raw body (no header provided)');
  const bodyHash = crypto
    .createHash('sha256')
    .update(rawBodyString)
    .digest('hex');
  return bodyHash;
}


// ─── HELPER FUNCTION 3: saveEvent ──────────────────────────────────────────

// WHAT: Attempt to insert a new event row into Supabase. Handle duplicates.
// WHY:  This is the core persistence step. Saving to the database is what
//       makes the event dashboard work — every webhook becomes a stored record.
//
// Returns an object: { success, id, status, row, duplicate, errorCode }
async function saveEvent(idempotencyKey, parsedPayload) {
  console.log('Attempting to insert event with idempotency key:', idempotencyKey);

  // WHAT: Try to INSERT a new row into the "events" table.
  // WHY:  The "events" table has a UNIQUE constraint on idempotency_key,
  //       so if we send the same key twice Supabase returns error code "23505".
  const { data: newRow, error: insertError } = await supabase
    .from('events')
    .insert({
      idempotency_key: idempotencyKey,
      payload: parsedPayload,
      status: 'Received',
    })
    .select()
    .single(); // WHAT: Ask Supabase to return the single inserted row object.
               // WHY: We need the full row (id, created_at, status, attempt_count) to publish via SSE and reply to caller.

  // WHAT: Check if the insert succeeded.
  // WHY: If there is no error, we have a brand-new event — return it.
  if (!insertError) {
    console.log('Event inserted successfully. ID:', newRow.id);
    return {
      success: true,
      id: newRow.id,
      status: newRow.status,
      row: newRow,
      duplicate: false
    };
  }

  // WHAT: Check if the error is a unique-constraint violation (code "23505").
  // WHY:  "23505" is the PostgreSQL error code for duplicate key. This means
  //       we have already received this exact event before — it is a duplicate.
  if (insertError.code === '23505') {
    console.log('Duplicate event detected. Idempotency key already exists:', idempotencyKey);

    // WHAT: Update the existing row — only refresh payload and updated_at.
    // WHY:  We intentionally do NOT reset status or attempt_count. The event
    //       was already processed; we are just acknowledging the re-delivery.
    const { data: updatedRow, error: updateError } = await supabase
      .from('events')
      .update({
        payload: parsedPayload,
        updated_at: new Date().toISOString(),
      })
      .eq('idempotency_key', idempotencyKey)
      .select()
      .single(); // WHAT: Return the single updated row object.
                 // WHY: We need the updated row to publish via SSE and read its id.

    // WHAT: If even the update fails, report it.
    // WHY: This is an edge case (e.g. row deleted between insert and update),
    //      but we handle it gracefully instead of crashing.
    if (updateError) {
      console.error('Failed to update duplicate event row:', updateError.message);
      return { success: false, errorCode: 'UPDATE_FAILED' };
    }

    console.log('Duplicate event row updated. Existing ID:', updatedRow.id);
    return {
      success: true,
      id: updatedRow.id,
      status: updatedRow.status,
      row: updatedRow,
      duplicate: true
    };
  }

  // WHAT: Any other database error we did not anticipate.
  // WHY:  Something unexpected went wrong — log it for debugging and signal failure.
  console.error('Unexpected database error while saving event:', insertError.message);
  return { success: false, errorCode: 'DB_ERROR' };
}


// ─── ROUTE HANDLER ─────────────────────────────────────────────────────────

// WHAT: This is the main function that Express calls when a POST arrives at /api/webhook.
// WHY:  It orchestrates the three steps: secret check → body parse → database save.
//       Keeping each step in its own function (above) makes the code easier to read
//       and test one piece at a time.
async function handleWebhook(req, res) {
  console.log('--- Incoming POST /api/webhook ---');

  // ── STEP 1: Secret check ─────────────────────────────────────────────────
  // WHAT: Verify the caller knows our shared secret before doing anything else.
  // WHY:  We check the secret FIRST — before reading or parsing the body — so
  //       unauthorized callers cannot make the server do any extra work.
  const isAuthorized = checkSecret(req);
  if (!isAuthorized) {
    console.log('Rejected unauthorized webhook request.');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  console.log('Secret check passed.');

  // ── STEP 2: Parse the raw body ───────────────────────────────────────────
  // WHAT: Convert the raw bytes Express gave us into a JavaScript object.
  // WHY:  express.raw() gives us a Buffer (raw bytes). We need to turn that
  //       into a string, then parse it as JSON so we can store it in Supabase.
  //       We wrap this in try/catch because JSON.parse throws on invalid input.

  // WHAT: Convert the Buffer to a UTF-8 string.
  // WHY:  req.body is a Buffer when express.raw() is used. toString() makes it
  //       a normal string we can call JSON.parse on.
  const rawBodyString = req.body.toString('utf8');

  let parsedPayload;
  try {
    parsedPayload = JSON.parse(rawBodyString);
  } catch (parseError) {
    // WHAT: JSON.parse threw — the body is not valid JSON.
    // WHY:  We cannot store malformed data. Tell the caller what went wrong.
    console.log('Body parsing failed. Raw body was not valid JSON.');
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Request body must be valid JSON.',
    });
  }

  // WHAT: Make sure the parsed result is a plain object, not an array or primitive.
  // WHY:  Our schema expects an object payload. Arrays, strings, numbers, etc.
  //       would break downstream processing.
  if (typeof parsedPayload !== 'object' || Array.isArray(parsedPayload) || parsedPayload === null) {
    console.log('Body parsing failed. Parsed JSON is not an object:', typeof parsedPayload);
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Request body must be a JSON object (not an array or primitive value).',
    });
  }
  console.log('Body parsed successfully. Keys:', Object.keys(parsedPayload).join(', ') || '(empty object)');

  // ── STEP 3: Work out the idempotency key ─────────────────────────────────
  // WHAT: Decide which unique key to use for this event.
  // WHY:  The idempotency key is what lets us detect if we have seen this
  //       exact event before and avoid creating duplicate database rows.
  const idempotencyKey = getIdempotencyKey(req, rawBodyString);
  console.log('Idempotency key resolved to:', idempotencyKey);

  // ── STEP 4: Save to the database ─────────────────────────────────────────
  // WHAT: Call saveEvent to insert or acknowledge a duplicate in Supabase.
  // WHY:  This is the main purpose of the endpoint — persist every webhook
  //       event so the dashboard can display them.
  const result = await saveEvent(idempotencyKey, parsedPayload);

  // WHAT: Check if saveEvent reported a failure.
  // WHY:  If something went wrong with the database we cannot give a useful
  //       response — send a generic 500 so we do not leak internal details.
  if (!result.success) {
    console.error('saveEvent failed with code:', result.errorCode);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Something went wrong while saving the event. Please try again.',
    });
  }

  // WHAT: Send the appropriate success response.
  // WHY:  201 = new event created. 200 = duplicate acknowledged. The "duplicate"
  //       flag lets the caller know which case occurred without guessing.
  if (result.duplicate) {
    // WHAT: Publish the updated row to all connected SSE clients.
    // WHY: Keeps all live dashboard displays updated when a duplicate delivery occurs.
    try {
      console.log('Publishing duplicate event update via SSE for ID:', result.id);
      publishEvent(result.row);
    } catch (publishErr) {
      console.error('Error publishing duplicate event via SSE:', publishErr.message);
    }

    console.log('Responding 200 — duplicate event acknowledged.');
    return res.status(200).json({
      id: result.id,
      status: result.status,
      duplicate: true,
    });
  }

  // WHAT: Publish the new event to all connected SSE clients right after insert and BEFORE runPipeline.
  // WHY: Immediately shows the event in "Received" state on all live dashboards.
  try {
    console.log('Publishing new event via SSE for ID:', result.id);
    publishEvent(result.row);
  } catch (publishErr) {
    console.error('Error publishing new event via SSE:', publishErr.message);
  }

  console.log('Responding 201 — new event saved.');
  res.status(201).json({
    id: result.id,
    status: result.status,
    duplicate: false,
  });

  // WHAT: Trigger the pipeline for the new event in the background.
  // WHY: We respond with 201 first so the caller does not wait for downstream HTTP calls.
  // We do NOT use await, and we add .catch to log any unexpected errors safely.
  // Notice: Duplicates (handled above) do NOT trigger this background pipeline.
  console.log('Triggering background pipeline for new event ID:', result.id);
  runPipeline(result.id).catch((pipelineError) => {
    console.error('Background pipeline error for event ' + result.id + ':', pipelineError.message);
  });
  return;
}


// WHAT: Export the route handler so index.js can register it on the Express app.
// WHY:  Keeping routing registration in index.js keeps this file focused on logic only.
module.exports = { handleWebhook };
