(function () {
    if (window.__adzookaPickerActive) return;
    window.__adzookaPickerActive = true;

    const shield = document.createElement('div');
    shield.style.cssText = 'position:fixed;inset:0;cursor:crosshair;background:transparent;';
    shield.style.setProperty('z-index', '2147483647', 'important');
    shield.style.setProperty('pointer-events', 'auto', 'important');
    document.documentElement.appendChild(shield);

    const selfRaise = new MutationObserver(() => {
        if (document.documentElement.lastElementChild !== shield) {
            document.documentElement.appendChild(shield);
        }
    });
    selfRaise.observe(document.documentElement, { childList: true });

    const styleGuard = new MutationObserver(() => {
        const pe = shield.style.getPropertyValue('pointer-events');
        const pri = shield.style.getPropertyPriority('pointer-events');
        const zi = shield.style.getPropertyValue('z-index');

        if (pe !== 'auto' || pri !== 'important') {
            shield.style.setProperty('pointer-events', 'auto', 'important');
        }
        if (zi !== '2147483647') {
            shield.style.setProperty('z-index', '2147483647', 'important');
        }
    });
    styleGuard.observe(shield, { attributes: true, attributeFilter: ['style'] });

    const highlight = document.createElement('div');
    Object.assign(highlight.style, {
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: '2147483648',
        border: '3px solid #ff2f6d',
        background: 'rgba(255,47,109,0.22)',
        boxShadow: '0 0 0 9999px rgba(0,0,0,0.08), 0 0 0 2px rgba(255,255,255,0.85)',
        borderRadius: '3px',
        display: 'none',
        boxSizing: 'border-box',
    });
    document.documentElement.appendChild(highlight);

    const label = document.createElement('div');
    Object.assign(label.style, {
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: '2147483649',
        background: '#e94560',
        color: '#fff',
        fontSize: '11px',
        fontFamily: 'monospace, sans-serif',
        padding: '2px 7px',
        borderRadius: '3px',
        display: 'none',
        whiteSpace: 'nowrap',
        maxWidth: '90vw',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    });
    document.documentElement.appendChild(label);

    const hint = document.createElement('div');
    Object.assign(hint.style, {
        position: 'fixed',
        top: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '2147483647',
        background: 'rgba(11,14,20,0.92)',
        color: '#dce4f0',
        fontSize: '12px',
        fontFamily: 'sans-serif',
        padding: '6px 14px',
        borderRadius: '6px',
        border: '1px solid #e94560',
        pointerEvents: 'none',
    });
    hint.textContent = 'Adzooka: Click elements to block  |  ESC to finish';
    document.documentElement.appendChild(hint);

    const pickerUi = new Set([shield, highlight, label, hint]);
    const defaultHint = hint.textContent;
    const FRAME_CLUSTER_PREFIX = 'adzooka-frame-cluster:';
    const pickedSelectors = new Set();
    const localStyle = document.createElement('style');
    localStyle.id = '__adzooka-picker-live-rules';
    document.documentElement.appendChild(localStyle);
    let hintTimer = null;
    let currentEl = null;

    function getAdUrl(el) {
        const nestedFrame = el.querySelector?.('iframe[src], frame[src]');
        const candidates = [
            el.src,
            el.href,
            el.getAttribute('data-src'),
            el.getAttribute('data-lazy-src'),
            nestedFrame?.src,
            nestedFrame?.getAttribute('src'),
            el.closest('iframe[src], frame[src]')?.src,
            el.closest('a')?.href,
            el.closest('[src]')?.src,
        ];

        for (const value of candidates) {
            try {
                if (value && /^https?:\/\//.test(value)) return value;
            } catch (_) {}
        }
        return null;
    }

    function looksRandom(str) {
        if (/^[a-z]{0,2}[0-9a-f]{8,}$/i.test(str)) return true;
        if (/^[a-z0-9]{5,14}$/i.test(str) && /\d/.test(str) && /[a-z]/i.test(str)) return true;
        if (str.length > 18 && /^[a-z0-9]+$/.test(str)) return true;
        return false;
    }

    function isStableId(value) {
        return typeof value === 'string' && value.length > 1 && !looksRandom(value);
    }

    function hostnameOf(url) {
        try {
            return new URL(url, window.location.href).hostname;
        } catch (_) {
            return null;
        }
    }

    function isSameSiteHost(hostname) {
        return typeof hostname === 'string' &&
            hostname.toLowerCase() === window.location.hostname.toLowerCase();
    }

    function absoluteHttpUrl(value) {
        if (typeof value !== 'string' || !value.trim()) return null;
        try {
            const parsed = new URL(value.trim(), window.location.href);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
        } catch (_) {}
        return null;
    }

    function urlsFromSrcset(value) {
        if (typeof value !== 'string') return [];
        return value
            .split(',')
            .map((entry) => entry.trim().split(/\s+/)[0])
            .map(absoluteHttpUrl)
            .filter(Boolean);
    }

    function urlsFromElement(el) {
        const urls = [];
        const attrs = [
            'src',
            'href',
            'data-src',
            'data-lazy-src',
            'data-original',
            'data-url',
            'data-href',
            'poster',
            'data',
        ];

        for (const attr of attrs) {
            const url = absoluteHttpUrl(el.getAttribute?.(attr));
            if (url) urls.push(url);
        }

        for (const prop of ['src', 'href', 'currentSrc']) {
            const url = absoluteHttpUrl(el[prop]);
            if (url) urls.push(url);
        }

        urls.push(...urlsFromSrcset(el.getAttribute?.('srcset')));
        urls.push(...urlsFromSrcset(el.getAttribute?.('data-srcset')));
        return urls;
    }

    function collectExternalUrls(root) {
        const byHost = new Map();
        const nodes = [
            root,
            ...(root.querySelectorAll?.('[src], [href], [data-src], [data-lazy-src], [data-original], [data-url], [data-href], [poster], [data], [srcset], [data-srcset]') || []),
        ];

        for (const node of nodes) {
            for (const url of urlsFromElement(node)) {
                const host = hostnameOf(url);
                if (!host || isSameSiteHost(host)) continue;
                if (!byHost.has(host)) byHost.set(host, url);
            }
        }

        return Array.from(byHost.values());
    }

    function selectorValueFromUrl(url) {
        try {
            const parsed = new URL(url, window.location.href);
            if (parsed.hostname && !isSameSiteHost(parsed.hostname)) {
                return parsed.hostname;
            }

            const path = parsed.pathname.replace(/\/+$/, '');
            if (path && path !== '/') return path;

            if (parsed.search) return `${parsed.pathname || ''}${parsed.search}`;
        } catch (_) {}
        return null;
    }

    function stableClasses(el, max = 2) {
        return Array.from(el.classList)
            .filter((cls) => cls.length > 1 && !looksRandom(cls) && !/^(js-|is-|has-|active|open|hidden|show|hide|visible)$/.test(cls))
            .slice(0, max)
            .map((cls) => `.${CSS.escape(cls)}`)
            .join('');
    }

    function directChildIndex(el) {
        const parent = el.parentElement;
        if (!parent) return 1;
        const siblings = Array.from(parent.children).filter((node) => node.tagName === el.tagName);
        return Math.max(1, siblings.indexOf(el) + 1);
    }

    function directNthSegment(el) {
        const tag = el.tagName.toLowerCase();
        return `${tag}:nth-of-type(${directChildIndex(el)})`;
    }

    function findStableAnchor(el) {
        let node = el;
        while (node && node !== document.body && node !== document.documentElement) {
            if (isStableId(node.id)) return `#${CSS.escape(node.id)}`;

            for (const attr of ['data-testid', 'data-section', 'data-block', 'role', 'aria-label']) {
                const value = node.getAttribute?.(attr);
                if (value && !looksRandom(value) && value.length < 80) {
                    return `${node.tagName.toLowerCase()}[${attr}="${CSS.escape(value)}"]`;
                }
            }

            const classes = stableClasses(node, 1);
            if (classes) return `${node.tagName.toLowerCase()}${classes}`;
            node = node.parentElement;
        }
        return null;
    }

    function findSemanticAnchor(el) {
        let node = el;
        while (node && node !== document.body && node !== document.documentElement) {
            if (isStableId(node.id)) return `#${CSS.escape(node.id)}`;

            for (const attr of ['data-testid', 'data-section', 'data-block', 'data-zone', 'aria-label']) {
                const value = node.getAttribute?.(attr);
                if (value && !looksRandom(value) && value.length < 80) {
                    return `${node.tagName.toLowerCase()}[${attr}="${CSS.escape(value)}"]`;
                }
            }

            node = node.parentElement;
        }
        return 'body';
    }

    function anchorElementForSelector(anchorSelector, target) {
        if (anchorSelector === 'body') return document.body;
        try {
            return target.closest(anchorSelector);
        } catch (_) {
            return null;
        }
    }

    function buildStructuralSelector(target, allowClassAnchor = true) {
        const anchorSelector = (allowClassAnchor ? findStableAnchor(target.parentElement || target) : null) || 'body';
        const anchorNode = anchorElementForSelector(anchorSelector, target);
        if (!anchorNode) return null;

        if ((target.matches('iframe, frame')) && anchorNode.querySelectorAll('iframe, frame').length === 1) {
            return `${anchorSelector} iframe`;
        }

        const segments = [];
        let node = target;
        let guard = 0;
        while (node && node !== anchorNode && node.parentElement && guard < 20) {
            segments.unshift(directNthSegment(node));
            node = node.parentElement;
            guard += 1;
        }

        if (node !== anchorNode) return null;
        if (!segments.length) return anchorSelector;
        return `${anchorSelector} > ${segments.join(' > ')}`;
    }

    function iframeOrdinalInScope(frame, scope) {
        const frames = Array.from(scope.querySelectorAll('iframe, frame'));
        return Math.max(0, frames.indexOf(frame));
    }

    function frameClusterSelectorFor(frame) {
        if (!frame?.matches?.('iframe, frame')) return null;
        const anchorSelector = findSemanticAnchor(frame.parentElement || frame);
        const anchor = anchorElementForSelector(anchorSelector, frame) || document.body;
        const rule = {
            v: 1,
            anchor: anchorSelector,
            index: iframeOrdinalInScope(frame, anchor),
        };
        return `${FRAME_CLUSTER_PREFIX}${JSON.stringify(rule)}`;
    }

    function selectorForEl(el) {
        const tag = el.tagName.toLowerCase();
        const nestedFrame = el.matches('iframe, frame') ? el : el.querySelector?.('iframe[src], frame[src]');

        if (nestedFrame) {
            const frameValue = selectorValueFromUrl(nestedFrame.getAttribute('src') || nestedFrame.src);
            if (frameValue) return `iframe[src*="${CSS.escape(frameValue)}"]`;
        }

        if (el.id && !looksRandom(el.id)) return `#${CSS.escape(el.id)}`;

        const src = el.getAttribute('src');
        if (src) {
            const value = selectorValueFromUrl(src);
            if (value) return `${tag}[src*="${CSS.escape(value)}"]`;
        }

        const href = el.getAttribute('href');
        if (href) {
            const value = selectorValueFromUrl(href);
            if (value) return `${tag}[href*="${CSS.escape(value)}"]`;
        }

        const dataSrc = el.getAttribute('data-src') || el.getAttribute('data-lazy-src');
        if (dataSrc) {
            const value = selectorValueFromUrl(dataSrc);
            if (value) return `${tag}[data-src*="${CSS.escape(value)}"]`;
        }

        for (const attr of ['data-ad-slot', 'data-ad-unit', 'data-adunit', 'data-widget-id', 'data-zone']) {
            const value = el.getAttribute(attr);
            if (value) return `${tag}[${attr}="${CSS.escape(value)}"]`;
        }

        const classes = stableClasses(el);
        if (classes) return `${tag}${classes}`;

        return null;
    }

    function getSelector(el) {
        const nestedFrame = el.matches('iframe, frame') ? el : el.querySelector?.('iframe, frame');
        if (nestedFrame) {
            const frameValue = selectorValueFromUrl(nestedFrame.getAttribute('src') || nestedFrame.src);
            if (frameValue) return `iframe[src*="${CSS.escape(frameValue)}"]`;

            const cluster = frameClusterSelectorFor(nestedFrame);
            if (cluster) return cluster;

            const structural = buildStructuralSelector(nestedFrame, false);
            if (structural) return structural;
        }

        const own = selectorForEl(el);
        if (own) return own;

        let node = el.parentElement;
        let depth = 0;
        while (node && node !== document.body && depth < 4) {
            const parentSelector = selectorForEl(node);
            if (parentSelector) return `${parentSelector} > ${el.tagName.toLowerCase()}`;
            node = node.parentElement;
            depth += 1;
        }
        return null;
    }

    function elementUnder(x, y) {
        const all = document.elementsFromPoint(x, y);
        for (const el of all) {
            if (pickerUi.has(el)) continue;
            const frame = frameAtPointInside(el, x, y);
            return frame || el;
        }
        return null;
    }

    function frameAtPointInside(el, x, y) {
        const frames = el.matches?.('iframe, frame')
            ? [el]
            : Array.from(el.querySelectorAll?.('iframe, frame') || []);

        for (const frame of frames) {
            const rect = frame.getBoundingClientRect();
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                return frame;
            }
        }
        return null;
    }

    function updateHighlight(el) {
        if (!el || !el.isConnected) {
            highlight.style.display = 'none';
            label.style.display = 'none';
            return;
        }

        const rect = el.getBoundingClientRect();
        Object.assign(highlight.style, {
            display: 'block',
            top: `${rect.top}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
        });

        const adUrl = getAdUrl(el);
        label.textContent = adUrl ? `${el.tagName.toLowerCase()} -> ${adUrl}` : el.tagName.toLowerCase();
        label.style.display = 'block';

        const labelTop = rect.top - 22;
        label.style.top = `${labelTop < 0 ? rect.bottom + 2 : labelTop}px`;
        label.style.left = `${Math.max(0, rect.left)}px`;
    }

    function flashHint(message) {
        hint.textContent = message;
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => {
            hint.textContent = defaultHint;
        }, 1200);
    }

    function refreshLocalStyle() {
        localStyle.textContent = Array.from(pickedSelectors)
            .filter((selector) => !selector.startsWith(FRAME_CLUSTER_PREFIX))
            .map((selector) => `${selector}{display:none!important;visibility:hidden!important;pointer-events:none!important}`)
            .join('\n');
    }

    function parseFrameClusterRule(selector) {
        if (typeof selector !== 'string' || !selector.startsWith(FRAME_CLUSTER_PREFIX)) return null;
        try {
            return JSON.parse(selector.slice(FRAME_CLUSTER_PREFIX.length));
        } catch (_) {
            return null;
        }
    }

    function hideNode(node) {
        if (!node || pickerUi.has(node)) return false;
        node.style?.setProperty?.('display', 'none', 'important');
        node.style?.setProperty?.('visibility', 'hidden', 'important');
        node.style?.setProperty?.('pointer-events', 'none', 'important');
        try { node.remove(); } catch (_) {}
        return true;
    }

    function enforceFrameCluster(selector) {
        const rule = parseFrameClusterRule(selector);
        if (!rule) return 0;

        let removed = 0;
        try {
            const anchor = document.querySelector(rule.anchor || 'body') || document.body;
            const frames = Array.from(anchor.querySelectorAll('iframe, frame'));
            const frame = frames[rule.index];
            if (frame && hideNode(frame)) removed += 1;
        } catch (_) {}

        return removed;
    }

    function removeMatches(selector) {
        if (!selector) return 0;
        if (selector.startsWith(FRAME_CLUSTER_PREFIX)) return enforceFrameCluster(selector);

        let removed = 0;
        try {
            for (const match of document.querySelectorAll(selector)) {
                if (pickerUi.has(match)) continue;
                if (hideNode(match)) removed += 1;
            }
        } catch (_) {}
        return removed;
    }

    function isBroadSelector(selector, pickedEl) {
        if (!selector || selector.startsWith(FRAME_CLUSTER_PREFIX)) return false;
        try {
            const matches = Array.from(document.querySelectorAll(selector)).filter((node) => !pickerUi.has(node));
            if (matches.length <= 1) return false;

            const pickedTag = pickedEl?.tagName?.toLowerCase?.() || '';
            if (['li', 'article', 'section', 'main', 'nav', 'ul', 'ol'].includes(pickedTag)) return true;
            if (/^(body|html|main|section|article|ul|ol|li)(?:$|[ >.:#\[])/i.test(selector)) return true;
            return matches.length > 3;
        } catch (_) {
            return true;
        }
    }

    function selectorForExactPick(pickedEl, fallbackSelector) {
        return buildStructuralSelector(pickedEl, false) || fallbackSelector;
    }

    function enforcePickedSelector(selector) {
        if (!selector) return 0;
        pickedSelectors.add(selector);
        refreshLocalStyle();
        if (selector.startsWith(FRAME_CLUSTER_PREFIX)) return enforceFrameCluster(selector);
        return 0;
    }

    function onMouseMove(event) {
        currentEl = elementUnder(event.clientX, event.clientY);
        updateHighlight(currentEl);
    }

    function onClick(event) {
        event.preventDefault();
        event.stopPropagation();

        const el = currentEl;
        if (!el || !el.isConnected) return;

        const url = getAdUrl(el);
        const urlHost = hostnameOf(url);
        const externalUrls = collectExternalUrls(el);
        const externalHosts = externalUrls.map(hostnameOf).filter(Boolean);
        let selector = getSelector(el);
        const isSameSite = !!urlHost && isSameSiteHost(urlHost);
        let shouldPersistSelector = true;
        let shouldPersistDomains = false;

        if (isSameSite) {
            shouldPersistSelector = true;
        } else if (externalHosts.length) {
            const preview = externalHosts.slice(0, 6).join('\n');
            const suffix = externalHosts.length > 6 ? `\n...and ${externalHosts.length - 6} more` : '';
            shouldPersistDomains = window.confirm(`Add ${externalHosts.length} domain(s) inside this selection to the global block list?\n\n${preview}${suffix}`);
        }

        if (isBroadSelector(selector, el)) {
            selector = selectorForExactPick(el, selector);
        }

        const removedCount = enforcePickedSelector(shouldPersistSelector ? selector : null);
        if (!removedCount) hideNode(el);
        currentEl = null;
        updateHighlight(null);

        if (isSameSite) {
            flashHint(selector ? 'Blocked on this site only. Keep clicking  |  ESC to finish' : 'Removed on this site only  |  ESC to finish');
        } else if (shouldPersistDomains) {
            flashHint(`Blocked ${externalHosts.length} domain(s) globally. Keep clicking  |  ESC to finish`);
        } else {
            flashHint(selector ? 'Blocked. Keep clicking to add more  |  ESC to finish' : 'Removed. Keep clicking  |  ESC to finish');
        }

        chrome.runtime.sendMessage({
            action: 'blockElement',
            url: shouldPersistDomains ? externalUrls : null,
            selector: shouldPersistSelector ? selector : null,
            site: window.location.hostname,
        });
    }

    function onKeyDown(event) {
        if (event.key === 'Escape') cleanup();
    }

    function cleanup() {
        window.__adzookaPickerActive = false;
        clearTimeout(hintTimer);
        selfRaise.disconnect();
        styleGuard.disconnect();
        shield.remove();
        highlight.remove();
        label.remove();
        hint.remove();
        document.removeEventListener('keydown', onKeyDown, true);
    }

    shield.addEventListener('mousemove', onMouseMove);
    shield.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown, true);
})();
