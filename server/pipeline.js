// WHAT: Import our Supabase client instance.
// WHY: The pipeline needs database access to load the event payload and update its status.
const { supabase } = require('./supabase');

// WHAT: Import publishEvent from sse.js.
// WHY: Broadcasts the final processing status (Completed or Failed) to connected SSE dashboards.
const { publishEvent } = require('./sse');

// WHAT: Main pipeline function that processes an event after it has been received.
// WHY: EventBridge stores incoming webhooks first, then runs this pipeline in the background.
// This decouples receiving webhooks from delivering them to downstream consumers.
//
// Rules enforced:
//   - Wrapped in try/catch so it NEVER throws an unhandled error to the server.
//   - Uses a 5-second timeout on the downstream fetch.
//   - Updates status to 'Completed' on 2xx responses, or 'Failed' with reason otherwise.
//   - Increments attempt_count in both success and failure cases.
async function runPipeline(eventId) {
  try {
    console.log('=== Starting Pipeline for Event ID:', eventId, '===');

    // ─── STEP 1: LOAD EVENT ROW FROM DATABASE ──────────────────────────────
    // WHAT: Query Supabase for the event row matching this eventId.
    // WHY: We need the stored payload to forward it, and the current attempt_count.
    console.log('Pipeline Step 1: Loading event from database for ID:', eventId);

    const { data: eventRow, error: fetchError } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (fetchError || !eventRow) {
      console.log('Pipeline: event no longer exists for ID:', eventId, 'Stopping pipeline.');
      return;
    }

    console.log('Pipeline Step 1 complete: Found event. Current attempt count:', eventRow.attempt_count);


    // ─── STEP 2 & 3: CALL DOWNSTREAM SERVICE & DECIDE RESULT ───────────────
    // WHAT: Forward the event's stored payload to the downstream service using an HTTP POST.
    // WHY: This is the core delivery step that hands the event over to the external service.
    // We enforce a strict 5-second timeout so a hung third-party doesn't hold open resources.

    // WHAT: Resolve the downstream target URL dynamically at call time.
    // WHY: On Render the app calls its own dummy downstream (/api/mock-downstream) when deployed
    // as a single unified service. If DOWNSTREAM_URL is empty or missing, we fall back to
    // "http://127.0.0.1:" + (process.env.PORT || 3000) + "/api/mock-downstream".
    const port = process.env.PORT || 3000;
    const defaultDownstreamUrl = 'http://127.0.0.1:' + port + '/api/mock-downstream';
    const downstreamUrl = (process.env.DOWNSTREAM_URL && process.env.DOWNSTREAM_URL.trim())
      ? process.env.DOWNSTREAM_URL.trim()
      : defaultDownstreamUrl;

    console.log('Pipeline Step 2: Calling downstream URL:', downstreamUrl);

    let isSuccess = false;
    let failureReason = null;

    try {
      // WHAT: Make the HTTP POST request with AbortSignal.timeout(5000).
      // WHY: If the downstream service does not respond within 5000 milliseconds (5 seconds),
      // fetch automatically aborts with a TimeoutError instead of hanging forever.
      const response = await fetch(downstreamUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(eventRow.payload),
        signal: AbortSignal.timeout(5000)
      });

      console.log('Pipeline Step 3: Deciding result based on downstream HTTP status...');

      // WHAT: Check if the downstream server replied with a 2xx success code.
      // WHY: response.ok is true for HTTP statuses 200 through 299.
      if (response.ok) {
        isSuccess = true;
        failureReason = null;
        console.log('Downstream call succeeded! HTTP status:', response.status);
      } else {
        isSuccess = false;
        failureReason = 'Downstream returned status ' + response.status;
        console.log('Downstream call failed. HTTP status:', response.status);
      }
    } catch (fetchError) {
      // WHAT: Catch network errors, connection refused, DNS issues, or 5-second timeouts.
      // WHY: Network calls are inherently fragile. Catching errors here keeps the server stable
      // and records a descriptive failure reason for the dashboard.
      isSuccess = false;
      failureReason = 'Downstream call failed: ' + fetchError.message;
      console.log('Downstream fetch threw an error:', fetchError.message);
    }


    // ─── STEP 4: UPDATE THE DATABASE ROW ───────────────────────────────────
    // WHAT: Update status, failure_reason, attempt_count, and updated_at in Supabase.
    // WHY: The dashboard and retry system rely on the database having the latest status.
    console.log('Pipeline Step 4: Updating event row in database...');

    const newStatus = isSuccess ? 'Completed' : 'Failed';
    const newAttemptCount = (eventRow.attempt_count || 0) + 1;
    const nowIsoString = new Date().toISOString();

    const { data: updatedRows, error: updateError } = await supabase
      .from('events')
      .update({
        status: newStatus,
        failure_reason: isSuccess ? null : failureReason,
        attempt_count: newAttemptCount,
        updated_at: nowIsoString
      })
      .eq('id', eventId)
      .select();

    if (updateError) {
      console.error(
        'Pipeline Step 4 failed: Could not update event in database:',
        updateError.message
      );
      return;
    }

    // WHAT: Check if the row was deleted while downstream was running.
    // WHY: Rule: If the row was deleted (e.g. by clear-events), log "event no longer exists" and stop with no publish and no throw.
    if (!updatedRows || updatedRows.length === 0) {
      console.log('Pipeline: event no longer exists. Event ID ' + eventId + ' was deleted during processing. Stopping.');
      return;
    }

    const updatedRow = updatedRows[0];

    console.log(
      '=== Pipeline Finished for Event ' + eventId + ' ===',
      'Final Status:', newStatus,
      'Attempts:', newAttemptCount
    );

    // WHAT: Broadcast the updated event row to all connected SSE clients.
    // WHY: Keeps the dashboard live in real time as events complete or fail.
    // RULE: "Never throws" rule: any publishing error must be caught and only logged.
    try {
      console.log('Pipeline Step 4: Publishing final status via SSE for Event ID:', eventId);
      publishEvent(updatedRow);
    } catch (publishErr) {
      console.error('Error publishing event update in pipeline:', publishErr.message);
    }

  } catch (unexpectedError) {
    // WHAT: Global safety net around the entire function.
    // WHY: Absolute rule: this function must NEVER throw an unhandled exception or crash Node.
    console.error(
      'Unexpected error occurred in runPipeline for event ' + eventId + ':',
      unexpectedError.message
    );
  }
}

// WHAT: Export runPipeline so webhook.js and future retry endpoints can invoke it.
// WHY: Keeping the pipeline isolated in its own file makes it reusable across both
// immediate webhook processing and manual user retries.
module.exports = {
  runPipeline
};
