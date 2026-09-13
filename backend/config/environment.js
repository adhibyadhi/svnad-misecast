/**
 * Validates environment variables loaded by Node.
 *
 * Start the application with:
 * node --env-file=.env server.js
 */

/**
 * Reads a required, non-empty environment variable.
 */

import "./defaults.js";

function readRequiredVariable(variableName) {
  const value = process.env[variableName];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${variableName} is required.`);
  }

  return value.trim();
}

/**
 * Reads a whole-number port between 1 and 65535.
 */
function readPort() {
  const portText = readRequiredVariable("PORT");

  if (!/^\d+$/.test(portText)) {
    throw new Error("PORT must be a whole number between 1 and 65535.");
  }

  const port = Number(portText);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a whole number between 1 and 65535.");
  }

  return port;
}

const host = readRequiredVariable("HOST");

if (!["127.0.0.1", "::1"].includes(host)) {
  throw new Error("HOST must be 127.0.0.1 or ::1 for the local application.");
}

const mongodbUri = readRequiredVariable("MONGODB_URI");

if (
  !mongodbUri.startsWith("mongodb://") &&
  !mongodbUri.startsWith("mongodb+srv://")
) {
  throw new Error("MONGODB_URI must start with mongodb:// or mongodb+srv://.");
}

export const environment = Object.freeze({
  host,
  port: readPort(),
  mongodbUri,
});
