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

  return result;
}
