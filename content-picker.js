(function () {
    if (window.__adzookaPickerActive) return;
    window.__adzookaPickerActive = true;

    // Full-page transparent shield — owns all pointer events so page elements
    // can never receive a click while the picker is active.
    const shield = document.createElement('div');
    shield.style.cssText = 'position:fixed;inset:0;cursor:crosshair;background:transparent;';
    // Use setProperty with 'important' so page-script inline overrides can't win.
    shield.style.setProperty('z-index', '2147483647', 'important');
    shield.style.setProperty('pointer-events', 'auto', 'important');
    document.documentElement.appendChild(shield);

    // Ad scripts may append elements to <html> AFTER the shield, bumping them
    // above it in stacking order (same z-index, later DOM position = on top).
    // Re-append the shield whenever anything overtakes it.
    const selfRaise = new MutationObserver(() => {
        if (document.documentElement.lastElementChild !== shield)
            document.documentElement.appendChild(shield);
    });
    selfRaise.observe(document.documentElement, { childList: true });

    // Some pages (e.g. ouo.press) run scripts that scan for high-z-index fixed
    // elements and set pointer-events:none !important on them to kill pickers.
    // Detect any tamper with the shield's style and immediately restore it.
    const styleGuard = new MutationObserver(() => {
        const pe  = shield.style.getPropertyValue('pointer-events');
        const pri = shield.style.getPropertyPriority('pointer-events');
        const zi  = shield.style.getPropertyValue('z-index');
        if (pe !== 'auto'       || pri !== 'important') shield.style.setProperty('pointer-events', 'auto',       'important');
        if (zi !== '2147483647'                        ) shield.style.setProperty('z-index',        '2147483647', 'important');
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
    hint.textContent = 'Adzooka: Click an element to block it  •  ESC to cancel';
    document.documentElement.appendChild(hint);

    // Elements that belong to the picker UI — excluded from hit-testing.
    const pickerUi = new Set([shield, highlight, label, hint]);

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

    function looksRandom(str) {
        if (/^[a-z]{0,2}[0-9a-f]{8,}$/i.test(str)) return true;
        if (str.length > 18 && /^[a-z0-9]+$/.test(str)) return true;
        return false;
    }

    function hostnameOf(url) {
        try { return new URL(url).hostname; } catch (_) { return null; }
    }

    function stableClasses(el, max = 2) {
        return Array.from(el.classList)
            .filter(c => c.length > 1 && !looksRandom(c) && !/^(js-|is-|has-|active|open|hidden|show|hide|visible)$/.test(c))
            .slice(0, max)
            .map(c => `.${CSS.escape(c)}`)
            .join('');
    }

    function getSelector(el) {
        const sel = selectorForEl(el);
        if (sel) return sel;

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

        if (el.id && !looksRandom(el.id)) return `#${CSS.escape(el.id)}`;

        const src = el.getAttribute('src');
        if (src) { const h = hostnameOf(src); if (h) return `${tag}[src*="${h}"]`; }

        const href = el.getAttribute('href');
        if (href) { const h = hostnameOf(href); if (h) return `${tag}[href*="${h}"]`; }

        const dataSrc = el.getAttribute('data-src') || el.getAttribute('data-lazy-src');
        if (dataSrc) { const h = hostnameOf(dataSrc); if (h) return `${tag}[data-src*="${h}"]`; }

        for (const attr of ['data-ad-slot', 'data-ad-unit', 'data-adunit', 'data-widget-id', 'data-zone']) {
            const val = el.getAttribute(attr);
            if (val) return `${tag}[${attr}="${CSS.escape(val)}"]`;
        }

        const classes = stableClasses(el);
        if (classes) return `${tag}${classes}`;

        return null;
    }

    // Use elementsFromPoint so we never need to hide the shield.
    // elementsFromPoint returns ALL elements geometrically at the point,
    // regardless of pointer-events — we just skip our own UI elements.
    function elementUnder(x, y) {
        const all = document.elementsFromPoint(x, y);
        for (const el of all) {
            if (!pickerUi.has(el)) return el;
        }
        return null;
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
        selfRaise.disconnect();
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
