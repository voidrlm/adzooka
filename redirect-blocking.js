(function () {
    const LOG_PREFIX = '[Adzooka Redirect Blocker]';
    const BUILT_IN_ALLOWED_URLS = [
        'chrome://',
        'chrome-extension://',
        'edge://',
        'about:',
        'https://google.com/',
    ];
    const DEFAULT_SETTINGS = {
        enabled: true,
        preventSameTabRedirects: false,
        allowedURLs: [],
        savedURLs: [],
        tabExclusive: false,
    };

    let allTabsModeIsOn = true;
    let settings = DEFAULT_SETTINGS;
    let allowedURLs = [...BUILT_IN_ALLOWED_URLS];
    let keepAlive = null;
    const extensionTabs = [];
    const disabledTabs = [];

    function log(...args) {
        console.log(LOG_PREFIX, ...args);
    }

    function normalizeUrl(url) {
        return String(url || '')
            .replace(/^https?:\/\/(www\.)?(ww\d+\.)?/, 'https://')
            .replace(/\/([^?]+).*$/, '/$1')
            .replace(/\/$/, '')
            .toLowerCase();
    }

    function isURLMatch(urls, url) {
        if (!url) return false;
        const normalizedUrl = normalizeUrl(url);
        return urls.some((currentUrl) => {
            const normalizedCurrentUrl = normalizeUrl(currentUrl);
            return normalizedUrl === normalizedCurrentUrl ||
                normalizedUrl.startsWith(`${normalizedCurrentUrl}/`);
        });
    }

    function getTabUrl(tab) {
        return tab?.pendingUrl || tab?.url || '';
    }

    function isBrowserUrl(url) {
        return /^(chrome|chrome-extension|edge|about):/i.test(url || '');
    }

    async function siteIsDisabled(url) {
        try {
            const hostname = new URL(url).hostname;
            const { disabledSites = [] } = await chrome.storage.local.get('disabledSites');
            return disabledSites.includes(hostname);
        } catch (_) {
            return false;
        }
    }

    function combinedAllowedUrls(sourceUrl) {
        const urls = [...allowedURLs, ...(settings.savedURLs || [])];
        try {
            urls.push(new URL(sourceUrl).origin);
        } catch (_) {}
        return urls;
    }

    async function setExtensionTabs(newExtensionTabs) {
        extensionTabs.splice(0, extensionTabs.length, ...newExtensionTabs.filter((tab) => tab?.id));
        saveExtTabs();
    }

    async function updateExtensionTab(tab, instantSave = false) {
        if (!tab?.id || isBrowserUrl(getTabUrl(tab))) return null;

        const tabUrl = getTabUrl(tab);
        if (await siteIsDisabled(tabUrl)) {
            removeExtensionTab({ id: tab.id }, true);
            return null;
        }

        const tabData = {
            id: tab.id,
            url: tabUrl,
            active: !!tab.active,
            windowId: tab.windowId,
            windowActive: tab.windowId === (await getCurrentWindowId()),
            savedURL: isURLMatch(settings.savedURLs || [], tabUrl),
        };
        const index = extensionTabs.findIndex((item) => item.id === tab.id);
        if (index >= 0) extensionTabs[index] = tabData;
        else extensionTabs.push(tabData);

        sendToggledStateToContentScript(tab.id, true);
        if (instantSave) saveExtTabs();
        else debouncedSaveExtTabs();
        return tabData;
    }

    function removeExtensionTab(extTab, instantSave = false) {
        const index = extensionTabs.findIndex((item) => item.id === extTab.id);
        if (index < 0) return;
        const [removed] = extensionTabs.splice(index, 1);
        sendToggledStateToContentScript(removed.id, false);
        if (instantSave) saveExtTabs();
        else debouncedSaveExtTabs();
    }

    function removeDisabledTab(disabledTab) {
        const index = disabledTabs.findIndex((item) => item.id === disabledTab.id);
        if (index < 0) return;
        disabledTabs.splice(index, 1);
        checkDisabledTabs();
    }

    function saveExtTabs() {
        const uniqueTabs = [...new Set(extensionTabs.map((tab) => tab.id))]
            .map((id) => extensionTabs.find((tab) => tab.id === id));
        extensionTabs.splice(0, extensionTabs.length, ...uniqueTabs);
        chrome.storage.local.set({
            adzookaRedirectExtensionTabs: extensionTabs,
            adzookaRedirectAllTabsModeIsOn: allTabsModeIsOn,
        });
    }

    const debouncedSaveExtTabs = debounce(() => {
        saveExtTabs();
        if (!keepAlive) persistServiceWorker();
    }, 5000);

    function sendToggledStateToContentScript(tabId, isToggledOn) {
        chrome.tabs.sendMessage(tabId, {
            action: 'adzookaRedirectToggleTab',
            isToggledOn,
        }).catch(() => {});
    }

    function persistServiceWorker() {
        if (keepAlive) clearInterval(keepAlive);
        keepAlive = setInterval(checkTabs, 1000 * 25);
    }

    function checkTabs() {
        chrome.tabs.query({}).then((tabs) => {
            for (let i = extensionTabs.length - 1; i >= 0; i -= 1) {
                if (!tabs.find((tab) => tab.id === extensionTabs[i].id)) {
                    extensionTabs.splice(i, 1);
                }
            }
            saveExtTabs();
        }).catch(() => {});
    }

    function checkDisabledTabs() {
        chrome.tabs.query({}).then((tabs) => {
            for (let i = disabledTabs.length - 1; i >= 0; i -= 1) {
                if (!tabs.find((tab) => tab.id === disabledTabs[i].id)) {
                    disabledTabs.splice(i, 1);
                }
            }
            chrome.storage.local.set({ adzookaRedirectDisabledTabs: disabledTabs });
        }).catch(() => {});
    }

    async function protectExistingTabs() {
        const tabs = await chrome.tabs.query({}).catch(() => []);
        const protectedTabs = [];
        for (const tab of tabs) {
            if (!tab?.id || isBrowserUrl(getTabUrl(tab))) continue;
            if (await siteIsDisabled(getTabUrl(tab))) continue;
            protectedTabs.push(tab);
        }
        allTabsModeIsOn = true;
        await setExtensionTabs(protectedTabs);
    }

    async function handleCreatedTab(tab) {
        if (!settings.enabled || !tab?.id) return;

        const sourceTab = tab.openerTabId
            ? await chrome.tabs.get(tab.openerTabId).catch(() => null)
            : extensionTabs.find((item) => item.active && item.windowId === tab.windowId);

        const protectedSource = sourceTab
            ? extensionTabs.find((item) => item.id === sourceTab.id)
            : null;

        if (!protectedSource) {
            if (allTabsModeIsOn) await updateExtensionTab(tab, true);
            return;
        }

        let waitedMs = 0;
        const interval = setInterval(async () => {
            const updatedTab = await chrome.tabs.get(tab.id).catch(() => null);
            if (!updatedTab) {
                clearInterval(interval);
                return;
            }

            waitedMs += 20;
            const targetUrl = getTabUrl(updatedTab);
            if (!targetUrl && waitedMs < 1000) return;
            clearInterval(interval);

            if (!targetUrl || isBrowserUrl(targetUrl) || await siteIsDisabled(targetUrl)) return;

            const allowed = isURLMatch(combinedAllowedUrls(protectedSource.url), targetUrl);
            if (allowed) {
                if (updatedTab.active) await chrome.tabs.update(updatedTab.id, { active: true }).catch(() => null);
                if (allTabsModeIsOn) await updateExtensionTab(updatedTab, true);
                return;
            }

            log('Blocked new-tab redirect:', targetUrl);
            await chrome.tabs.remove(updatedTab.id).catch(() => null);
        }, 20);
    }

    async function handleUpdatedTab(tabId, _changeInfo, tab) {
        if (!settings.enabled || !tab?.url) return;

        const disabledTab = disabledTabs.find((item) => item.id === tabId);
        if (disabledTab) {
            try {
                if (new URL(disabledTab.url).hostname === new URL(tab.url).hostname) return;
            } catch (_) {}
            removeDisabledTab(disabledTab);
        }

        const existing = extensionTabs.find((item) => item.id === tabId);
        if (await siteIsDisabled(tab.url)) {
            if (existing) removeExtensionTab(existing, true);
            return;
        }

        if (allTabsModeIsOn && !existing && !isBrowserUrl(tab.url)) {
            await updateExtensionTab(tab, true);
            return;
        }

        if (isURLMatch(settings.savedURLs || [], tab.url) && !existing) {
            await updateExtensionTab(tab, true);
            return;
        }

        if (existing) {
            if (isURLMatch([...(settings.savedURLs || []), ...allowedURLs], tab.url)) {
                try {
                    if (
                        new URL(existing.url).origin !== new URL(tab.url).origin &&
                        !settings.tabExclusive &&
                        !allTabsModeIsOn
                    ) {
                        removeExtensionTab(existing, true);
                        return;
                    }
                } catch (_) {}
            }
            await updateExtensionTab(tab);
        }
    }

    async function handleActivated(activeInfo) {
        if (!settings.enabled) return;
        const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
        if (!tab) return;

        for (const extTab of [...extensionTabs]) {
            if (extTab.id === tab.id) {
                await updateExtensionTab(tab);
                continue;
            }
            if (extTab.active && extTab.windowId === tab.windowId) {
                const chromeTab = await chrome.tabs.get(extTab.id).catch(() => null);
                if (!chromeTab) removeExtensionTab(extTab);
                else await updateExtensionTab(chromeTab);
            }
        }

        if (allTabsModeIsOn && !extensionTabs.find((item) => item.id === tab.id)) {
            await updateExtensionTab(tab, true);
        }
    }

    async function handleWindowCreated(window) {
        if (!settings.enabled) return;
        const extTab = extensionTabs.find((item) => item.active && item.windowActive);
        if (!extTab || window.type !== 'popup') return;

        const popupTab = (await chrome.tabs.query({ windowId: window.id }).catch(() => []))[0];
        const popupUrl = getTabUrl(popupTab);
        if (!popupUrl || isURLMatch(combinedAllowedUrls(extTab.url), popupUrl)) return;

        log('Blocked popup redirect window:', popupUrl);
        chrome.windows.remove(window.id).catch(() => null);
    }

    async function onTabMoved(tabId) {
        const extTab = extensionTabs.find((item) => item.id === tabId);
        if (!extTab) return;
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (tab) await updateExtensionTab(tab);
    }

    function handleStorageChanged(changes) {
        if (changes.adzookaRedirectSettings?.newValue) {
            applySettings(changes.adzookaRedirectSettings.newValue);
        }

        if (changes.adzookaRedirectExtensionTabs?.newValue) {
            extensionTabs.splice(0, extensionTabs.length, ...changes.adzookaRedirectExtensionTabs.newValue);
        }

        if (changes.adzookaRedirectAllTabsModeIsOn?.newValue !== undefined) {
            allTabsModeIsOn = !!changes.adzookaRedirectAllTabsModeIsOn.newValue;
        }

        if (changes.adzookaRedirectDisabledTabs?.newValue) {
            disabledTabs.splice(0, disabledTabs.length, ...changes.adzookaRedirectDisabledTabs.newValue);
            checkDisabledTabs();
        }

        if (changes.disabledSites) {
            protectExistingTabs().catch(console.error);
        }
    }

    function handleMessage(message, sender, sendResponse) {
        if (message?.action === 'adzookaRedirectGetTabId') {
            sendResponse({ tabId: sender.tab?.id ?? null });
            return;
        }

        if (message?.action === 'adzookaRedirectGetTabToggledState') {
            const tabToggledState = extensionTabs.find((item) => item.id === sender.tab?.id);
            sendResponse({ tabToggledState: !!tabToggledState });
            return;
        }

        if (message?.action === 'adzookaRedirectGetSettings') {
            sendResponse({ settings });
            return;
        }

        if (message?.adzookaRedirectToggleSingle === true) {
            chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
                if (!tab) return;
                const extTab = extensionTabs.find((item) => item.id === tab.id);
                if (extTab) removeExtensionTab(extTab, true);
                else updateExtensionTab(tab, true);
            });
            return;
        }

        if (message?.adzookaRedirectToggleAll === true) {
            if (allTabsModeIsOn) {
                extensionTabs.splice(0, extensionTabs.length);
                allTabsModeIsOn = false;
                saveExtTabs();
            } else {
                protectExistingTabs().catch(console.error);
            }
        }
    }

    function applySettings(nextSettings) {
        settings = { ...DEFAULT_SETTINGS, ...(nextSettings || {}) };
        allowedURLs = [...(settings.allowedURLs || []), ...BUILT_IN_ALLOWED_URLS];
    }

    function debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }

    async function getCurrentWindowId() {
        const window = await chrome.windows.getCurrent().catch(() => null);
        return window?.id;
    }

    async function initializeRedirectBlocking() {
        const stored = await chrome.storage.local.get([
            'adzookaRedirectSettings',
            'adzookaRedirectExtensionTabs',
            'adzookaRedirectDisabledTabs',
            'adzookaRedirectAllTabsModeIsOn',
        ]);

        applySettings(stored.adzookaRedirectSettings);
        extensionTabs.splice(0, extensionTabs.length, ...(stored.adzookaRedirectExtensionTabs || []));
        disabledTabs.splice(0, disabledTabs.length, ...(stored.adzookaRedirectDisabledTabs || []));
        allTabsModeIsOn = stored.adzookaRedirectAllTabsModeIsOn !== false;

        if (!stored.adzookaRedirectSettings) {
            await chrome.storage.local.set({ adzookaRedirectSettings: settings });
        }

        if (settings.enabled && allTabsModeIsOn) {
            await protectExistingTabs();
            persistServiceWorker();
        }
    }

    chrome.runtime.onStartup.addListener(() => initializeRedirectBlocking().catch(console.error));
    chrome.runtime.onInstalled.addListener(() => initializeRedirectBlocking().catch(console.error));
    chrome.tabs.onCreated.addListener((tab) => handleCreatedTab(tab).catch(console.error));
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => handleUpdatedTab(tabId, changeInfo, tab).catch(console.error));
    chrome.tabs.onActivated.addListener((activeInfo) => handleActivated(activeInfo).catch(console.error));
    chrome.tabs.onRemoved.addListener((tabId) => removeExtensionTab({ id: tabId }, true));
    chrome.tabs.onAttached.addListener((tabId) => onTabMoved(tabId).catch(console.error));
    chrome.tabs.onDetached.addListener((tabId) => onTabMoved(tabId).catch(console.error));
    chrome.windows.onCreated.addListener((window) => handleWindowCreated(window).catch(console.error));
    chrome.storage.onChanged.addListener(handleStorageChanged);
    chrome.runtime.onMessage.addListener(handleMessage);

    initializeRedirectBlocking().catch(console.error);
})();
