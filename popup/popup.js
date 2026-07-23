// Holds the fields the user has added: [{ name, selector, type, attributeName? }, ...]
let fields = [];

const fieldNameInput = document.getElementById("fieldName");
const fieldSelectorInput = document.getElementById("fieldSelector");
const fieldTypeSelect = document.getElementById("fieldType");
const fieldAttributeNameInput = document.getElementById("fieldAttributeName");
const addFieldBtn = document.getElementById("addFieldBtn");
const pickElementBtn = document.getElementById("pickElementBtn");
const fieldListEl = document.getElementById("fieldList");
const statusEl = document.getElementById("status");
const nextPageSelectorInput = document.getElementById("nextPageSelector");
const maxPagesInput = document.getElementById("maxPages");
const scrapeBtn = document.getElementById("scrapeBtn");
let lastExtractedRows = [];

// Show the attribute-name input only when type is "attribute"
fieldTypeSelect.addEventListener("change", () => {
  fieldAttributeNameInput.style.display =
    fieldTypeSelect.value === "attribute" ? "block" : "none";
});

function renderFields() {
  fieldListEl.innerHTML = "";

  fields.forEach((field, index) => {
    const li = document.createElement("li");

    const label = document.createElement("span");
    const typeLabel = field.type
      ? field.type + (field.attributeName ? `:${field.attributeName}` : "")
      : "text";
    label.textContent = `${field.name} [${typeLabel}]: ${field.selector}`;

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove field";
    removeBtn.addEventListener("click", () => {
      fields.splice(index, 1);
      renderFields();
      saveFields();
    });

    li.appendChild(label);
    li.appendChild(removeBtn);
    fieldListEl.appendChild(li);
  });
}

function showStatus(message) {
  statusEl.textContent = message;
  setTimeout(() => {
    statusEl.textContent = "";
  }, 2000);
}

// Save the current fields array to chrome.storage.local so it survives popup close
function saveFields() {
  chrome.storage.local.set({ fields });
}

// Load saved fields (if any) when the popup opens
function loadFields() {
  chrome.storage.local.get(["fields"], (result) => {
    if (Array.isArray(result.fields)) {
      fields = result.fields;
      renderFields();
    }
  });
}

// If a selector was just picked on the page (popup was closed during picking),
// grab it from storage, fill the input, then clear it so it isn't reused by mistake.
function checkForPickedSelector() {
  chrome.storage.local.get(["pickedSelector"], (result) => {
    if (result.pickedSelector) {
      fieldSelectorInput.value = result.pickedSelector;
      chrome.storage.local.remove("pickedSelector");
      showStatus("Selector picked! Confirm the field name and type, then Add Field.");
    }
  });
}

pickElementBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: "startPicking" }, () => {
    if (chrome.runtime.lastError) {
      showStatus("Could not start picking — try reloading the page.");
      console.error(chrome.runtime.lastError);
    }
    // Popup will close as soon as the user clicks the page — that's expected.
  });
});

addFieldBtn.addEventListener("click", () => {
  const name = fieldNameInput.value.trim();
  const selector = fieldSelectorInput.value.trim();
  const type = fieldTypeSelect.value;
  const attributeName = fieldAttributeNameInput.value.trim();

  if (!name || !selector) {
    showStatus("Please enter both a field name and a CSS selector.");
    return;
  }

  if (type === "attribute" && !attributeName) {
    showStatus("Please enter an attribute name (e.g. data-id).");
    return;
  }

  const newField = { name, selector, type };
  if (type === "attribute") {
    newField.attributeName = attributeName;
  }

  fields.push(newField);
  renderFields();
  saveFields();

  fieldNameInput.value = "";
  fieldSelectorInput.value = "";
  fieldAttributeNameInput.value = "";
  fieldTypeSelect.value = "text";
  fieldAttributeNameInput.style.display = "none";
  fieldNameInput.focus();
});

// Checks whether a previously-started multi-page scrape has finished.
// If done, loads the accumulated results so they're ready to export, and clears the scrape state.
function checkScrapeStatus() {
  chrome.storage.local.get(
    ["scrapeStatus", "scrapeResults", "scrapePageCount"],
    (data) => {
      if (data.scrapeStatus === "running") {
        showStatus(`Scraping in progress (page ${data.scrapePageCount || 0})... reopen popup to check again.`);
        scrapeBtn.disabled = true;
        scrapeBtn.textContent = "Scraping in progress...";
      } else if (data.scrapeStatus === "done" && Array.isArray(data.scrapeResults)) {
        lastExtractedRows = data.scrapeResults;
        showStatus(
          `Scrape complete: ${data.scrapeResults.length} row(s) from ${data.scrapePageCount || 0} page(s). Ready to export.`
        );
        chrome.storage.local.remove(["scrapeStatus"]);
        scrapeBtn.disabled = false;
        scrapeBtn.textContent = "Scrape All Pages";
      } else {
        scrapeBtn.disabled = false;
        scrapeBtn.textContent = "Scrape All Pages";
      }
    }
  );
}

scrapeBtn.addEventListener("click", async () => {
  if (fields.length === 0) {
    showStatus("Add at least one field before scraping.");
    return;
  }

  // Guard: don't let a fresh click reset an already-running scrape's accumulated data
  const existing = await new Promise((resolve) =>
    chrome.storage.local.get(["scrapeStatus"], resolve)
  );
  if (existing.scrapeStatus === "running") {
    showStatus("A scrape is already in progress — reopen the popup in a moment to check its status.");
    return;
  }

  const nextPageSelector = nextPageSelectorInput.value.trim();
  const maxPages = parseInt(maxPagesInput.value, 10) || 5;

  await chrome.storage.local.set({
    scrapeConfig: { fields, nextPageSelector, maxPages },
    scrapeResults: [],
    scrapePageCount: 0,
    scrapeStatus: "running",
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: "runScrapeStep" }, () => {
    if (chrome.runtime.lastError) {
      showStatus("Could not start scraping — try reloading the page.");
      console.error(chrome.runtime.lastError);
      return;
    }
    showStatus("Scraping started — this runs across page loads, reopen popup to check progress.");
  });
});

loadFields();
checkForPickedSelector();
checkScrapeStatus();
console.log("Popup loaded");

const extractBtn = document.getElementById("extractBtn");

extractBtn.addEventListener("click", async () => {
  if (fields.length === 0) {
    showStatus("Add at least one field before extracting.");
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(
    tab.id,
    { action: "extractData", fields },
    (response) => {
      if (chrome.runtime.lastError) {
        showStatus("Error: could not reach the page. Try reloading it.");
        console.error(chrome.runtime.lastError);
        return;
      }

      if (!response || !response.success) {
        showStatus("Extraction failed: " + (response ? response.error : "unknown error"));
        return;
      }

      console.log("Extracted rows:", response.rows);
      lastExtractedRows = response.rows;
      showStatus(`Extracted ${response.rows.length} row(s). Ready to export.`);
    }
  );
});

const exportBtn = document.getElementById("exportBtn");

function escapeCsvValue(value) {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function rowsToCsv(rows) {
  if (rows.length === 0) return "";

  const headers = Object.keys(rows[0]);
  const headerLine = headers.map(escapeCsvValue).join(",");

  const lines = rows.map((row) =>
    headers.map((header) => escapeCsvValue(row[header])).join(",")
  );

  return [headerLine, ...lines].join("\n");
}

exportBtn.addEventListener("click", () => {
  if (lastExtractedRows.length === 0) {
    showStatus("Nothing to export yet — click Extract Data first.");
    return;
  }

  const csvContent = rowsToCsv(lastExtractedRows);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "extracted_data.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showStatus("CSV downloaded.");
});