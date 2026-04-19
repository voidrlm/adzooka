(function () {
    if (location.hostname.includes('youtube.com')) return;

    const STYLE_ID = '__adzooka-cosmetic-user';
    const site = window.location.hostname;
    const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'SUMMARY', 'DETAILS', 'LABEL', 'TEXTAREA']);

    function applySelectors(selectors) {
        let el = document.getElementById(STYLE_ID);
        if (!selectors || selectors.length === 0) {
            if (el) el.remove();
            return;
        }
        if (!el) {
            el = document.createElement('style');
            el.id = STYLE_ID;
            (document.head || document.documentElement).appendChild(el);
        }
        el.textContent = selectors.map(s => `${s}{display:none!important}`).join('\n');
    }

    chrome.storage.local.get('blockedSelectors', ({ blockedSelectors = {} }) => {
        applySelectors(blockedSelectors[site] || []);
    });

    chrome.storage.onChanged.addListener((changes) => {
        if (changes.blockedSelectors) {
            applySelectors((changes.blockedSelectors.newValue || {})[site] || []);
        }
    });

    function isInteractive(el) {
        let node = el;
        while (node && node !== document.body) {
            if (INTERACTIVE.has(node.tagName)) return true;
            const role = node.getAttribute?.('role');
            if (role === 'button' || role === 'link' || role === 'menuitem') return true;
            if (node.hasAttribute?.('onclick')) return true;
            if (node.getAttribute?.('tabindex') === '0') return true;
            node = node.parentElement;
        }
        return false;
    }

    function normalizeUrl(url, base = document.baseURI) {
        if (typeof url !== 'string' || !url.trim()) return null;
        try {
            return new URL(url, base).href;
        } catch (_) {
            return null;
        }
    }

    function closestFormSubmitter(target) {
        return target?.closest?.('button[formaction], input[type="submit"][formaction], input[type="image"][formaction]') || null;
    }

    function collectIntent(target, event) {
        const link = target?.closest?.('a[href], area[href]') || null;
        const submitter = closestFormSubmitter(target);
        const form = submitter?.form || target?.closest?.('form') || null;
        const interactive = isInteractive(target);
        const ctrlLike = !!(event && (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1));

        const intent = {
            sourceUrl: location.href,
            interactive,
            kind: interactive ? 'interactive' : 'non-interactive',
            expectedUrls: [],
            expectedHosts: [],
            allowsPopup: interactive,
            allowsSelfNavigation: interactive,
            timestamp: Date.now(),
        };

        if (link) {
            const href = normalizeUrl(link.getAttribute('href'), link.baseURI);
            const targetAttr = (link.getAttribute('target') || '').toLowerCase();
            const newTab = ctrlLike || (targetAttr && !['', '_self', '_top', '_parent'].includes(targetAttr));

            intent.kind = 'link';
            intent.allowsPopup = newTab;
            intent.allowsSelfNavigation = !newTab;
            if (href) {
                intent.expectedUrls.push(href);
                intent.expectedHosts.push(new URL(href).host);
            }
            return intent;
        }

        if (submitter || form) {
            const actionSource = submitter || form;
            const actionAttr = actionSource?.getAttribute?.('formaction') || form?.getAttribute?.('action') || form?.action;
            const action = normalizeUrl(actionAttr || location.href, document.baseURI);
            const targetAttr = (actionSource?.getAttribute?.('formtarget') || form?.getAttribute?.('target') || '').toLowerCase();
            const newTab = ctrlLike || (targetAttr && !['', '_self', '_top', '_parent'].includes(targetAttr));

            intent.kind = 'form';
            intent.allowsPopup = newTab;
            intent.allowsSelfNavigation = !newTab;
            if (action) {
                intent.expectedUrls.push(action);
                intent.expectedHosts.push(new URL(action).host);
            }
            return intent;
        }

        return intent;
    }

    function sendIntent(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;

        chrome.runtime.sendMessage({
            action: 'gestureIntent',
            payload: collectIntent(target, event),
        }).catch?.(() => {});
    }

    document.addEventListener('mousedown', sendIntent, true);
    document.addEventListener('touchstart', sendIntent, { capture: true, passive: true });
    document.addEventListener('pointerdown', sendIntent, { capture: true, passive: true });
})();
