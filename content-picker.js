(function () {
    if (window.__adzookaPickerActive) return;
    window.__adzookaPickerActive = true;

    // Full-page transparent shield — owns all pointer events so page elements
    // can never receive a click while the picker is active.
    const shield = document.createElement('div');
    Object.assign(shield.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        cursor: 'crosshair',
        background: 'transparent',
    });
    document.documentElement.appendChild(shield);

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
    hint.textContent = 'Adzooka: Click an element to block it  •  ESC to cancel';
    document.documentElement.appendChild(hint);

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
        for (const s of candidates) {
            try { if (s && /^https?:\/\//.test(s)) return s; } catch (_) {}
        }
        return null;
    }

    // True only for strings that look like auto-generated hex hashes
    // e.g. "i70de066571bd", "a3229ff", "pmveboy37he1evqycf"
    // Does NOT flag real class names like "advertisement-banner" or "vjs-inplayer-container"
    function looksRandom(str) {
        // Pure hex pattern: optional 1-2 letter prefix then 7+ hex digits, nothing else
        if (/^[a-z]{0,2}[0-9a-f]{8,}$/i.test(str)) return true;
        // All lowercase alphanum, no hyphens/underscores, suspiciously long
        if (str.length > 18 && /^[a-z0-9]+$/.test(str)) return true;
        return false;
    }

    function hostnameOf(url) {
        try { return new URL(url).hostname; } catch (_) { return null; }
    }

    // Pick stable classes from an element's classList
    function stableClasses(el, max = 2) {
        return Array.from(el.classList)
            .filter(c => c.length > 1 && !looksRandom(c) && !/^(js-|is-|has-|active|open|hidden|show|hide|visible)$/.test(c))
            .slice(0, max)
            .map(c => `.${CSS.escape(c)}`)
            .join('');
    }

    // Build a stable CSS selector that survives page reload.
    // Walks up the DOM to find the best anchor if the element itself has nothing useful.
    function getSelector(el) {
        // Try the element itself first
        const sel = selectorForEl(el);
        if (sel) return sel;

        // Walk up to find a stable ancestor, then qualify with the original tag
        let node = el.parentElement;
        let depth = 0;
        while (node && node !== document.body && depth < 4) {
            const anc = selectorForEl(node);
            if (anc) return `${anc} > ${el.tagName.toLowerCase()}`;
            node = node.parentElement;
            depth++;
        }

        return null;
    }

    function selectorForEl(el) {
        const tag = el.tagName.toLowerCase();

        // Stable ID
        if (el.id && !looksRandom(el.id)) return `#${CSS.escape(el.id)}`;

        // src-based (iframes, img, script, video)
        const src = el.getAttribute('src');
        if (src) { const h = hostnameOf(src); if (h) return `${tag}[src*="${h}"]`; }

        // href-based
        const href = el.getAttribute('href');
        if (href) { const h = hostnameOf(href); if (h) return `${tag}[href*="${h}"]`; }

        // data-src
        const dataSrc = el.getAttribute('data-src') || el.getAttribute('data-lazy-src');
        if (dataSrc) { const h = hostnameOf(dataSrc); if (h) return `${tag}[data-src*="${h}"]`; }

        // Semantic data-* ad attributes
        for (const attr of ['data-ad-slot', 'data-ad-unit', 'data-adunit', 'data-widget-id', 'data-zone']) {
            const val = el.getAttribute(attr);
            if (val) return `${tag}[${attr}="${CSS.escape(val)}"]`;
        }

        // Class-based
        const classes = stableClasses(el);
        if (classes) return `${tag}${classes}`;

        return null;
    }

    function elementUnder(x, y) {
        shield.style.display = 'none';
        const el = document.elementFromPoint(x, y);
        shield.style.display = '';
        return el;
    }

    function updateHighlight(el) {
        if (!el) { highlight.style.display = 'none'; label.style.display = 'none'; return; }
        const r = el.getBoundingClientRect();
        Object.assign(highlight.style, {
            display: 'block',
            top: r.top + 'px',
            left: r.left + 'px',
            width: r.width + 'px',
            height: r.height + 'px',
        });
        const adUrl = getAdUrl(el);
        label.textContent = adUrl ? `${el.tagName.toLowerCase()} → ${adUrl}` : el.tagName.toLowerCase();
        label.style.display = 'block';
        const labelTop = r.top - 22;
        label.style.top = (labelTop < 0 ? r.bottom + 2 : labelTop) + 'px';
        label.style.left = Math.max(0, r.left) + 'px';
    }

    function onMouseMove(e) {
        currentEl = elementUnder(e.clientX, e.clientY);
        updateHighlight(currentEl);
    }

    function onClick(e) {
        e.preventDefault();
        e.stopPropagation();
        const el = currentEl;
        cleanup();
        if (!el) return;

        const url = getAdUrl(el);
        const selector = getSelector(el);
        el.remove();

        chrome.runtime.sendMessage({
            action: 'blockElement',
            url: url || null,
            selector,
            site: window.location.hostname,
        });
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') cleanup();
    }

    function cleanup() {
        window.__adzookaPickerActive = false;
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
