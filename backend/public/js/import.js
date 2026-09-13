/**
 * CSV Import
 *
 * Reads CSV files in the browser and sends
 * the rows to Express as JSON.
 */

/**
 * Convert simple CSV text into objects.
 */
function parseCSV(csvText) {
  const lines = csvText.trim().split(/\r?\n/);

  if (lines.length < 2) {
    throw new Error("CSV must contain a header and at least one row.");
  }

  const headers = lines[0]
    .split(";")
    .map((header) => header.trim().replaceAll('"', ""));

  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) {
      continue;
    }

    const values = lines[i]
      .split(";")
      .map((value) => value.trim().replaceAll('"', ""));

    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    rows.push(row);
  }

  return rows;
}

/**
 * Read a browser File as text.
 */
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(reader.result);
    };

    reader.onerror = () => {
      reject(new Error("Could not read the selected file."));
    };

    reader.readAsText(file);
  });
}

/**
 * Show success/error messages.
 */
function showMessage(message, isError = false) {
  const messageBox = document.getElementById("importMessage");

  if (isError) {
    messageBox.innerHTML = `
      <div class="alert alert-danger">
        ${message}
      </div>
    `;
  } else {
    messageBox.innerHTML = `
      <div class="alert alert-success">
        ${message}
      </div>
    `;
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

/**
 * Generic helper used by all four imports.
 */
async function importCSV(inputId, expectedFilename, endpoint, description) {
  const input = document.getElementById(inputId);

  const file = input.files[0];

  if (!file) {
    showMessage(`Please select ${expectedFilename}.`, true);

    return;
  }

  /*
   * Only accept the correct filename.
   */
  if (file.name !== expectedFilename) {
    showMessage(
      `Expected ${expectedFilename}, but selected ${file.name}.`,
      true,
    );

    return;
  }

  try {
    const text = await readFile(file);

    const rows = parseCSV(text);

    const response = await fetch(endpoint, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        filename: file.name,

        rows: rows,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      showMessage(result.error, true);

      return;
    }

    showMessage(
      `${result.imported} ${description} rows imported successfully.`,
    );
  } catch (error) {
    showMessage(error.message, true);
  }
}

/**
 * menu.csv
 */
function importMenu() {
  importCSV("menuFile", "menu.csv", "/import/menu", "menu");
}

/**
 * promotion.csv
 */
function importPromotions() {
  importCSV(
    "promotionFile",
    "promotion.csv",
    "/import/promotions",
    "promotion",
  );
}

/**
 * daily_reservation.csv
 */
function importReservations() {
  importCSV(
    "reservationFile",
    "daily_reservation.csv",
    "/import/reservations",
    "reservation",
  );
}

/**
 * daily_sales.csv
 */
function importSales() {
  importCSV("salesFile", "daily_sales.csv", "/import/sales", "daily sales");
}
