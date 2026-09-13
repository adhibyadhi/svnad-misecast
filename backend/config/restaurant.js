import "./defaults.js";
/**
 * Validates restaurant identity and timezone configuration.
 *
 * Values are loaded through Node's --env-file option.
 * No location or timezone is inferred from the computer.
 */

function readRequiredSetting(settingName) {
  const value = process.env[settingName];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${settingName} is required.`);
  }

  return value.trim();
}

const restaurantId = readRequiredSetting("RESTAURANT_ID");

if (restaurantId === "REPLACE_WITH_SOURCE_RESTAURANT_ID") {
  throw new Error(
    "Set RESTAURANT_ID to the identifier used in your source data.",
  );
}

const timezone = readRequiredSetting("RESTAURANT_TIMEZONE");

try {
  new Intl.DateTimeFormat("en", {
    timeZone: timezone,
  }).format(new Date());
} catch {
  throw new Error("RESTAURANT_TIMEZONE must be a valid timezone.");
}

export const restaurant = Object.freeze({
  restaurantId,
  timezone,
});
