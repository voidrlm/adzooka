const DISABLED_RULE_BASE  = 900000;
const BLOCKED_RULE_BASE   = 800000;
const YOUTUBE_ALLOW_ID    = 700000;

// YouTube is handled exclusively by youtube-blocker.js / youtube-main.js.
// This rule ensures none of Adzooka's DNR rules ever fire on YouTube.
const YOUTUBE_ALLOW_RULE = {
    id: YOUTUBE_ALLOW_ID,
    priority: 99999,
    action: { type: 'allowAllRequests' },
    condition: {
        requestDomains: ['youtube.com', 'www.youtube.com', 'googlevideo.com', 'yt3.ggpht.com'],
        resourceTypes: ['main_frame', 'sub_frame', 'script', 'image', 'xmlhttprequest', 'media', 'object', 'other'],
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
    } else if (msg.action === 'importRules') {
        importRules(msg.data).then(() => sendResponse({ ok: true })).catch(console.error);
        return true;
    }
});

chrome.runtime.onInstalled.addListener(syncDynamicRules);
chrome.runtime.onStartup.addListener(syncDynamicRules);
