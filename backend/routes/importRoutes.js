/**
 * Import API routes.
 *
 * Must be mounted before the application's general JSON parser
 * so uploads retain their original bytes.
 */

import express from "express";
import { importLimits } from "../config/importLimits.js";
import {
  createImport,
  getImportStatus,
  getImportErrors,
} from "../controllers/importController.js";

const router = express.Router();

// Status responses should reflect current job progress.
router.use((request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});

router.get("/jobs/:importJobId", getImportStatus);
router.get("/jobs/:importJobId/errors", getImportErrors);

router.post(
  "/:entityName",

  (request, response, next) => {
    if (!request.is("application/json") && !request.is("text/csv")) {
      return response.status(415).json({
        error: {
          code: "UNSUPPORTED_IMPORT_TYPE",
          message: "Use Content-Type: application/json or text/csv.",
        },
      });
    }

    next();
  },

  express.raw({
    type: ["application/json", "text/csv"],
    limit: importLimits.maximumFileBytes,
    inflate: false,
  }),

  (request, response, next) => {
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      return response.status(400).json({
        error: {
          code: "EMPTY_IMPORT",
          message: "The request must contain the original file contents.",
        },
      });
    }

    next();
  },

  createImport,
);

export default router;
