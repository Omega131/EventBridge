// WHAT: Load environment variables from the server/.env file using dotenv.
// WHY: We want to configure server settings (like PORT and Supabase secrets)
// without hardcoding sensitive or environment-specific values in our code.
const dotenv = require('dotenv');
dotenv.config();

// WHAT: Import the Express library.
// WHY: Express is a minimal Node.js framework that makes it easy to handle HTTP requests
// and build REST APIs for our web application.
const express = require('express');

// WHAT: Import the Supabase connection test function from our supabase.js file.
// WHY: We want to test our database connection right when the backend server launches.
const { testSupabaseConnection } = require('./supabase');

// WHAT: Create an instance of an Express application.
// WHY: The "app" object is where we register our API routes and middleware.
const app = express();

// WHAT: Add built-in middleware to automatically parse incoming JSON payloads.
// WHY: Later on, webhooks and frontend requests will send data in JSON format,
// so this makes request bodies available under req.body.
app.use(express.json());

// WHAT: Define a GET route at "/api/health".
// WHY: A health check endpoint is a standard best practice to verify that the server is alive
// and able to respond to HTTP requests without touching the database.
app.get('/api/health', (req, res) => {
  console.log('Received GET request on /api/health');

  // Send back a simple JSON object indicating status is ok
  res.json({ status: 'ok' });
});

// WHAT: Determine which port the server should listen on.
// WHY: In production or local environments, PORT can be set via environment variables.
// If no PORT is set, we fallback to port 3000 as the default.
const PORT = process.env.PORT || 3000;

// WHAT: Start the Express server and begin listening for incoming network requests.
// WHY: This keeps our Node process running in the background waiting for HTTP traffic.
app.listen(PORT, () => {
  console.log('====================================================');
  console.log('EventBridge Express server is running on port ' + PORT);
  console.log('Health check route: http://localhost:' + PORT + '/api/health');
  console.log('====================================================');

  // WHAT: Test the Supabase connection once when the server starts.
  // WHY: Immediately tells the developer whether the database configuration is working.
  testSupabaseConnection();
});
