(function () {
    'use strict';

    const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'SUMMARY']);

    function isInteractive(el) {
        while (el && el !== document) {
            if (INTERACTIVE.has(el.tagName)) return true;
            const role = el.getAttribute?.('role');
            if (role === 'button' || role === 'link' || role === 'menuitem') return true;
            if (el.hasAttribute?.('onclick')) return true;
            if (el.getAttribute?.('tabindex') === '0') return true;
            el = el.parentElement;
        }
        return false;
    }

    let gestureActive = false;
    let gestureTrustedClick = false;
    let popupsThisGesture = 0;

    function onGestureStart(target) {
        gestureActive = true;
        gestureTrustedClick = isInteractive(target);
        popupsThisGesture = 0;
        setTimeout(() => { gestureActive = false; }, 1500);
    }

    document.addEventListener('mousedown', e => onGestureStart(e.target), true);
    document.addEventListener('touchstart', e => onGestureStart(e.touches[0]?.target), { capture: true, passive: true });

    // ── window.open override ──────────────────────────────────────────────────
    // Block popups fired without a real user gesture, on non-interactive targets,
    // or when more than one popup tries to open per gesture.
    const _open = window.open;
    window.open = function (url, name, features) {
        popupsThisGesture++;
        if (!gestureActive)        return null;  // background popup (no gesture)
        if (!gestureTrustedClick)  return null;  // clicked a plain div/p/span — suspicious
        if (popupsThisGesture > 1) return null;  // second popup in same gesture — ad
        return _open.call(this, url, name, features);
    };

    // ── Transparent overlay neutraliser ──────────────────────────────────────
    // Some sites inject a transparent fixed/absolute element covering the viewport.
    // Clicking it fires a redirect or popup instead of the content underneath.
    function neutraliseOverlay(el) {
        if (!(el instanceof HTMLElement)) return;
        const s = window.getComputedStyle(el);
        if (!['fixed', 'absolute'].includes(s.position)) return;
        if ((parseInt(s.zIndex) || 0) < 500) return;
        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        if (!vw || !vh) return;
        if (rect.width < vw * 0.5 || rect.height < vh * 0.5) return;
        const bg = s.backgroundColor;
        const transparent = bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)';
        const nearlyInvisible = parseFloat(s.opacity) < 0.05;
        if (!transparent && !nearlyInvisible) return;
        el.style.setProperty('pointer-events', 'none', 'important');
    }

    const mo = new MutationObserver(muts => {
        for (const m of muts)
            for (const n of m.addedNodes)
                neutraliseOverlay(n);
    });

    if (document.documentElement) {
        mo.observe(document.documentElement, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () =>
            mo.observe(document.documentElement, { childList: true, subtree: true }));
    }
})();
