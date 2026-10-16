// WHAT: Import our Supabase database client from supabase.js.
// WHY: We need database access to read and update persistent key-value configuration in the "settings" table.
const { supabase } = require('./supabase');

// WHAT: Read a single configuration setting by key from the "settings" table.
// WHY: Used to check runtime flags (like whether mock_healthy is "true" or "false")
// from the database instead of keeping them in transient server memory.
// Throws an Error if the setting row is missing or if the database returns an error.
async function getSetting(key) {
  console.log('Reading setting from database for key:', key);

  // WHAT: Query the "settings" table for the row matching this key.
  // WHY: .single() ensures we get exactly one object back or an error if not found.
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .single();

  // WHAT: Check if Supabase returned an error or if no data came back.
  // WHY: The requirement specifies: "throws an Error if the row is missing or the database call fails".
  if (error) {
    console.error('Database error in getSetting for key "' + key + '":', error.message);
    throw new Error('Could not read setting "' + key + '": ' + error.message);
  }

  if (!data) {
    console.error('Setting not found in database for key:', key);
    throw new Error('Setting not found for key: ' + key);
  }

  console.log('Successfully read setting "' + key + '" = "' + data.value + '"');
  return data.value;
}

// WHAT: Update a setting's value and refreshed updated_at timestamp in the "settings" table.
// WHY: Allows administrative endpoints to change configuration (like toggling mock downstream health).
// Throws an Error on failure.
async function setSetting(key, value) {
  const valueString = String(value);
  const nowIsoString = new Date().toISOString();
  console.log('Updating setting in database for key "' + key + '" to "' + valueString + '"...');

  // WHAT: Perform an UPDATE on the settings table matching the key.
  // WHY: Persists the new value string and updates updated_at so we know when it changed.
  const { data, error } = await supabase
    .from('settings')
    .update({
      value: valueString,
      updated_at: nowIsoString
    })
    .eq('key', key)
    .select()
    .single();

  // WHAT: Check if the update succeeded.
  // WHY: The requirement specifies: "throws on failure".
  if (error) {
    console.error('Database error in setSetting for key "' + key + '":', error.message);
    throw new Error('Could not update setting "' + key + '": ' + error.message);
  }

  if (!data) {
    console.error('No setting row found to update for key:', key);
    throw new Error('Setting row not found for key: ' + key);
  }

  console.log('Successfully updated setting "' + key + '" to "' + data.value + '"');
  return data.value;
}

// WHAT: Export the functions so other server files can read and update settings.
// WHY: Used by mockDownstream.js and administrative scripts.
module.exports = {
  getSetting,
  setSetting
};
