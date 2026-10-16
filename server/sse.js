// WHAT: Array holding all open HTTP response objects for connected SSE clients.
// WHY: Server-Sent Events (SSE) is a persistent, one-way HTTP connection. The server
// keeps the response stream open and pushes new lines whenever an event occurs.
// Storing all active response objects in an array lets us broadcast messages to everyone.
const clients = [];

// WHAT: Add a new client response object to our list of active listeners.
// WHY: Called whenever a browser connects to GET /api/stream.
function addClient(res) {
  // Push the client's HTTP response object into our tracking array.
  clients.push(res);
  console.log('SSE client connected. Total connected clients:', clients.length);
}

// WHAT: Remove a client response object from our active listeners list.
// WHY: When a user closes their browser tab or navigates away, the socket closes.
// We must remove their response object so we do not waste memory or try writing to a dead socket.
function removeClient(res) {
  // Find the position of the disconnected response object in our array.
  const index = clients.indexOf(res);
  if (index !== -1) {
    // Remove exactly one item at that index.
    clients.splice(index, 1);
  }
  console.log('SSE client disconnected. Total connected clients:', clients.length);
}

// WHAT: Broadcast a named SSE event and JSON payload to every connected client.
// WHY: This is how we notify all dashboards of event status changes in real time.
// We loop through clients with a plain for loop and wrap each write in try/catch
// so that an error on one client connection cannot interrupt the loop or crash the server.
function broadcast(eventName, data) {
  console.log('Broadcasting SSE event "' + eventName + '" to ' + clients.length + ' client(s)...');

  // WHAT: Construct the standard SSE message format.
  // WHY: The Server-Sent Events standard requires:
  //   event: <eventName>\n
  //   data: <payloadJson>\n\n
  // The two newlines (\n\n) at the end signal to the browser that this message is complete.
  const message = 'event: ' + eventName + '\ndata: ' + JSON.stringify(data) + '\n\n';

  // Use a plain for loop to send the message to each client individually.
  for (let i = 0; i < clients.length; i++) {
    try {
      clients[i].write(message);
    } catch (err) {
      // WHAT: Log the error and move on to the next client.
      // WHY: A failed write to one client must NEVER stop messages to other clients or crash Node.
      console.error('Failed to write SSE event to client #' + i + ':', err.message);
    }
  }
}

// WHAT: Send a comment heartbeat ping every 25 seconds.
// WHY: Network firewalls, cloud load balancers, and reverse proxies often drop idle HTTP connections.
// In the SSE protocol, any line starting with a colon (:) is a comment line.
// Sending ": ping\n\n" keeps the underlying TCP/HTTP connection active without triggering browser events.
setInterval(() => {
  for (let i = 0; i < clients.length; i++) {
    try {
      clients[i].write(': ping\n\n');
    } catch (err) {
      console.error('Failed to send heartbeat ping to client #' + i + ':', err.message);
    }
  }
}, 25000);

// WHAT: Whitelist and publish public event fields over SSE.
// WHY: CRITICAL SECURITY RULE: Public dashboards must ONLY receive id, created_at, status,
// and attempt_count. We must NEVER publish payload or failure_reason to public streams.
function publishEvent(row) {
  if (!row) {
    console.log('publishEvent called with empty row. Skipping.');
    return;
  }

  // WHAT: Build an object with strictly ONLY the 4 permitted public fields.
  // WHY: Prevents sensitive payload data or private failure details from reaching public listeners.
  const publicSummary = {
    id: row.id,
    created_at: row.created_at,
    status: row.status,
    attempt_count: row.attempt_count
  };

  console.log('Publishing SSE event-update for Event ID:', publicSummary.id, 'Status:', publicSummary.status);
  broadcast('event-update', publicSummary);
}

// WHAT: Export the functions for use across the application.
// WHY: Routes will register/remove clients, while the webhook and pipeline will publish updates.
module.exports = {
  addClient,
  removeClient,
  broadcast,
  publishEvent
};
