/**
 * Checks the running HTTP application.
 *
 * Start the application in another terminal first.
 *
 * Run:
 * node --env-file=.env scripts/checkApplication.js
 */

import assert from "node:assert/strict";
import { environment } from "../config/environment.js";

const urlHost = environment.host === "::1" ? "[::1]" : environment.host;

const baseUrl = `http://${urlHost}:${environment.port}`;

/**
 * Sends a request with a timeout so checks cannot wait indefinitely.
 */
function sendRequest(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
}

/**
 * Confirms the expected API error status and code.
 */
async function expectApiError(path, options, statusCode, errorCode) {
  const response = await sendRequest(path, options);

  assert.equal(response.status, statusCode);

  const body = await response.json();
  assert.equal(body.error.code, errorCode);
}

try {
  // Home page renders through EJS.
  const homeResponse = await sendRequest("/");
  assert.equal(homeResponse.status, 200);
  assert.match(homeResponse.headers.get("content-type") || "", /text\/html/);

  const homeHtml = await homeResponse.text();
  assert.ok(homeHtml.includes("Welcome to MiseCast"));
  assert.ok(homeHtml.includes("/vendor/bootstrap/css/bootstrap.min.css"));

  // Bootstrap is available from this application.
  const bootstrapResponse = await sendRequest(
    "/vendor/bootstrap/css/bootstrap.min.css",
  );

  assert.equal(bootstrapResponse.status, 200);
  assert.match(
    bootstrapResponse.headers.get("content-type") || "",
    /text\/css/,
  );
  await bootstrapResponse.arrayBuffer();

  // Browser missing routes return the error page.
  const missingPageResponse = await sendRequest(
    "/__application_check_missing__",
  );

  assert.equal(missingPageResponse.status, 404);
  assert.ok((await missingPageResponse.text()).includes("Page not found"));

  // API missing routes return structured JSON.
  await expectApiError(
    "/api/__application_check_missing__",
    {},
    404,
    "NOT_FOUND",
  );

  // Cross-origin mutations are rejected.
  await expectApiError(
    "/api/__application_check_missing__",
    {
      method: "POST",
      headers: {
        Origin: "https://example.com",
      },
    },
    403,
    "REQUEST_ORIGIN_REJECTED",
  );

  // A mutation without Origin or a client marker is rejected.
  await expectApiError(
    "/api/__application_check_missing__",
    { method: "POST" },
    403,
    "REQUEST_ORIGIN_REJECTED",
  );

  // The explicit script marker passes origin protection.
  // The route still returns 404 because it does not exist.
  await expectApiError(
    "/api/__application_check_missing__",
    {
      method: "POST",
      headers: {
        "X-MiseCast-Request": "1",
      },
    },
    404,
    "NOT_FOUND",
  );

  // Same-origin requests also pass origin protection.
  await expectApiError(
    "/api/__application_check_missing__",
    {
      method: "POST",
      headers: {
        Origin: baseUrl,
      },
    },
    404,
    "NOT_FOUND",
  );

  // Invalid JSON gets a 400 response after passing origin protection.
  await expectApiError(
    "/api/__application_check_missing__",
    {
      method: "POST",
      headers: {
        "X-MiseCast-Request": "1",
        "Content-Type": "application/json",
      },
      body: '{"unfinished":',
    },
    400,
    "INVALID_JSON",
  );

  console.log("Application checks passed.");
} catch (error) {
  console.error("Application checks failed:", error.message);
  process.exitCode = 1;
}
