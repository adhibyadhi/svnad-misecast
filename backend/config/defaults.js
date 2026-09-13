/**
 * Local development defaults.
 *
 * Existing environment variables and .env values take precedence.
 * No API keys or restaurant data are stored here.
 */

const defaults = {
  HOST: "127.0.0.1",
  PORT: "3000",
  MONGODB_URI: "mongodb://localhost:27017/misecast",
  RESTAURANT_ID: "0001",
  RESTAURANT_TIMEZONE: "Australia/Melbourne",
  RESTAURANT_STATE: "VIC",
  RESTAURANT_LATITUDE: "-37.8136",
  RESTAURANT_LONGITUDE: "144.9631",
  EVENT_SEARCH_RADIUS_KM: "5",
};

for (const [name, value] of Object.entries(defaults)) {
  if (process.env[name] === undefined) {
    process.env[name] = value;
  }
}
