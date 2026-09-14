/**
 * Machine Learning API helper.
 *
 * Sends one day's ml_model_input
 * to the FastAPI ML service.
 */

export async function getSalesPrediction(mlInput) {
  const mlApiUrl = process.env.ML_API_URL;

  if (!mlApiUrl) {
    throw new Error("ML_API_URL is missing from .env.");
  }

  /*
   * JSON does not have a Date type.
   *
   * MongoDB keeps date as a real Date,
   * but the API receives YYYY-MM-DD.
   */
  const apiInput = {
    ...mlInput,

    date: mlInput.date.toISOString().slice(0, 10),
  };

  const response = await fetch(mlApiUrl, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify(apiInput),
  });

  if (!response.ok) {
    throw new Error(`ML API request failed with status ${response.status}.`);
  }

  const result = await response.json();

  /*
   * The real ML service (api/main.py) nests predictions as
   * { predictions: { menu_1: 33, ... } }, but buildPredictionDocument
   * expects them flat as menu_1_amount, menu_2_amount, etc. (the shape
   * the placeholder service returns directly). Flatten here so both
   * services produce the same contract for the rest of the app.
   */
  if (result && typeof result.predictions === "object" && result.predictions !== null) {
    const flattened = { ...result };

    for (const [menuKey, amount] of Object.entries(result.predictions)) {
      flattened[`${menuKey}_amount`] = amount;
    }

    return flattened;
  }

  return result;
}
