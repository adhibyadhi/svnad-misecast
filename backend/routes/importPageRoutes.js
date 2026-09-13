import { Router } from "express";
import { listImportOptions } from "../services/imports/importRegistry.js";
import { importLimits } from "../config/importLimits.js";

const router = Router();

router.get("/", (req, res) => {
  res.set("Cache-Control", "no-store");

  res.render("imports/index", {
    pageTitle: "Import data",
    importOptions: listImportOptions(),
    maximumFileBytes: importLimits.maximumFileBytes,
  });
});

export default router;
