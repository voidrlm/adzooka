const DISABLED_RULE_BASE = 900000;
const BLOCKED_RULE_BASE = 800000;
const YOUTUBE_ALLOW_ID = 700000;

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

async function syncDynamicRules() {
    const { disabledSites = [], blockedUrls = [] } = await chrome.storage.local.get([
        'disabledSites',
        'blockedUrls',
    ]);

    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const toRemove = existing.map((rule) => rule.id);

    const allowRules = disabledSites.map((hostname, i) => ({
        id: DISABLED_RULE_BASE + i,
        priority: 9999,
        action: { type: 'allowAllRequests' },
        condition: {
            requestDomains: [hostname],
            resourceTypes: ['main_frame', 'sub_frame'],
        },
    }));

    const blockRules = blockedUrls.map((hostname, i) => ({
        id: BLOCKED_RULE_BASE + i,
        priority: 100,
        action: { type: 'block' },
        condition: {
            requestDomains: [hostname],
            resourceTypes: [
                'main_frame',
                'sub_frame',
                'script',
                'image',
                'xmlhttprequest',
                'media',
                'object',
                'other',
            ],
        },
    }));

    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: toRemove,
        addRules: [YOUTUBE_ALLOW_RULE, ...allowRules, ...blockRules],
    });
}

async function startPicker(tabId) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content-picker.js'] });
}

async function addBlockedElement(rawUrl, selector, site) {
    const updates = {};
    const normalizedSite = typeof site === 'string' ? site.toLowerCase() : '';
    const pickedHostnames = [];
    const rawUrls = Array.isArray(rawUrl) ? rawUrl : (rawUrl ? [rawUrl] : []);

    for (const url of rawUrls) {
        try {
            const hostname = new URL(url).hostname;
            if (hostname && hostname.toLowerCase() !== normalizedSite) {
                pickedHostnames.push(hostname);
            }
        } catch (_) {}
    }

    if (pickedHostnames.length) {
        const { blockedUrls = [] } = await chrome.storage.local.get('blockedUrls');
        const nextBlockedUrls = [...blockedUrls];
        for (const hostname of pickedHostnames) {
            if (!nextBlockedUrls.includes(hostname)) {
                nextBlockedUrls.push(hostname);
            }
        }
        if (nextBlockedUrls.length !== blockedUrls.length) {
            updates.blockedUrls = nextBlockedUrls;
        }
    }

    // Same-site picks should become site-level selector rules, not global hostname blocks.
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

async function importRules({ blockedUrls = [], blockedSelectors = {} }) {
    const normalizedUrls = blockedUrls
        .map((entry) => (typeof entry === 'string' ? entry : entry.hostname))
        .filter(Boolean);

    const normalizedSelectors = {};
    if (!Array.isArray(blockedSelectors) && blockedSelectors && typeof blockedSelectors === 'object') {
        for (const [site, list] of Object.entries(blockedSelectors)) {
            normalizedSelectors[site] = list
                .map((entry) => (typeof entry === 'string' ? entry : entry.selector))
                .filter(Boolean);
        }
    }

    await chrome.storage.local.set({
        blockedUrls: normalizedUrls,
        blockedSelectors: normalizedSelectors,
    });
}

chrome.storage.onChanged.addListener((changes) => {
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
