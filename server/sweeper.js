// WHAT: Import our Supabase database client.
// WHY: We need to query and update stale event records in the "events" table.
const { supabase } = require('./supabase');

// WHAT: Import publishEvent from sse.js.
// WHY: Broadcasts the updated "Failed" status to connected dashboards in real time.
const { publishEvent } = require('./sse');

// WHAT: The age threshold in seconds after which an event in "Received" status is considered abandoned.
// WHY: Normal pipeline deliveries finish within a few seconds (5-second timeout on fetch).
// If an event remains in "Received" state for longer than 60 seconds, the server process that
// accepted it must have crashed, restarted, or timed out before completing the pipeline.
const STALE_AFTER_SECONDS = 60;

// WHAT: Sweep the database for events stuck in "Received" and transition them to "Failed".
// WHY: Background pipeline execution happens in Node process memory. If the server crashes or restarts
// while an event is being processed or retried, that event would remain stuck in "Received" forever.
// This sweeper detects abandoned events and returns them to "Failed" with a clear diagnostic message.
//
// CRITICAL ARCHITECTURAL DECISION:
// WHY we do NOT run the pipeline automatically for swept events:
// If the server crashed while the downstream call was in flight, the external downstream service
// may have already received and executed the action (for example, charging a credit card or creating an order).
// Automatically re-running the delivery pipeline could duplicate external side effects!
// Instead, we mark the event as "Failed" so a human administrator can inspect the event on the dashboard
// and decide whether it is safe to click Retry.
async function sweepStaleEvents() {
  try {
    // WHAT: Calculate the cutoff timestamp (current time minus 60 seconds).
    // WHY: Any event whose updated_at is older than this cutoff is considered stale.
    const cutoffDate = new Date(Date.now() - STALE_AFTER_SECONDS * 1000);
    const cutoffIsoString = cutoffDate.toISOString();
    const nowIsoString = new Date().toISOString();

    // WHAT: Perform ONE atomic conditional update in Supabase.
    // WHERE status = 'Received' AND updated_at < cutoff.
    // SET status = 'Failed', failure_reason = '...', updated_at = now.
    // Chain .select() to get back all changed rows.
    // RULE: We do NOT change attempt_count.
    const { data: sweptRows, error } = await supabase
      .from('events')
      .update({
        status: 'Failed',
        failure_reason: 'Processing was interrupted (server restarted or timed out). Press Retry to run it again.',
        updated_at: nowIsoString
      })
      .eq('status', 'Received')
      .lt('updated_at', cutoffIsoString)
      .select();

    // WHAT: Handle database errors gracefully.
    // WHY: A database connectivity blip must never crash the background sweeper or server.
    if (error) {
      console.error('Sweeper: Database error while checking for stale events:', error.message);
      return;
    }

    // WHAT: Check if any stale events were found and updated.
    // WHY: The requirement specifies: "Log how many events were swept, only when the number is above zero."
    if (sweptRows && sweptRows.length > 0) {
      console.log('Sweeper: Swept ' + sweptRows.length + ' stale event(s) to Failed.');

      // WHAT: Loop through each swept row using a plain for loop and broadcast the update over SSE.
      // WHY: Connected browser dashboards immediately reflect the transition from Received to Failed.
      for (let i = 0; i < sweptRows.length; i++) {
        const row = sweptRows[i];
        try {
          console.log('Sweeper: Publishing status update for swept event ID:', row.id);
          publishEvent(row);
        } catch (publishErr) {
          // Log and continue loop so one client write error doesn't stop others
          console.error('Sweeper: Error publishing swept event ID ' + row.id + ':', publishErr.message);
        }
      }
    }

  } catch (err) {
    // WHAT: Global catch block around the sweeper.
    // WHY: Rule: "Wrap everything in try/catch so it never throws."
    console.error('Sweeper: Unexpected error in sweepStaleEvents:', err.message);
  }
}

// WHAT: Start the background sweeper timer.
// WHY: Runs sweepStaleEvents once immediately at server startup to catch any events that were
// in-flight when the server previously shut down, and then runs every 30 seconds thereafter.
function startSweeper() {
  console.log('Starting background event sweeper (interval: 30s, stale threshold: ' + STALE_AFTER_SECONDS + 's)...');

  // Run once immediately on startup
  sweepStaleEvents();

  // Schedule to run every 30 seconds
  setInterval(sweepStaleEvents, 30000);
}

// WHAT: Export the functions and the threshold constant.
// WHY: index.js calls startSweeper on startup, and test suites can invoke sweepStaleEvents directly.
module.exports = {
  sweepStaleEvents,
  startSweeper,
  STALE_AFTER_SECONDS
};
