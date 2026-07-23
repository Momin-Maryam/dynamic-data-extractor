// This script runs in the context of the actual webpage.
// It listens for a message from the popup containing the user's fields,
// extracts matching data, and sends the results back.

// Given one DOM element and a field definition, return the value based on field.type
function getValueForField(el, field) {
  const type = field.type || "text";

  switch (type) {
    case "text":
      return el.textContent.trim();
    case "link":
      return el.getAttribute("href") || "";
    case "image":
      return el.getAttribute("src") || "";
    case "attribute":
      return el.getAttribute(field.attributeName || "") || "";
    case "html":
      return el.innerHTML.trim();
    case "table":
      return el.outerHTML.trim(); // raw table HTML for now; structured parsing comes later
    default:
      return el.textContent.trim();
  }
}

// Given the fields array, extract matching data from the CURRENT page and return an array of row objects.
function extractRows(fields) {
  const fieldMatches = fields.map((field) => {
    const elements = Array.from(document.querySelectorAll(field.selector));
    return {
      name: field.name,
      values: elements.map((el) => getValueForField(el, field)),
    };
  });

  const maxRows = Math.max(...fieldMatches.map((f) => f.values.length), 0);

  const rows = [];
  for (let i = 0; i < maxRows; i++) {
    const row = {};
    fieldMatches.forEach((field) => {
      row[field.name] = field.values[i] !== undefined ? field.values[i] : "";
    });
    rows.push(row);
  }
  return rows;
}

// ---------- Multi-page scraping (pagination) ----------

// Runs one step of a multi-page scrape: extract current page, save results,
// then click the "next page" element if one exists and we haven't hit the page limit.
function doScrapeStep() {
  chrome.storage.local.get(
    ["scrapeConfig", "scrapeResults", "scrapePageCount"],
    (data) => {
      const config = data.scrapeConfig;
      if (!config) return;

      const { fields, nextPageSelector, maxPages } = config;
      const newRows = extractRows(fields);
      const combinedResults = (data.scrapeResults || []).concat(newRows);
      const pageCount = (data.scrapePageCount || 0) + 1;

      chrome.storage.local.set(
        { scrapeResults: combinedResults, scrapePageCount: pageCount },
        () => {
          if (pageCount >= maxPages) {
            finishScrape();
            return;
          }

          const nextEl = nextPageSelector
            ? document.querySelector(nextPageSelector)
            : null;

          if (!nextEl) {
            finishScrape(); // no more pages found
            return;
          }

          // Clicking navigates the page — the content script reloads fresh,
          // and the onload check below will continue the scrape automatically.
          nextEl.click();
        }
      );
    }
  );
}

function finishScrape() {
  chrome.storage.local.set({ scrapeStatus: "done" });
}

// On every page load, check if a multi-page scrape is currently in progress.
// If so, continue it automatically (this is how scraping survives page navigation).
chrome.storage.local.get(["scrapeStatus"], (data) => {
  if (data.scrapeStatus === "running") {
    setTimeout(doScrapeStep, 400); // small delay to let the new page render
  }
});

// ---------- End multi-page scraping ----------

// ---------- Point-and-click element picker ----------

let pickerActive = false;
let pickerOverlay = null;
let currentHoverEl = null;

function createOverlay() {
  const overlay = document.createElement("div");
  overlay.style.position = "absolute";
  overlay.style.pointerEvents = "none";
  overlay.style.border = "2px solid #4a86e8";
  overlay.style.backgroundColor = "rgba(74, 134, 232, 0.15)";
  overlay.style.zIndex = "2147483647"; // max z-index, stay on top of page content
  overlay.style.transition = "all 0.05s ease-in-out";
  overlay.style.boxSizing = "border-box";
  document.body.appendChild(overlay);
  return overlay;
}

function positionOverlay(el) {
  if (!pickerOverlay || !el) return;
  const rect = el.getBoundingClientRect();
  pickerOverlay.style.top = `${rect.top + window.scrollY}px`;
  pickerOverlay.style.left = `${rect.left + window.scrollX}px`;
  pickerOverlay.style.width = `${rect.width}px`;
  pickerOverlay.style.height = `${rect.height}px`;
}

// Escapes a value so it can be safely used inside a CSS class selector (e.g. "col-md-4" -> ".col-md-4")
function escapeClassName(cls) {
  return cls.replace(/([^\w-])/g, "\\$1");
}

// Fallback: build a fully structural path using nth-of-type, walking up to <body>.
// Brittle (locks to one exact position), used only when no id/class exists anywhere up the tree.
function buildStructuralPath(el) {
  let current = el;
  const parts = [];
  while (current && current.nodeType === 1 && current.tagName.toLowerCase() !== "body") {
    const parent = current.parentElement;
    if (!parent) break;
    const siblings = Array.from(parent.children).filter(
      (c) => c.tagName === current.tagName
    );
    const index = siblings.indexOf(current) + 1;
    parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${index})`);
    current = parent;
  }
  return parts.join(" > ");
}

// Generates a reasonable CSS selector for the given element.
// Strategy: if the element itself has an id or class, use that directly.
// Otherwise, walk up to the nearest ancestor that HAS an id/class, and build
// a selector from that ancestor down to the element using plain tag names
// (no nth-of-type), so the selector naturally generalizes to sibling items
// (e.g. all book titles in a listing), not just the one clicked element.
function generateSelector(el) {
  if (el.id) {
    return `#${escapeClassName(el.id)}`;
  }
  if (el.classList && el.classList.length > 0) {
    const tag = el.tagName.toLowerCase();
    return tag + "." + Array.from(el.classList).map(escapeClassName).join(".");
  }

  let current = el;
  const tagPath = []; // tag names from el up to (not including) the anchor, bottom-up
  let anchor = null;

  while (true) {
    const parent = current.parentElement;
    if (!parent || parent.tagName.toLowerCase() === "html") {
      break; // reached the top without finding an anchor
    }

    tagPath.push(current.tagName.toLowerCase());

    if (parent.id) {
      anchor = `#${escapeClassName(parent.id)}`;
      break;
    }
    if (parent.classList && parent.classList.length > 0) {
      const tag = parent.tagName.toLowerCase();
      anchor = tag + "." + Array.from(parent.classList).map(escapeClassName).join(".");
      break;
    }

    current = parent;
  }

  if (!anchor) {
    // No id/class found anywhere up the tree — fall back to a brittle structural path
    return buildStructuralPath(el);
  }

  // tagPath is bottom-up (el's tag first); reverse it to get top-down order,
  // then join with ">" since each step is a direct parent-child relationship
  const descendantPath = tagPath.reverse().join(" > ");
  return `${anchor} ${descendantPath}`;
}

function handleMouseOver(event) {
  if (!pickerActive) return;
  currentHoverEl = event.target;
  positionOverlay(currentHoverEl);
}

function handleClick(event) {
  if (!pickerActive) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const selector = generateSelector(event.target);
  chrome.storage.local.set({ pickedSelector: selector }, () => {
    stopPicking();
  });
}

function handleKeyDown(event) {
  if (!pickerActive) return;
  if (event.key === "Escape") {
    stopPicking();
  }
}

function startPicking() {
  if (pickerActive) return;
  pickerActive = true;
  pickerOverlay = createOverlay();
  document.addEventListener("mouseover", handleMouseOver, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeyDown, true);
  document.body.style.cursor = "crosshair";
}

function stopPicking() {
  pickerActive = false;
  document.removeEventListener("mouseover", handleMouseOver, true);
  document.removeEventListener("click", handleClick, true);
  document.removeEventListener("keydown", handleKeyDown, true);
  document.body.style.cursor = "";
  if (pickerOverlay) {
    pickerOverlay.remove();
    pickerOverlay = null;
  }
}

// ---------- End picker logic ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startPicking") {
    startPicking();
    sendResponse({ success: true });
    return;
  }

  if (message.action === "runScrapeStep") {
    doScrapeStep();
    sendResponse({ success: true });
    return;
  }

  if (message.action !== "extractData") {
    return; // not for us
  }

  const fields = message.fields || [];

  if (fields.length === 0) {
    sendResponse({ success: false, error: "No fields provided." });
    return;
  }

  try {
    const rows = extractRows(fields);
    sendResponse({ success: true, rows });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }

  // Return true to indicate we'll respond asynchronously (safe default)
  return true;
});

console.log("Content script loaded on:", window.location.href);   