(function () {
    'use strict';

    const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'SUMMARY', 'DETAILS', 'LABEL']);

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

    // ── Wrap document/window click handlers ───────────────────────────────────
    // Ad scripts attach window.open() to document- or window-level listeners that
    // fire on ANY click. We intercept addEventListener to flag those calls:
    // if window.open fires while we're inside such a handler AND the clicked
    // element is non-interactive (plain text, image, div, etc.), it's an ad popup.

    let insideDocumentHandler = false;

    const _addEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (
            (type === 'click' || type === 'mousedown' || type === 'mouseup') &&
            (this === document || this === window)
        ) {
            const wrapped = function () {
                const e = arguments[0];
                const suspicious = e instanceof Event && !isInteractive(e.target);
                const prev = insideDocumentHandler;
                insideDocumentHandler = suspicious;
                try { return listener.apply(this, arguments); }
                finally { insideDocumentHandler = prev; }
            };
            return _addEventListener.call(this, type, wrapped, options);
        }
        return _addEventListener.call(this, type, listener, options);
    };

    // ── Gesture tracking ──────────────────────────────────────────────────────
    let gestureActive = false;
    let popupsThisGesture = 0;

    // Use the original addEventListener to bypass our wrapper for internal listeners
    _addEventListener.call(document, 'mousedown', () => {
        gestureActive = true;
        popupsThisGesture = 0;
        setTimeout(() => { gestureActive = false; }, 1500);
    }, true);

    _addEventListener.call(document, 'touchstart', () => {
        gestureActive = true;
        popupsThisGesture = 0;
        setTimeout(() => { gestureActive = false; }, 1500);
    }, { capture: true, passive: true });

    // ── window.open override ──────────────────────────────────────────────────
    const _open = window.open;
    window.open = function (url, name, features) {
        popupsThisGesture++;
        if (!gestureActive)        return null;  // no user gesture (background popup)
        if (insideDocumentHandler) return null;  // doc-level handler fired on non-interactive element
        if (popupsThisGesture > 1) return null;  // >1 popup per gesture
        return _open.call(this, url, name, features);
    };

    // ── Transparent overlay neutraliser ──────────────────────────────────────
    // Detects large, transparent fixed/absolute elements injected to sit on top
    // of real content and capture clicks (redirecting to ads on click).
    function neutraliseOverlay(el) {
        if (!(el instanceof HTMLElement)) return;
        const s = window.getComputedStyle(el);
        if (!['fixed', 'absolute'].includes(s.position)) return;
        if ((parseInt(s.zIndex) || 0) < 500) return;
        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        if (!vw || !vh || rect.width < vw * 0.5 || rect.height < vh * 0.5) return;
        const bg = s.backgroundColor;
        const transparent    = bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)';
        const nearlyInvisible = parseFloat(s.opacity) < 0.05;
        if (!transparent && !nearlyInvisible) return;
        el.style.setProperty('pointer-events', 'none', 'important');
    }

    // Scan elements already in the DOM (rare at document_start, but safe to do)
    function scanExisting() {
        document.querySelectorAll('*').forEach(neutraliseOverlay);
    }

    const mo = new MutationObserver(muts => {
        for (const m of muts)
            for (const n of m.addedNodes)
                neutraliseOverlay(n);
    });

    if (document.documentElement) {
        mo.observe(document.documentElement, { childList: true, subtree: true });
        _addEventListener.call(document, 'DOMContentLoaded', scanExisting);
    } else {
        _addEventListener.call(document, 'DOMContentLoaded', () => {
            mo.observe(document.documentElement, { childList: true, subtree: true });
            scanExisting();
        });
    }
})();
