// ─── Adzooka — Background Service Worker v2 ───────────────────────────
// Handles: dynamic rule management, stats, per-tab badge, message routing.
// ─────────────────────────────────────────────────────────────────────────────

const STATIC_RULE_COUNT    = 200;  // matches ad_block_rules.json
const DYNAMIC_RULE_ID_BASE = STATIC_RULE_COUNT + 1;

// In-memory map: domain → dynamic rule ID (rebuilt from storage on startup)
const domainToRuleId = new Map();

// ── Startup: rebuild in-memory map from stored custom filters ─────────────────
async function init() {
  const { customFilters = [], allowedDomains = [] } = await chrome.storage.local.get({
    customFilters: [],
    allowedDomains: [],
  });
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  for (const rule of existing) {
    const domain = rule.condition.urlFilter
      ?.replace(/^\|\|/, "")
      .replace(/\^$/, "");
    if (domain) domainToRuleId.set(domain, rule.id);
  }
}
init().catch(console.error);

// ── ID allocation ─────────────────────────────────────────────────────────────
function nextRuleId() {
  const usedIds = new Set(domainToRuleId.values());
  let id = DYNAMIC_RULE_ID_BASE;
  while (usedIds.has(id)) id++;
  return id;
}

// ── Storage helpers ────────────────────────────────────────────────────────────
async function getState() {
  return chrome.storage.local.get({
    blockedCount: 0,
    allowedDomains: [],
    customFilters: [],
  });
}

async function incrementBlocked(count = 1) {
  const { blockedCount } = await getState();
  return chrome.storage.local.set({ blockedCount: blockedCount + count });
}

// ── Custom block filter ────────────────────────────────────────────────────────
async function addCustomFilter(domain) {
  domain = domain.toLowerCase().trim();
  if (!domain || domainToRuleId.has(domain)) return;

  const id = nextRuleId();
  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [{
      id,
      priority: 2,
      action: { type: "block" },
      condition: {
        urlFilter: `||${domain}^`,
        resourceTypes: [
          "script","image","xmlhttprequest","sub_frame",
          "media","stylesheet","font","websocket","other",
        ],
      },
    }],
    removeRuleIds: [],
  });

  domainToRuleId.set(domain, id);
  const { customFilters } = await getState();
  if (!customFilters.includes(domain)) {
    await chrome.storage.local.set({ customFilters: [...customFilters, domain] });
  }
}

async function removeCustomFilter(domain) {
  domain = domain.toLowerCase().trim();
  const id = domainToRuleId.get(domain);
  if (id == null) return;

  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [],
    removeRuleIds: [id],
  });

  domainToRuleId.delete(domain);
  const { customFilters } = await getState();
  await chrome.storage.local.set({
    customFilters: customFilters.filter(d => d !== domain),
  });
}

// ── Allowlist ──────────────────────────────────────────────────────────────────
async function allowDomain(domain) {
  domain = domain.toLowerCase().trim();
  const key = `allow:${domain}`;
  if (domainToRuleId.has(key)) return;

  const id = nextRuleId();
  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [{
      id,
      priority: 100,  // overrides block rules
      action: { type: "allow" },
      condition: { urlFilter: `||${domain}^` },
    }],
    removeRuleIds: [],
  });

  domainToRuleId.set(key, id);
  const { allowedDomains } = await getState();
  if (!allowedDomains.includes(domain)) {
    await chrome.storage.local.set({ allowedDomains: [...allowedDomains, domain] });
  }
}

async function disallowDomain(domain) {
  domain = domain.toLowerCase().trim();
  const key = `allow:${domain}`;
  const id  = domainToRuleId.get(key);
  if (id == null) return;

  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [],
    removeRuleIds: [id],
  });

  domainToRuleId.delete(key);
  const { allowedDomains } = await getState();
  await chrome.storage.local.set({
    allowedDomains: allowedDomains.filter(d => d !== domain),
  });
}

// ── Per-tab block counter + badge ─────────────────────────────────────────────
const tabCounts = {};

function updateBadge(tabId) {
  const count = tabCounts[tabId] ?? 0;
  const text  = count > 0 ? (count > 999 ? "999+" : String(count)) : "";
  chrome.action.setBadgeText({ text, tabId }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: "#e94560", tabId }).catch(() => {});
}

// declarativeNetRequest debug hook (only available in dev / Chromium with flag)
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(({ request, rule }) => {
  if (rule.rule?.action?.type === "block") {
    const { tabId } = request;
    if (tabId >= 0) {
      tabCounts[tabId] = (tabCounts[tabId] ?? 0) + 1;
      updateBadge(tabId);
      incrementBlocked().catch(() => {});
    }
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    tabCounts[tabId] = 0;
    chrome.action.setBadgeText({ text: "", tabId }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabCounts[tabId];
});

// ── Message hub ────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {

        case "GET_STATS": {
          const state   = await getState();
          const tabId   = msg.tabId ?? sender.tab?.id;
          const tabCount = tabId != null ? (tabCounts[tabId] ?? 0) : 0;
          sendResponse({ ...state, tabCount });
          break;
        }

        case "CONTENT_BLOCKED": {
          // Content script reports cosmetically removed elements
          const count = Number(msg.count) || 1;
          const tabId = sender.tab?.id;
          if (tabId != null && tabId >= 0) {
            tabCounts[tabId] = (tabCounts[tabId] ?? 0) + count;
            updateBadge(tabId);
          }
          await incrementBlocked(count);
          sendResponse({ ok: true });
          break;
        }

        case "ADD_CUSTOM_FILTER":
          await addCustomFilter(msg.domain);
          sendResponse({ ok: true });
          break;

        case "REMOVE_CUSTOM_FILTER":
          await removeCustomFilter(msg.domain);
          sendResponse({ ok: true });
          break;

        case "ALLOW_DOMAIN":
          await allowDomain(msg.domain);
          sendResponse({ ok: true });
          break;

        case "DISALLOW_DOMAIN":
          await disallowDomain(msg.domain);
          sendResponse({ ok: true });
          break;

        case "GET_TAB_COUNT": {
          const tabId = msg.tabId;
          sendResponse({ count: tabCounts[tabId] ?? 0 });
          break;
        }

        default:
          sendResponse({ error: `Unknown message type: ${msg.type}` });
      }
    } catch (err) {
      console.error("[background] Error handling message:", msg.type, err);
      sendResponse({ error: err.message });
    }
  })();
  return true; // keep message channel open for async response
});
