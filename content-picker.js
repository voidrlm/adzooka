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
        zIndex: '2147483645',
        border: '2px solid #e94560',
        background: 'rgba(233,69,96,0.12)',
        borderRadius: '3px',
        display: 'none',
        boxSizing: 'border-box',
    });
    document.documentElement.appendChild(highlight);

    const label = document.createElement('div');
    Object.assign(label.style, {
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: '2147483646',
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
    let hintTimer = null;
    let currentEl = null;

    function getAdUrl(el) {
        const candidates = [
            el.src,
            el.href,
            el.getAttribute('data-src'),
            el.getAttribute('data-lazy-src'),
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
        if (str.length > 18 && /^[a-z0-9]+$/.test(str)) return true;
        return false;
    }

    function hostnameOf(url) {
        try {
            return new URL(url).hostname;
        } catch (_) {
            return null;
        }
    }

    function isSameSiteHost(hostname) {
        return typeof hostname === 'string' &&
            hostname.toLowerCase() === window.location.hostname.toLowerCase();
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

    function selectorForEl(el) {
        const tag = el.tagName.toLowerCase();

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
            if (!pickerUi.has(el)) return el;
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
        const selector = getSelector(el);
        const isSameSite = !!urlHost && isSameSiteHost(urlHost);
        let shouldPersistSelector = true;
        let shouldPersistDomain = false;

        if (isSameSite) {
            shouldPersistSelector = true;
        } else if (urlHost) {
            shouldPersistDomain = window.confirm(`Add ${urlHost} to the global domain block list?`);
        }

        el.remove();
        currentEl = null;
        updateHighlight(null);

        if (isSameSite) {
            flashHint(selector ? 'Blocked on this site only. Keep clicking  |  ESC to finish' : 'Removed on this site only  |  ESC to finish');
        } else if (shouldPersistDomain) {
            flashHint(`Blocked ${urlHost} globally. Keep clicking  |  ESC to finish`);
        } else {
            flashHint(selector ? 'Blocked. Keep clicking to add more  |  ESC to finish' : 'Removed. Keep clicking  |  ESC to finish');
        }

        chrome.runtime.sendMessage({
            action: 'blockElement',
            url: shouldPersistDomain ? (url || null) : null,
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
