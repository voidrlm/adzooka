(function () {
    let tabId = null;
    let isTabToggledOn = false;
    let isSameTabRedirectsPrevented = false;
    let combinedURLs = [];
    let preventingSameTabRedirects = false;
    let observer = null;

    function normalizeUrl(url) {
        return String(url || '')
            .replace(/^https?:\/\/(www\.)?(ww\d+\.)?/, 'https://')
            .replace(/\/([^?]+).*$/, '/$1')
            .replace(/\/$/, '')
            .toLowerCase();
    }

    function isURLMatchSameTab(urls, url) {
        if (!url) return false;
        const normalizedUrl = normalizeUrl(url);
        return urls.some((currentUrl) => {
            const normalizedCurrentUrl = normalizeUrl(currentUrl);
            return normalizedUrl === normalizedCurrentUrl ||
                normalizedUrl.startsWith(`${normalizedCurrentUrl}/`);
        });
    }

    function preventSameTabRedirect(event) {
        if (!isTabToggledOn || !isSameTabRedirectsPrevented) return;

        let anchor = event.target;
        if (anchor?.tagName !== 'A') {
            anchor = anchor?.closest?.('a');
        }

        if (!anchor?.href) return;
        if (isURLMatchSameTab(combinedURLs, anchor.href)) return;

        console.log('[Adzooka Redirect Blocker] Same-tab redirect blocked:', anchor.href);
        event.preventDefault();
        event.stopPropagation();
    }

    function addLinkListeners(root = document) {
        if (root instanceof HTMLAnchorElement) {
            root.removeEventListener('click', preventSameTabRedirect);
            root.addEventListener('click', preventSameTabRedirect);
            return;
        }

        root.querySelectorAll?.('a').forEach((link) => {
            link.removeEventListener('click', preventSameTabRedirect);
            link.addEventListener('click', preventSameTabRedirect);
        });
    }

    function beginPreventionOfSameTabRedirects() {
        if (!isTabToggledOn || !isSameTabRedirectsPrevented || preventingSameTabRedirects) return;

        preventingSameTabRedirects = true;
        addLinkListeners(document);

        observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node instanceof HTMLElement) addLinkListeners(node);
                }
            }
        });

        const root = document.body || document.documentElement;
        if (root) observer.observe(root, { childList: true, subtree: true });
    }

    function endPreventionOfSameTabRedirects() {
        preventingSameTabRedirects = false;
        observer?.disconnect();
        observer = null;
        document.querySelectorAll('a').forEach((link) => {
            link.removeEventListener('click', preventSameTabRedirect);
        });
    }

    function applySettings(settings) {
        isSameTabRedirectsPrevented = !!settings?.preventSameTabRedirects;
        combinedURLs = [
            ...(settings?.allowedURLs || []),
            ...(settings?.savedURLs || []),
            window.origin,
        ];

        if (isTabToggledOn && isSameTabRedirectsPrevented) beginPreventionOfSameTabRedirects();
        else endPreventionOfSameTabRedirects();
    }

    chrome.runtime.sendMessage({ action: 'adzookaRedirectGetTabId' }, (response) => {
        tabId = response?.tabId ?? null;
    });

    chrome.runtime.sendMessage({ action: 'adzookaRedirectGetTabToggledState' }, (response) => {
        isTabToggledOn = !!response?.tabToggledState;
        if (isTabToggledOn) beginPreventionOfSameTabRedirects();
        else endPreventionOfSameTabRedirects();
    });

    chrome.runtime.sendMessage({ action: 'adzookaRedirectGetSettings' }, (response) => {
        applySettings(response?.settings);
    });

    chrome.runtime.onMessage.addListener((request) => {
        if (request.action !== 'adzookaRedirectToggleTab') return;

        isTabToggledOn = !!request.isToggledOn;
        if (isTabToggledOn) beginPreventionOfSameTabRedirects();
        else endPreventionOfSameTabRedirects();
    });

    chrome.storage.local.get([
        'adzookaRedirectExtensionTabs',
        'adzookaRedirectSettings',
    ], (result) => {
        const extensionTabs = result.adzookaRedirectExtensionTabs || [];
        isTabToggledOn = !!extensionTabs.find((tab) => tab.id === tabId);
        applySettings(result.adzookaRedirectSettings);
    });

    chrome.storage.onChanged.addListener((changes) => {
        if (changes.adzookaRedirectExtensionTabs) {
            const extensionTabs = changes.adzookaRedirectExtensionTabs.newValue || [];
            isTabToggledOn = !!extensionTabs.find((tab) => tab.id === tabId);
            if (isTabToggledOn) beginPreventionOfSameTabRedirects();
            else endPreventionOfSameTabRedirects();
        }

        if (changes.adzookaRedirectSettings) {
            applySettings(changes.adzookaRedirectSettings.newValue);
        }
    });
})();
