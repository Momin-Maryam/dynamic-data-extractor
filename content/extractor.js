// This script runs in the context of the actual webpage.
// It listens for a message from the popup containing the user's fields,
// extracts matching data, and sends the results back.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== "extractData") {
    return; // not for us
  }

  const fields = message.fields || [];

  if (fields.length === 0) {
    sendResponse({ success: false, error: "No fields provided." });
    return;
  }

  try {
    // For each field, grab all matching elements on the page
    const fieldMatches = fields.map((field) => {
      const elements = Array.from(document.querySelectorAll(field.selector));
      return {
        name: field.name,
        values: elements.map((el) => el.textContent.trim()),
      };
    });

    // Figure out how many rows we can build (based on the field with the most matches)
    const maxRows = Math.max(...fieldMatches.map((f) => f.values.length), 0);

    const rows = [];
    for (let i = 0; i < maxRows; i++) {
      const row = {};
      fieldMatches.forEach((field) => {
        row[field.name] = field.values[i] !== undefined ? field.values[i] : "";
      });
      rows.push(row);
    }

    sendResponse({ success: true, rows });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }

  // Return true to indicate we'll respond asynchronously (safe default)
  return true;
});

console.log("Content script loaded on:", window.location.href);