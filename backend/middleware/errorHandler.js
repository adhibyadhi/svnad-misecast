/**
 * Handles errors not already handled
 * by individual routes.
 */

export default function errorHandler(error, req, res, next) {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    error: "Something went wrong.",
  });
}
