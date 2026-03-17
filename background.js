// ─── Adzooka — Background Service Worker v3 ──────────────────────────────────
// Architecture:
//   - Static rules  : rules/ad_block_rules.json  (218 rules, compiled in)
//   - Dynamic rules : up to 4 500 domains from live filter lists (IDs ≥ 10 000)
//   - Custom rules  : user-added blocks/allows     (IDs 1 000 – 9 999)
//   - Cosmetic CSS  : stored in chrome.storage.local, injected by content.js
// ─────────────────────────────────────────────────────────────────────────────

const CUSTOM_ID_BASE = 1000;
const FILTER_ID_BASE = 10000;
const FILTER_MAX     = 4500;   // leave headroom for user custom rules

// ── Filter list URLs (all GitHub raw → guaranteed CORS headers) ───────────────
const FILTER_LISTS = [
  "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt",
  "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt",
  "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt",
  "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances-cookies.txt",
  "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances-others.txt",
  "https://easylist.to/easylist/easylist.txt",
  "https://easylist.to/easylist/easyprivacy.txt",
];

// uBlock-specific extended pseudo-classes that require JS — skip in CSS injection
const EXTENDED_RE = /:(?:upward|xpath|has-text|matches-css|min-text-length|watch-attr|matches-attr|nth-ancestor|remove)\s*\(/;

// ── Filter list parser ─────────────────────────────────────────────────────────
function parseFilterLists(texts) {
  const cosmetic = [];
  const network  = new Set();

  for (const text of texts) {
    for (let line of text.split('\n')) {
      line = line.trim();
      if (!line || line[0] === '!' || line[0] === '[') continue;
      if (line.startsWith('@@'))    continue;   // exception rule
      if (line.includes('#@#'))     continue;   // cosmetic exception
      if (line.includes('#?#'))     continue;   // procedural cosmetic (needs JS)

      // Cosmetic filter:  [domains]##selector
      const h = line.indexOf('##');
      if (h !== -1) {
        const domain = line.slice(0, h);
        // Skip domain-specific rules — applying them globally causes false
        // positives (a selector meant only for site X hides things on site Y).
        if (domain) continue;
        const sel = line.slice(h + 2);
        if (!sel || sel.startsWith('+js('))       continue;  // scriptlet
        if (EXTENDED_RE.test(sel))                continue;  // needs JS
        if (sel.includes('<') || sel.includes('{')) continue; // not CSS
        cosmetic.push(sel);
        continue;
      }

      // Network block:  ||hostname^
      if (line.startsWith('||')) {
        const m = line.match(/^\|\|([a-z0-9._-]+)\^/i);
        if (m) network.add(m[1].toLowerCase());
      }
    }
  }

  return { cosmetic, network: [...network] };
}

// ── Fetch + apply ──────────────────────────────────────────────────────────────
async function fetchAndApplyFilterLists() {
  console.log('[Adzooka] Fetching filter lists…');

  const settled = await Promise.allSettled(
    FILTER_LISTS.map(url =>
      fetch(url, { cache: 'no-store' })
        .then(r => { if (!r.ok) throw r.status; return r.text(); })
        .catch(e => { console.warn('[Adzooka] fetch failed:', url, e); return ''; })
    )
  );
  const texts = settled.map(r => r.status === 'fulfilled' ? r.value : '');
  if (!texts.some(t => t.length)) { console.warn('[Adzooka] all filter lists failed'); return; }

  const { cosmetic, network } = parseFilterLists(texts);
  console.log(`[Adzooka] parsed ${cosmetic.length} cosmetic, ${network.length} network`);

  // Build cosmetic CSS in 1 500-selector chunks (browser selector-list limit)
  const CHUNK = 1500;
  const cssBlocks = [];
  for (let i = 0; i < cosmetic.length; i += CHUNK) {
    cssBlocks.push(cosmetic.slice(i, i + CHUNK).join(',\n') + '{display:none!important}');
  }
  // Safety override: real video/audio must never be hidden
  cssBlocks.push('video,audio,video source{display:block!important;visibility:visible!important}');

  await chrome.storage.local.set({
    cosmeticCSS:   cssBlocks.join('\n'),
    filterUpdated: Date.now(),
    filterStats:   { cosmetic: cosmetic.length, network: network.length },
  });

  // Update dynamic network rules from filter lists
  const existing   = await chrome.declarativeNetRequest.getDynamicRules();
  const toRemove   = existing.filter(r => r.id >= FILTER_ID_BASE).map(r => r.id);
  const customDoms = new Set(
    existing
      .filter(r => r.id < FILTER_ID_BASE)
      .map(r => r.condition?.urlFilter?.replace(/^\|\|/, '').replace(/\^.*/, '').toLowerCase())
      .filter(Boolean)
  );

  const newRules = network
    .filter(d => !customDoms.has(d))
    .slice(0, FILTER_MAX)
    .map((domain, i) => ({
      id: FILTER_ID_BASE + i,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: `||${domain}^`,
        // Only block scripts/XHR/sub_frame from filter-list domains.
        // 'image' and 'media' are excluded — filter lists are not curated enough
        // to safely block those without killing thumbnails and video streams.
        // Static rules (ad_block_rules.json) handle images/media for known networks.
        resourceTypes: ['script','xmlhttprequest','sub_frame','other'],
      },
    }));

  // Apply in 1 000-rule API batches
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: toRemove,
    addRules: newRules.slice(0, 1000),
  });
  for (let i = 1000; i < newRules.length; i += 1000) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [],
      addRules: newRules.slice(i, i + 1000),
    });
  }

  console.log(`[Adzooka] applied ${newRules.length} network rules`);
}

// ── Periodic updates ───────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === 'filterUpdate') fetchAndApplyFilterLists().catch(console.error);
});

chrome.runtime.onInstalled.addListener(() => {
  fetchAndApplyFilterLists().catch(console.error);
  chrome.alarms.create('filterUpdate', { periodInMinutes: 1440 }); // daily
});

// ── Custom user rules ──────────────────────────────────────────────────────────
const customMap = new Map(); // domain/key → rule id

function nextCustomId() {
  const used = new Set(customMap.values());
  let id = CUSTOM_ID_BASE;
  while (used.has(id)) id++;
  return id;
}

async function addCustomBlock(domain) {
  domain = domain.toLowerCase().trim();
  if (!domain || customMap.has(domain)) return;
  const id = nextCustomId();
  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [{
      id, priority: 2,
      action: { type: 'block' },
      condition: {
        urlFilter: `||${domain}^`,
        resourceTypes: ['script','image','xmlhttprequest','sub_frame','media','stylesheet','font','websocket','other'],
      },
    }],
    removeRuleIds: [],
  });
  customMap.set(domain, id);
  const { customFilters = [] } = await chrome.storage.local.get('customFilters');
  await chrome.storage.local.set({ customFilters: [...new Set([...customFilters, domain])] });
}

async function removeCustomBlock(domain) {
  domain = domain.toLowerCase().trim();
  const id = customMap.get(domain);
  if (!id) return;
  await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [], removeRuleIds: [id] });
  customMap.delete(domain);
  const { customFilters = [] } = await chrome.storage.local.get('customFilters');
  await chrome.storage.local.set({ customFilters: customFilters.filter(d => d !== domain) });
}

async function allowDomain(domain) {
  domain = domain.toLowerCase().trim();
  const key = `allow:${domain}`;
  if (customMap.has(key)) return;
  const id = nextCustomId();
  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [{ id, priority: 100, action: { type: 'allow' }, condition: { urlFilter: `||${domain}^` } }],
    removeRuleIds: [],
  });
  customMap.set(key, id);
  const { allowedDomains = [] } = await chrome.storage.local.get('allowedDomains');
  await chrome.storage.local.set({ allowedDomains: [...new Set([...allowedDomains, domain])] });
}

async function disallowDomain(domain) {
  domain = domain.toLowerCase().trim();
  const key = `allow:${domain}`;
  const id = customMap.get(key);
  if (!id) return;
  await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [], removeRuleIds: [id] });
  customMap.delete(key);
  const { allowedDomains = [] } = await chrome.storage.local.get('allowedDomains');
  await chrome.storage.local.set({ allowedDomains: allowedDomains.filter(d => d !== domain) });
}

// ── Per-tab badge ──────────────────────────────────────────────────────────────
const tabCounts = {};

function updateBadge(tabId) {
  const n = tabCounts[tabId] ?? 0;
  chrome.action.setBadgeText({ text: n > 0 ? (n > 999 ? '999+' : String(n)) : '', tabId }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#e94560', tabId }).catch(() => {});
}

chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(({ request, rule }) => {
  if (rule.rule?.action?.type === 'block') {
    const { tabId } = request;
    if (tabId >= 0) { tabCounts[tabId] = (tabCounts[tabId] ?? 0) + 1; updateBadge(tabId); }
  }
});

chrome.tabs.onUpdated.addListener((tabId, { status }) => {
  if (status === 'loading') {
    tabCounts[tabId] = 0;
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener(tabId => delete tabCounts[tabId]);

// ── Message hub ────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'GET_STATS': {
          const data = await chrome.storage.local.get([
            'blockedCount','allowedDomains','customFilters','filterUpdated','filterStats',
          ]);
          sendResponse({ ...data, tabCount: tabCounts[msg.tabId ?? sender.tab?.id] ?? 0 });
          break;
        }
        case 'CONTENT_BLOCKED': {
          const tabId = sender.tab?.id;
          if (tabId >= 0) { tabCounts[tabId] = (tabCounts[tabId] ?? 0) + (msg.count || 1); updateBadge(tabId); }
          const { blockedCount = 0 } = await chrome.storage.local.get('blockedCount');
          await chrome.storage.local.set({ blockedCount: blockedCount + (msg.count || 1) });
          sendResponse({ ok: true });
          break;
        }
        case 'ADD_CUSTOM_FILTER':    await addCustomBlock(msg.domain);   sendResponse({ ok: true }); break;
        case 'REMOVE_CUSTOM_FILTER': await removeCustomBlock(msg.domain); sendResponse({ ok: true }); break;
        case 'ALLOW_DOMAIN':         await allowDomain(msg.domain);       sendResponse({ ok: true }); break;
        case 'DISALLOW_DOMAIN':      await disallowDomain(msg.domain);    sendResponse({ ok: true }); break;
        case 'REFRESH_FILTERS':      fetchAndApplyFilterLists().catch(console.error); sendResponse({ ok: true }); break;
        default: sendResponse({ error: 'unknown message type' });
      }
    } catch (e) {
      console.error('[Adzooka] message error:', e);
      sendResponse({ error: e.message });
    }
  })();
  return true;
});

// ── Startup ────────────────────────────────────────────────────────────────────
async function init() {
  // Rebuild custom rule map from existing dynamic rules
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  for (const rule of existing) {
    if (rule.id < FILTER_ID_BASE) {
      const domain = rule.condition?.urlFilter?.replace(/^\|\|/, '').replace(/\^.*/, '');
      if (domain) customMap.set(domain, rule.id);
    }
  }
  // Refresh filter lists if stale (e.g. after browser restart)
  const { filterUpdated = 0 } = await chrome.storage.local.get('filterUpdated');
  if (Date.now() - filterUpdated > 24 * 3600 * 1000) {
    fetchAndApplyFilterLists().catch(console.error);
  }
}

init().catch(console.error);
