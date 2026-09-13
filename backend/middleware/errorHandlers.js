import { RequestValidationError } from "../utils/requestValidation.js";
import { RequestOriginError } from "./requestOrigin.js";
/**
 * Shared missing-route and error handlers.
 *
 * API routes return JSON.
 * Browser routes render the shared error page.
 */

/**
 * Determines whether a request targets the API namespace.
 */
function isApiRequest(request) {
  return request.path === "/api" || request.path.startsWith("/api/");
}

/**
 * Sends a consistent JSON or HTML error response.
 */
function sendErrorResponse(
  request,
  response,
  { statusCode, errorCode, pageTitle, message },
) {
  if (isApiRequest(request)) {
    return response.status(statusCode).json({
      error: {
        code: errorCode,
        message,
      },
    });
  }

  return response.status(statusCode).render("error", {
    pageTitle,
    statusCode,
    message,
  });
}

/**
 * Handles requests that did not match an application route.
 */
export function notFoundHandler(request, response) {
  return sendErrorResponse(request, response, {
    statusCode: 404,
    errorCode: "NOT_FOUND",
    pageTitle: "Page not found",
    message: "The requested resource could not be found.",
  });
}

/**
 * Handles errors forwarded by Express.
 */
export function errorHandler(error, request, response, next) {
  if (response.headersSent) {
    return next(error);
  }

  let statusCode = 500;
  let errorCode = "INTERNAL_ERROR";
  let pageTitle = "Something went wrong";
  let message = "We could not complete your request. Please try again.";

  if (error instanceof RequestOriginError) {
    statusCode = 403;
    errorCode = "REQUEST_ORIGIN_REJECTED";
    pageTitle = "Request not permitted";
    message = error.message;
  } else if (error instanceof RequestValidationError) {
    statusCode = 400;
    errorCode = "INVALID_REQUEST";
    pageTitle = "Invalid request";
    message = error.message;
  } else if (error.type === "entity.parse.failed") {
    statusCode = 400;
    errorCode = "INVALID_JSON";
    pageTitle = "Invalid request";
    message = "The request body contains invalid JSON.";
  } else if (
    error.type === "entity.too.large" ||
    error.type === "parameters.too.many"
  ) {
    statusCode = 413;
    errorCode = "REQUEST_TOO_LARGE";
    pageTitle = "Request too large";
    message = "The request exceeds the allowed size.";
  } else if (
    error.type === "charset.unsupported" ||
    error.type === "encoding.unsupported"
  ) {
    statusCode = 415;
    errorCode = "UNSUPPORTED_ENCODING";
    pageTitle = "Unsupported request encoding";
    message = "The request uses an unsupported character set or encoding.";
  }

  if (statusCode === 500) {
    // Avoid logging request bodies or potentially sensitive error messages.
    console.error("Unhandled request error:", error.name);
  }

  return sendErrorResponse(request, response, {
    statusCode,
    errorCode,
    pageTitle,
    message,
  });
}
