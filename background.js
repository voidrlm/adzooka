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
    await chrome.scripting.executeScript({ target: { tabId }, files: ['element-rules.js', 'content-picker.js'] });
}

async function addBlockedElement(selector, site) {
    const { blockedSelectors = {} } = await chrome.storage.local.get('blockedSelectors');
    const existing = blockedSelectors[site] || [];
    if (existing.includes(selector)) return { added: false };
    await chrome.storage.local.set({ blockedSelectors: { ...blockedSelectors, [site]: [...existing, selector] } });
    return { added: true };
}

async function importRules(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid rules file.');
    const { blockedUrls = [], blockedSelectors = {} } = data;
    if (!Array.isArray(blockedUrls) || !blockedSelectors || typeof blockedSelectors !== 'object' || Array.isArray(blockedSelectors)) {
        throw new Error('Invalid rules file.');
    }
    const normalizedUrls = [...new Set(blockedUrls
        .map(entry => typeof entry === 'string' ? entry : entry?.hostname)
        .filter(entry => typeof entry === 'string' && entry.length))];
    const normalizedSelectors = Object.create(null);
    for (const [site, list] of Object.entries(blockedSelectors)) {
        if (!Array.isArray(list)) throw new Error(`Invalid element rules for ${site}.`);
        const selectors = [...new Set(list
            .map(entry => typeof entry === 'string' ? entry : entry?.selector)
            .filter(entry => typeof entry === 'string' && entry.length && entry.length <= 16384))];
        if (selectors.length) normalizedSelectors[site] = selectors;
    }
    await chrome.storage.local.set({ blockedUrls: normalizedUrls, blockedSelectors: normalizedSelectors });
}

// Serialize read/modify/write operations so rapid picks from multiple tabs cannot
// overwrite each other. Rejections must not poison the queue.
let mutationQueue = Promise.resolve();
function mutate(task) {
    const result = mutationQueue.then(task);
    mutationQueue = result.catch(() => {});
    return result;
}
let syncQueue = Promise.resolve();
function scheduleRuleSync() {
    syncQueue = syncQueue.catch(() => {}).then(syncDynamicRules);
    syncQueue.catch(console.error);
}

async function removeBlockedElement(selector, site) {
    const { blockedSelectors = {} } = await chrome.storage.local.get('blockedSelectors');
    const next = { ...blockedSelectors };
    const selectors = (next[site] || []).filter(entry => entry !== selector);
    if (selectors.length) next[site] = selectors;
    else delete next[site];
    await chrome.storage.local.set({ blockedSelectors: next });
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.disabledSites || changes.blockedUrls)) scheduleRuleSync();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    let task;
    if (msg.action === 'startPicker') {
        task = startPicker(msg.tabId);
    } else if (msg.action === 'blockElement' || msg.action === 'removeBlockedElement') {
        let site = msg.site;
        if (sender.tab) {
            try { site = new URL(sender.url || sender.tab.url).hostname; } catch (_) { site = ''; }
        }
        if (typeof site !== 'string' || !site || typeof msg.selector !== 'string' || !msg.selector || msg.selector.length > 16384) {
            sendResponse({ ok: false, error: 'Invalid element rule.' });
            return false;
        }
        task = mutate(() => msg.action === 'blockElement'
            ? addBlockedElement(msg.selector, site)
            : removeBlockedElement(msg.selector, site));
    } else if (msg.action === 'clearBlockedElements' && typeof msg.site === 'string' && !sender.tab) {
        task = mutate(async () => {
            const { blockedSelectors = {} } = await chrome.storage.local.get('blockedSelectors');
            const next = { ...blockedSelectors };
            delete next[msg.site];
            await chrome.storage.local.set({ blockedSelectors: next });
        });
    } else if (msg.action === 'importRules') {
        task = mutate(() => importRules(msg.data));
    } else return false;
    task.then(result => sendResponse({ ok: true, ...result }))
        .catch(error => sendResponse({ ok: false, error: error.message || 'The operation failed.' }));
    return true;
});

chrome.runtime.onInstalled.addListener(scheduleRuleSync);
chrome.runtime.onStartup.addListener(scheduleRuleSync);
