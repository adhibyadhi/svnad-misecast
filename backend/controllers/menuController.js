/**
 * Renders menu-management pages.
 */

import { listMenuItems, getMenuItemDetails } from "../services/menuService.js";
import { createMenuItem } from "../services/createMenuItem.js";
import { RequestValidationError } from "../utils/requestValidation.js";
import { createMenuVariant } from "../services/createMenuVariant.js";
import {
  menuEditFields,
  getMenuEditData,
  updateMenuItem,
} from "../services/editMenuItem.js";
/**
 * Builds pagination links while preserving the current filter.
 */
function buildPageUrl(page, pageSize, activeFilter) {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    active: activeFilter,
  });

  return `/menus?${query.toString()}`;
}

export async function showMenuList(request, response) {
  const result = await listMenuItems(request.query);
  const { pagination, activeFilter } = result;

  const previousPage = Math.max(
    1,
    Math.min(pagination.page - 1, pagination.totalPages),
  );

  return response.render("menus/index", {
    pageTitle: "Menu items",
    ...result,

    firstPageUrl: buildPageUrl(1, pagination.pageSize, activeFilter),

    previousPageUrl: pagination.hasPreviousPage
      ? buildPageUrl(previousPage, pagination.pageSize, activeFilter)
      : null,

    nextPageUrl: pagination.hasNextPage
      ? buildPageUrl(pagination.page + 1, pagination.pageSize, activeFilter)
      : null,
  });
}

/**
 * Shows a parent menu item and its linked variants.
 */
export async function showMenuDetails(request, response) {
  const details = await getMenuItemDetails(request.params.menuItemId);

  if (!details) {
    return response.status(404).render("error", {
      pageTitle: "Menu item not found",
      statusCode: 404,
      message: "The requested menu item could not be found.",
    });
  }

  return response.render("menus/show", {
    pageTitle: details.item.name,
    ...details,
  });
}

/**
 * Returns safe text values for displaying the form.
 *
 * Unexpected objects and arrays are not rendered back into inputs.
 */
function getMenuFormValues(input = {}) {
  const fieldNames = [
    "menu_item_name_clean",
    "category",
    "active",
    "sale_price_aud_small",
    "sale_price_aud_large",
    "estimated_food_cost_aud_small",
    "estimated_food_cost_aud_large",
  ];

  const values = {};

  for (const fieldName of fieldNames) {
    values[fieldName] =
      typeof input?.[fieldName] === "string" ? input[fieldName] : "";
  }

  if (!["true", "false"].includes(values.active)) {
    values.active = "false";
  }

  return values;
}

export function showNewMenuForm(request, response) {
  return response.render("menus/new", {
    pageTitle: "Add menu item",
    values: getMenuFormValues(),
    errorMessage: null,
  });
}

export async function submitNewMenuItem(request, response) {
  try {
    const item = await createMenuItem(request.body);

    // Redirect after POST so refreshing the details page does not resubmit.
    return response.redirect(
      303,
      `/menus/${encodeURIComponent(item.menu_item_id)}`,
    );
  } catch (error) {
    if (!(error instanceof RequestValidationError)) {
      throw error;
    }

    return response.status(400).render("menus/new", {
      pageTitle: "Add menu item",
      values: getMenuFormValues(request.body),
      errorMessage: error.message,
    });
  }
}

/**
 * Extracts safe form values for rendering.
 */
function getVariantFormValues(input = {}) {
  const fields = [
    "menu_variant_name",
    "portion_size",
    "sale_price_aud",
    "estimated_food_cost_aud",
    "active",
    "demand_model_training_eligible",
    "exclusion_reason",
  ];

  const values = {};

  for (const field of fields) {
    values[field] = typeof input?.[field] === "string" ? input[field] : "";
  }

  if (!["true", "false"].includes(values.active)) {
    values.active = "false";
  }

  if (!["true", "false"].includes(values.demand_model_training_eligible)) {
    values.demand_model_training_eligible = "false";
  }

  return values;
}

export async function showNewVariantForm(request, response) {
  const details = await getMenuItemDetails(request.params.menuItemId);

  if (!details) {
    return response.status(404).render("error", {
      pageTitle: "Menu item not found",
      statusCode: 404,
      message: "The parent menu item could not be found.",
    });
  }

  return response.render("menus/newVariant", {
    pageTitle: "Add variant",
    item: details.item,
    values: getVariantFormValues(),
    errorMessage: null,
  });
}

export async function submitNewVariant(request, response) {
  try {
    const variant = await createMenuVariant(
      request.params.menuItemId,
      request.body,
    );

    return response.redirect(
      303,
      `/menus/${encodeURIComponent(variant.menu_item_id)}`,
    );
  } catch (error) {
    if (!(error instanceof RequestValidationError)) {
      throw error;
    }

    const details = await getMenuItemDetails(request.params.menuItemId);

    if (!details) {
      return response.status(404).render("error", {
        pageTitle: "Menu item not found",
        statusCode: 404,
        message: "The parent menu item could not be found.",
      });
    }

    return response.status(400).render("menus/newVariant", {
      pageTitle: "Add variant",
      item: details.item,
      values: getVariantFormValues(request.body),
      errorMessage: error.message,
    });
  }
}

export async function showEditMenuForm(request, response) {
  const data = await getMenuEditData(request.params.menuItemId);

  if (!data) {
    return response.status(404).render("error", {
      pageTitle: "Menu item not found",
      statusCode: 404,
      message: "The requested menu item could not be found.",
    });
  }

  return response.render("menus/edit", {
    pageTitle: "Edit menu item",
    ...data,
    fields: menuEditFields,
    errorMessage: null,
  });
}

export async function submitMenuEdit(request, response) {
  try {
    const menuItemId = await updateMenuItem(
      request.params.menuItemId,
      request.body,
    );

    return response.redirect(303, `/menus/${encodeURIComponent(menuItemId)}`);
  } catch (error) {
    if (!(error instanceof RequestValidationError)) {
      throw error;
    }

    const current = await getMenuEditData(request.params.menuItemId);

    if (!current) {
      return response.status(404).render("error", {
        pageTitle: "Menu item not found",
        statusCode: 404,
        message: "The requested menu item could not be found.",
      });
    }

    const values = {};

    for (const field of menuEditFields) {
      const submittedValue = request.body?.[field.name];
      values[field.name] =
        typeof submittedValue === "string" ? submittedValue : "";
    }

    // Retain the submitted revision. A stale form must be reloaded
    // before it can replace newer data.
    const revision =
      typeof request.body?.revision === "string" ? request.body.revision : "";

    return response.status(400).render("menus/edit", {
      pageTitle: "Edit menu item",
      menuItemId: current.menuItemId,
      revision,
      values,
      fields: menuEditFields,
      errorMessage: error.message,
    });
  }
}
