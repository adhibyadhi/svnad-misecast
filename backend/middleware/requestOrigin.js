/**
 * Protects the local application against unexpected browser origins.
 *
 * Browser mutations must come from the configured application origin.
 * Non-browser clients without Origin must send:
 * X-MiseCast-Request: 1
 *
 * This is request-origin protection, not user authentication.
 */

export class RequestOriginError extends Error {
  constructor(message) {
    super(message);
    this.name = "RequestOriginError";
  }
}

/**
 * Builds middleware for the application's fixed local address.
 */
export function createRequestOriginGuard({ host, port }) {
  const urlHost = host === "::1" ? "[::1]" : host;
  const expectedUrl = new URL(`http://${urlHost}:${port}`);
  const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

  return function requestOriginGuard(request, response, next) {
    const requestHost = request.get("host");

    // Reject unexpected Host values, including arbitrary domain names.
    if (
      typeof requestHost !== "string" ||
      requestHost.toLowerCase() !== expectedUrl.host.toLowerCase()
    ) {
      return next(
        new RequestOriginError("The request uses an unsupported host."),
      );
    }

    if (safeMethods.has(request.method)) {
      return next();
    }

    const origin = request.get("origin");

    // When Origin is supplied, it must match exactly.
    if (origin !== undefined) {
      if (origin !== expectedUrl.origin) {
        return next(
          new RequestOriginError(
            "This request must come from the MiseCast application.",
          ),
        );
      }

      return next();
    }

    // Reject cross-site browser requests even if they lack Origin.
    if (request.get("sec-fetch-site") === "cross-site") {
      return next(
        new RequestOriginError("Cross-site changes are not permitted."),
      );
    }

    // Explicit marker for clients such as Postman and import scripts.
    if (request.get("x-misecast-request") !== "1") {
      return next(
        new RequestOriginError(
          "Requests without Origin must include X-MiseCast-Request: 1.",
        ),
      );
    }

    return next();
  };
}
