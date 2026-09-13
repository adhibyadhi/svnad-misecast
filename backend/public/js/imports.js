const form = document.querySelector("#import-form");
const entityInput = document.querySelector("#import-entity");
const fileInput = document.querySelector("#import-file");
const submitButton = document.querySelector("#import-submit");

const statusElement = document.querySelector("#import-status");
const jobPanel = document.querySelector("#import-job-panel");
const jobDescription = document.querySelector("#import-job-description");
const jobStatus = document.querySelector("#import-job-status");
const jobSummary = document.querySelector("#import-job-summary");
const checkStatusButton = document.querySelector("#import-check-status");

const errorsPanel = document.querySelector("#import-errors-panel");
const errorsBody = document.querySelector("#import-errors-body");
const errorsStatus = document.querySelector("#import-errors-status");
const moreErrorsButton = document.querySelector("#import-more-errors");

const maximumFileBytes = Number(form.dataset.maximumFileBytes);
const terminalStatuses = new Set(["succeeded", "partial", "failed"]);

let pendingUpload = null;
let activeJobId = null;
let uploading = false;
let checkingStatus = false;
let loadingErrors = false;
let pollTimer = null;
let nextErrorPage = 1;
let errorsLoaded = false;

function showStatus(message, style) {
  statusElement.className = `alert alert-${style}`;
  statusElement.textContent = message;
}

function setFormDisabled(disabled) {
  submitButton.disabled = disabled;
  entityInput.disabled = disabled;
  fileInput.disabled = disabled;
}

function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = null;
}

function scheduleStatusCheck() {
  stopPolling();

  pollTimer = setTimeout(() => {
    void checkJobStatus();
  }, 2000);
}

function getJobUrl() {
  return `/api/imports/jobs/${encodeURIComponent(activeJobId)}`;
}

async function readResponse(response) {
  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `The server returned an unexpected response (HTTP ${response.status}).`,
    );
  }

  if (!response.ok) {
    const message = data?.error?.message;

    throw new Error(
      typeof message === "string"
        ? message
        : `Request failed (HTTP ${response.status}).`,
    );
  }

  return data;
}

function validateJob(job) {
  if (
    !job ||
    typeof job.import_job_id !== "string" ||
    typeof job.status !== "string"
  ) {
    throw new Error("The server response did not contain a valid import job.");
  }

  return job;
}

function renderJob(job) {
  jobPanel.classList.remove("d-none");

  jobDescription.textContent = `${job.source_name} · Job ${job.import_job_id}`;

  const labels = {
    queued: "Waiting to process",
    running: "Processing",
    succeeded: "Completed",
    partial: "Completed with row errors",
    failed: "Failed",
  };

  const styles = {
    queued: "text-bg-secondary",
    running: "text-bg-primary",
    succeeded: "text-bg-success",
    partial: "text-bg-warning",
    failed: "text-bg-danger",
  };

  jobStatus.textContent = labels[job.status] ?? job.status;
  jobStatus.className = `badge ${styles[job.status] ?? "text-bg-secondary"}`;

  for (const name of [
    "processed",
    "inserted",
    "updated",
    "skipped",
    "failed",
  ]) {
    document.querySelector(`#import-count-${name}`).textContent = String(
      job[`rows_${name}`] ?? 0,
    );
  }

  const messages = {
    queued: "Your file is waiting for automatic processing.",
    running: "Your file is being processed. Counts update automatically.",
    succeeded: "Processing finished without row failures.",
    partial: "Processing finished. Review the failed rows below.",
    failed: "The import failed. Review the details below.",
  };

  jobSummary.textContent =
    messages[job.status] ?? "Checking the current import status.";

  if (job.error_summary) {
    const details =
      typeof job.error_summary === "string"
        ? job.error_summary
        : JSON.stringify(job.error_summary);

    jobSummary.textContent += ` ${details}`;
  }
}

function resetErrors() {
  errorsBody.replaceChildren();
  errorsPanel.classList.add("d-none");
  moreErrorsButton.classList.add("d-none");
  moreErrorsButton.textContent = "Load more errors";
  errorsStatus.textContent = "";

  nextErrorPage = 1;
  errorsLoaded = false;
}

async function loadErrors() {
  if (!activeJobId || loadingErrors) {
    return;
  }

  loadingErrors = true;
  moreErrorsButton.disabled = true;
  errorsPanel.classList.remove("d-none");
  errorsStatus.textContent = "Loading row errors…";

  try {
    const response = await fetch(
      `${getJobUrl()}/errors?page=${nextErrorPage}&pageSize=25`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      },
    );

    const data = await readResponse(response);

    if (!Array.isArray(data.errors) || !data.pagination) {
      throw new Error("The server returned an invalid row-error response.");
    }

    for (const error of data.errors) {
      const row = document.createElement("tr");

      for (const value of [
        error.row_number,
        error.error_code,
        error.error_message,
      ]) {
        const cell = document.createElement("td");

        // Display uploaded values as text, never as HTML.
        cell.textContent = value == null ? "—" : String(value);
        row.append(cell);
      }

      errorsBody.append(row);
    }

    errorsLoaded = true;
    nextErrorPage += 1;

    errorsStatus.textContent =
      `${errorsBody.children.length} of ` +
      `${data.pagination.totalRecords} row errors shown.`;

    moreErrorsButton.textContent = "Load more errors";
    moreErrorsButton.classList.toggle("d-none", !data.pagination.hasNextPage);
  } catch (error) {
    errorsStatus.textContent = `Row errors could not be loaded. ${error.message}`;

    moreErrorsButton.textContent = "Retry loading errors";
    moreErrorsButton.classList.remove("d-none");
  } finally {
    loadingErrors = false;
    moreErrorsButton.disabled = false;
  }
}

async function checkJobStatus() {
  if (!activeJobId || checkingStatus) {
    return;
  }

  stopPolling();
  checkingStatus = true;
  checkStatusButton.disabled = true;

  let shouldContinuePolling = false;

  try {
    const response = await fetch(getJobUrl(), {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    const data = await readResponse(response);
    const job = validateJob(data.job);

    renderJob(job);

    if (terminalStatuses.has(job.status)) {
      if (job.rows_failed > 0 && !errorsLoaded) {
        await loadErrors();
      }

      // Enable a new upload after this job's first error-page request ends.
      setFormDisabled(false);

      showStatus(
        job.status === "succeeded"
          ? "Import complete. You can upload another file."
          : "Processing finished. Review the import results.",
        job.status === "succeeded" ? "success" : "warning",
      );
    } else {
      shouldContinuePolling = true;

      showStatus(
        "Upload accepted. Processing status updates automatically.",
        "info",
      );
    }
  } catch (error) {
    showStatus(
      `Unable to check progress. ${error.message} ` +
        "Your saved import has not been cancelled. Click Check status now to retry.",
      "warning",
    );
  } finally {
    checkingStatus = false;
    checkStatusButton.disabled = false;

    if (shouldContinuePolling) {
      scheduleStatusCheck();
    }
  }
}

function resetPendingUpload() {
  pendingUpload = null;
}

entityInput.addEventListener("change", resetPendingUpload);
fileInput.addEventListener("change", resetPendingUpload);

checkStatusButton.addEventListener("click", () => {
  void checkJobStatus();
});

moreErrorsButton.addEventListener("click", () => {
  void loadErrors();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (uploading || checkingStatus || loadingErrors || !form.reportValidity()) {
    return;
  }

  const entityName = entityInput.value;
  const file = fileInput.files[0];

  if (!entityName) {
    showStatus("Choose the type of data you are uploading.", "warning");
    return;
  }

  if (!file || file.size === 0) {
    showStatus("Select a non-empty CSV or JSON file.", "warning");
    return;
  }

  if (file.size > maximumFileBytes) {
    showStatus(
      `The file exceeds the ${maximumFileBytes / (1024 * 1024)} MiB limit.`,
      "warning",
    );
    return;
  }

  const extension = file.name.split(".").pop().toLowerCase();

  if (!["csv", "json"].includes(extension)) {
    showStatus("Select a .csv or .json file.", "warning");
    return;
  }

  if (!pendingUpload) {
    pendingUpload = {
      idempotencyKey: crypto.randomUUID(),
      entityName,
      file,
      sourceFormat: extension,
    };
  }

  stopPolling();
  activeJobId = null;
  resetErrors();
  jobPanel.classList.add("d-none");

  uploading = true;
  setFormDisabled(true);
  submitButton.textContent = "Uploading…";

  showStatus("Uploading and checking your file…", "info");

  let accepted = false;

  try {
    const url = new URL(
      `/api/imports/${encodeURIComponent(pendingUpload.entityName)}`,
      window.location.origin,
    );

    url.searchParams.set("sourceName", pendingUpload.file.name);

    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type":
          pendingUpload.sourceFormat === "csv"
            ? "text/csv"
            : "application/json",
        "Idempotency-Key": pendingUpload.idempotencyKey,
        "X-MiseCast-Request": "1",
        Accept: "application/json",
      },
      body: pendingUpload.file,
      signal: AbortSignal.timeout(120000),
    });

    const data = await readResponse(response);
    const job = validateJob(data.job);

    activeJobId = job.import_job_id;
    accepted = true;
    pendingUpload = null;
    fileInput.value = "";

    renderJob(job);

    showStatus("Your file was accepted. Checking processing progress…", "info");
  } catch (error) {
    showStatus(
      `${error.message} ` +
        "If the connection was interrupted, retry without changing the file or data type. " +
        "The same request key will be reused.",
      "danger",
    );
  } finally {
    uploading = false;
    submitButton.textContent = "Upload";

    if (!accepted) {
      setFormDisabled(false);
    }
  }

  if (accepted) {
    await checkJobStatus();
  }
});
