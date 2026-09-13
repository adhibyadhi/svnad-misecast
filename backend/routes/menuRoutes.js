import express from "express";
import {
  showMenuList,
  showMenuDetails,
  showNewMenuForm,
  submitNewMenuItem,
  showNewVariantForm,
  submitNewVariant,
  showEditMenuForm,
  submitMenuEdit,
} from "../controllers/menuController.js";

const router = express.Router();

router.get("/", showMenuList);
router.get("/new", showNewMenuForm);
router.post("/", submitNewMenuItem);

router.get("/:menuItemId/edit", showEditMenuForm);
router.post("/:menuItemId/edit", submitMenuEdit);

router.get("/:menuItemId/variants/new", showNewVariantForm);
router.post("/:menuItemId/variants", submitNewVariant);

router.get("/:menuItemId", showMenuDetails);

export default router;
