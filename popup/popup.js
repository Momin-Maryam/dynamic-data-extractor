// Holds the fields the user has added: [{ name: "Title", selector: ".product_pod h3 a" }, ...]
let fields = [];

const fieldNameInput = document.getElementById("fieldName");
const fieldSelectorInput = document.getElementById("fieldSelector");
const addFieldBtn = document.getElementById("addFieldBtn");
const fieldListEl = document.getElementById("fieldList");
const statusEl = document.getElementById("status");

function renderFields() {
  fieldListEl.innerHTML = "";

  fields.forEach((field, index) => {
    const li = document.createElement("li");

    const label = document.createElement("span");
    label.textContent = `${field.name}: ${field.selector}`;

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove field";
    removeBtn.addEventListener("click", () => {
      fields.splice(index, 1);
      renderFields();
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

addFieldBtn.addEventListener("click", () => {
  const name = fieldNameInput.value.trim();
  const selector = fieldSelectorInput.value.trim();

  if (!name || !selector) {
    showStatus("Please enter both a field name and a CSS selector.");
    return;
  }

  fields.push({ name, selector });
  renderFields();

  fieldNameInput.value = "";
  fieldSelectorInput.value = "";
  fieldNameInput.focus();
});

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

let lastExtractedRows = [];
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