// Shared by the persistent content script and the on-demand picker.
(() => {
    if (globalThis.__adzookaUserRules) return;
    const SHADOW_PREFIX = 'adzooka-shadow:';
    const FRAME_PREFIX = 'adzooka-frame-cluster:';
    const styles = new Map();
    let rules = [];
    let enabled = true;
    let timer = 0;
    let retryTimer = 0;
    let observer = null;

    function unique(root, selector, element) {
        try {
            const matches = root.querySelectorAll(selector);
            return matches.length === 1 && matches[0] === element;
        } catch (_) { return false; }
    }

    function localSelector(element) {
        const root = element.getRootNode();
        const parts = [];
        for (let node = element; node?.nodeType === 1; node = node.parentElement) {
            const tag = CSS.escape(node.localName);
            const candidates = [];
            if (node.id) candidates.push(`#${CSS.escape(node.id)}`);
            for (const attr of ['data-testid', 'data-ad-slot', 'data-zone', 'aria-label', 'name']) {
                const value = node.getAttribute(attr);
                if (value && value.length < 160) candidates.push(`${tag}[${attr}="${CSS.escape(value)}"]`);
            }
            const classes = Array.from(node.classList).filter(value =>
                value.length < 80 && !/^(active|selected|hover|focus|open|hidden|is-|has-)/.test(value)
            ).slice(0, 3);
            if (classes.length) candidates.push(tag + classes.map(value => `.${CSS.escape(value)}`).join(''));
            for (const candidate of candidates) {
                const selector = [candidate, ...parts].join(' > ');
                if (unique(root, selector, element)) return selector;
            }
            let index = 1;
            for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
                if (sibling.localName === node.localName) index++;
            }
            parts.unshift(`${tag}:nth-of-type(${index})`);
            if (!node.parentElement) {
                const selector = parts.join(' > ');
                if (unique(root, selector, element)) return selector;
            }
        }
        throw new Error('Could not create an exact selector. Pick another element.');
    }

    function selectorFor(element) {
        const path = [];
        let node = element;
        while (node) {
            path.unshift(localSelector(node));
            const root = node.getRootNode();
            node = root instanceof ShadowRoot ? root.host : null;
        }
        return path.length === 1 ? path[0] : SHADOW_PREFIX + JSON.stringify(path);
    }

    function resolve(rule) {
        if (rule.startsWith(SHADOW_PREFIX)) {
            const path = JSON.parse(rule.slice(SHADOW_PREFIX.length));
            if (!Array.isArray(path) || path.length < 2 || path.length > 32 ||
                !path.every(part => typeof part === 'string' && part.length)) throw new Error('Invalid shadow rule');
            let root = document;
            for (const part of path.slice(0, -1)) {
                root = root.querySelector(part)?.shadowRoot;
                if (!root) return null;
            }
            return { root, selector: path[path.length - 1] };
        }
        if (rule.startsWith(FRAME_PREFIX)) {
            const spec = JSON.parse(rule.slice(FRAME_PREFIX.length));
            if (!Number.isInteger(spec.index) || spec.index < 0) return null;
            const anchor = document.querySelector(spec.anchor || 'body');
            const frame = anchor?.querySelectorAll('iframe, frame')[spec.index];
            return frame ? { root: document, selector: localSelector(frame) } : null;
        }
        return { root: document, selector: rule };
    }

    function createStyle(root, selectors) {
        const style = document.createElement('style');
        style.dataset.adzookaRules = '';
        (root === document ? document.head || document.documentElement : root)?.appendChild(style);
        for (const selector of selectors) {
            try {
                // Parsing separately prevents malformed imports from becoming CSS declarations.
                root.querySelector(selector);
                style.sheet.insertRule(`${selector}{display:none!important}`, style.sheet.cssRules.length);
            } catch (_) { /* One invalid imported rule must not disable the others. */ }
        }
        return style;
    }

    function refresh() {
        clearTimeout(timer);
        timer = 0;
        observer?.disconnect();
        const groups = new Map();
        if (enabled) for (const rule of rules) {
            try {
                const resolved = resolve(rule);
                if (!resolved) continue;
                const list = groups.get(resolved.root) || [];
                list.push(resolved.selector);
                groups.set(resolved.root, list);
            } catch (_) {}
        }
        for (const [root, entry] of styles) {
            if (!groups.has(root)) { entry.style.remove(); styles.delete(root); }
        }
        for (const [root, selectors] of groups) {
            const key = JSON.stringify(selectors);
            const entry = styles.get(root);
            if (entry?.key === key && entry.style.isConnected) continue;
            entry?.style.remove();
            styles.set(root, { key, style: createStyle(root, selectors) });
        }
        const dynamic = enabled && rules.some(rule => rule.startsWith(SHADOW_PREFIX) || rule.startsWith(FRAME_PREFIX));
        clearTimeout(retryTimer);
        if (dynamic) {
            observer ||= new MutationObserver(schedule);
            observer.observe(document, { childList: true, subtree: true });
            for (const root of groups.keys()) if (root !== document) observer.observe(root, { childList: true, subtree: true });
            // attachShadow() itself produces no mutation on the host. Resolve only saved
            // paths, never scan the DOM, and release replaced roots on every refresh.
            retryTimer = setTimeout(refresh, document.hidden ? 5000 : 1000);
        }
    }

    function schedule() {
        if (!timer) timer = setTimeout(refresh, 80);
    }

    globalThis.__adzookaUserRules = { selectorFor, resolve, SHADOW_PREFIX };
    let storageRevision = 0;
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (!changes.blockedSelectors && !changes.disabledSites) return;
        storageRevision++;
        if (changes.blockedSelectors) rules = (changes.blockedSelectors.newValue || {})[location.hostname] || [];
        if (changes.disabledSites) enabled = !(changes.disabledSites.newValue || []).includes(location.hostname);
        refresh();
    });
    async function initialize() {
        const initialRevision = storageRevision;
        const data = await chrome.storage.local.get(['blockedSelectors', 'disabledSites']);
        if (storageRevision !== initialRevision) return initialize();
        rules = (data.blockedSelectors || {})[location.hostname] || [];
        enabled = !(data.disabledSites || []).includes(location.hostname);
        refresh();
    }
    initialize().catch(console.error);
    window.addEventListener('pagehide', () => {
        observer?.disconnect();
        clearTimeout(timer);
        clearTimeout(retryTimer);
        timer = 0;
    });
    window.addEventListener('pageshow', refresh);
    document.addEventListener('DOMContentLoaded', refresh, { once: true });
})();
