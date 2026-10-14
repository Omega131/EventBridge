// WHAT: Load the dotenv package and read the .env file.
// WHY: We need access to secret variables like SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// from the environment without hardcoding them in our code.
const dotenv = require('dotenv');
dotenv.config();

// WHAT: Import createClient from the official Supabase JavaScript library.
// WHY: createClient is the function that initializes and manages the connection to Supabase.
const { createClient } = require('@supabase/supabase-js');

// WHAT: Read the Supabase credentials from environment variables.
// WHY: Keeping secrets in process.env keeps them secure and easily configurable across environments.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// WHAT: Initialize the Supabase client using our project URL and service role key.
// WHY: This client object will be used by our backend to run queries against PostgreSQL.
// Note: We use placeholder fallbacks if .env is missing so createClient does not crash on startup.
const supabase = createClient(
  supabaseUrl || 'https://placeholder-project.supabase.co',
  supabaseServiceRoleKey || 'placeholder-service-role-key'
);

// WHAT: A plain, simple function to test if we can reach the Supabase database.
// WHY: When the server starts up, calling this function provides instant feedback in the terminal
// telling us whether our database connection succeeded or if there is an error.
async function testSupabaseConnection() {
  console.log('Attempting to connect to Supabase...');

  // WHAT: Check if the required environment variables are configured.
  // WHY: If .env is missing or keys are not provided, print a clear error without crashing.
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Supabase connection error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set in server/.env');
    return;
  }

  try {
    // WHAT: Query the "events" table and limit the result to just 1 row.
    // WHY: A small read query is the fastest and safest way to confirm our table and credentials work.
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .limit(1);

    // WHAT: Check if Supabase returned an error.
    // WHY: If the table does not exist yet or the key is invalid, Supabase returns an error object.
    if (error) {
      console.error('Supabase connection error:', error.message);
      return;
    }

    // WHAT: Print success confirmation.
    // WHY: Confirms that the connection to Supabase succeeded.
    console.log('Supabase connected');
  } catch (err) {
    // WHAT: Catch any unexpected JavaScript or network errors.
    // WHY: Prevents the server from crashing and displays what went wrong.
    console.error('Supabase connection error:', err.message);
  }
}

// WHAT: Export the Supabase client and connection test function.
// WHY: Other files (like server/index.js) can import and use them.
module.exports = {
  supabase,
  testSupabaseConnection
};
