const DISABLED_RULE_BASE  = 900000;
const BLOCKED_RULE_BASE   = 800000;
const YOUTUBE_ALLOW_ID    = 700000;
const REDIRECT_GUARD_MS   = 2000;

const recentIntents = new Map();
const guardReverts = new Map();

// YouTube is handled exclusively by youtube-blocker.js / youtube-main.js.
// This rule ensures none of Adzooka's DNR rules ever fire on YouTube.
const YOUTUBE_ALLOW_RULE = {
    id: YOUTUBE_ALLOW_ID,
    priority: 99999,
    action: { type: 'allowAllRequests' },
    condition: {
        requestDomains: ['youtube.com', 'www.youtube.com', 'googlevideo.com', 'yt3.ggpht.com'],
        resourceTypes: ['main_frame', 'sub_frame'],
    },
};

// ── Dynamic rules sync ───────────────────────────────────────────────────────

async function syncDynamicRules() {
    const { disabledSites = [], blockedUrls = [] } = await chrome.storage.local.get([
        'disabledSites',
        'blockedUrls',
    ]);

    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const toRemove = existing.map(r => r.id);

    const allowRules = disabledSites.map((hostname, i) => ({
        id: DISABLED_RULE_BASE + i,
        priority: 9999,
        action: { type: 'allowAllRequests' },
        condition: {
            requestDomains: [hostname],
            resourceTypes: ['main_frame', 'sub_frame'],
        },
    }));

    // blockedUrls is now a flat array of hostname strings
    const blockRules = blockedUrls.map((hostname, i) => ({
        id: BLOCKED_RULE_BASE + i,
        priority: 100,
        action: { type: 'block' },
        condition: {
            requestDomains: [hostname],
            resourceTypes: [
                'main_frame', 'sub_frame', 'script', 'image',
                'xmlhttprequest', 'media', 'object', 'other',
            ],
        },
    }));

    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: toRemove,
        addRules: [YOUTUBE_ALLOW_RULE, ...allowRules, ...blockRules],
    });
}

// ── Element picker ───────────────────────────────────────────────────────────

async function startPicker(tabId) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content-picker.js'] });
}

function normalizeUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return null;
    try {
        return new URL(url).href;
    } catch (_) {
        return null;
    }
}

function stripHash(url) {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        parsed.hash = '';
        return parsed.href;
    } catch (_) {
        return url;
    }
}

function matchesExpected(url, intent) {
    const bare = stripHash(url);
    return (intent.expectedUrls || []).some(expected => {
        const normalized = normalizeUrl(expected);
        return normalized && (normalized === url || stripHash(normalized) === bare);
    });
}

function sameHost(url, host) {
    try {
        return new URL(url).host === host;
    } catch (_) {
        return false;
    }
}

async function revertUnexpectedRedirect(tabId, fallbackUrl) {
    const now = Date.now();
    const last = guardReverts.get(tabId) || 0;
    if (now - last < 1500) return;
    guardReverts.set(tabId, now);

    try {
        await chrome.tabs.goBack(tabId);
    } catch (_) {
        if (fallbackUrl) {
            try {
                await chrome.tabs.update(tabId, { url: fallbackUrl });
            } catch (_) {
                // Ignore: best-effort recovery only.
            }
        }
    }

    setTimeout(() => {
        if (guardReverts.get(tabId) === now) {
            guardReverts.delete(tabId);
        }
    }, 2000);
}

async function addBlockedElement(rawUrl, selector, site) {
    const updates = {};

    // Hostname is global — shared across all sites
    if (rawUrl) {
        let hostname;
        try { hostname = new URL(rawUrl).hostname; } catch (_) {}
        if (hostname) {
            const { blockedUrls = [] } = await chrome.storage.local.get('blockedUrls');
            if (!blockedUrls.includes(hostname)) {
                updates.blockedUrls = [...blockedUrls, hostname];
            }
        }
    }

    // Selector is stored per-site
    if (selector && site) {
        const { blockedSelectors = {} } = await chrome.storage.local.get('blockedSelectors');
        const existing = blockedSelectors[site] || [];
        if (!existing.includes(selector)) {
            updates.blockedSelectors = { ...blockedSelectors, [site]: [...existing, selector] };
        }
    }

    if (Object.keys(updates).length) {
        await chrome.storage.local.set(updates);
    }
}

// ── Import ruleset ───────────────────────────────────────────────────────────

async function importRules({ blockedUrls = [], blockedSelectors = {} }) {
    // Normalize blockedUrls: accept both plain strings and legacy {hostname} objects
    const normalizedUrls = blockedUrls
        .map(e => (typeof e === 'string' ? e : e.hostname))
        .filter(Boolean);

    // Normalize blockedSelectors: accept both new object form and legacy array
    let normalizedSelectors = {};
    if (Array.isArray(blockedSelectors)) {
        // Legacy flat array — nothing to key by, drop it
    } else if (blockedSelectors && typeof blockedSelectors === 'object') {
        // Normalize each site's list (could contain {selector} objects from older exports)
        for (const [site, list] of Object.entries(blockedSelectors)) {
            normalizedSelectors[site] = list
                .map(e => (typeof e === 'string' ? e : e.selector))
                .filter(Boolean);
        }
    }

    await chrome.storage.local.set({
        blockedUrls: normalizedUrls,
        blockedSelectors: normalizedSelectors,
    });
}

// ── Listeners ────────────────────────────────────────────────────────────────

chrome.storage.onChanged.addListener(changes => {
    if (changes.disabledSites || changes.blockedUrls) syncDynamicRules();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'startPicker') {
        startPicker(msg.tabId).catch(console.error);
    } else if (msg.action === 'blockElement') {
        addBlockedElement(msg.url, msg.selector, msg.site || '').catch(console.error);
    } else if (msg.action === 'gestureIntent' && sender.tab?.id) {
        recentIntents.set(sender.tab.id, msg.payload);
    } else if (msg.action === 'importRules') {
        importRules(msg.data).then(() => sendResponse({ ok: true })).catch(console.error);
        return true;
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    recentIntents.delete(tabId);
    guardReverts.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url) return;

    const intent = recentIntents.get(tabId);
    if (!intent) return;

    const now = Date.now();
    if (now - (intent.timestamp || 0) > REDIRECT_GUARD_MS) {
        recentIntents.delete(tabId);
        return;
    }

    const nextUrl = normalizeUrl(changeInfo.url);
    const sourceUrl = normalizeUrl(intent.sourceUrl);
    if (!nextUrl || !sourceUrl) return;
    if (stripHash(nextUrl) === stripHash(sourceUrl)) return;

    if (matchesExpected(nextUrl, intent)) {
        recentIntents.delete(tabId);
        return;
    }

    const sourceHost = new URL(sourceUrl).host;
    const expectedHosts = intent.expectedHosts || [];

    let suspicious = false;

    if (intent.kind === 'link' || intent.kind === 'form') {
        suspicious = expectedHosts.length > 0 && !expectedHosts.some(host => sameHost(nextUrl, host));
    } else if (!intent.interactive) {
        suspicious = !sameHost(nextUrl, sourceHost);
    }

    if (!suspicious) return;

    recentIntents.delete(tabId);
    revertUnexpectedRedirect(tabId, sourceUrl).catch(console.error);
});

chrome.runtime.onInstalled.addListener(syncDynamicRules);
chrome.runtime.onStartup.addListener(syncDynamicRules);
