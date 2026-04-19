(function () {
    'use strict';

    const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'SUMMARY', 'DETAILS', 'LABEL', 'TEXTAREA']);
    const POINTER_EVENTS = ['mousedown', 'touchstart', 'pointerdown'];
    const CLICK_EVENTS = ['click', 'mouseup', 'touchend', 'pointerup'];
    const SELF_TARGETS = new Set(['', '_self', '_top', '_parent']);
    const GESTURE_WINDOW_MS = 1500;

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

    function stripHash(url) {
        if (!url) return null;
        try {
            const parsed = new URL(url, document.baseURI);
            parsed.hash = '';
            return parsed.href;
        } catch (_) {
            return url;
        }
    }

    function isSameDocumentChange(url) {
        const target = normalizeUrl(url);
        if (!target) return false;
        return stripHash(target) === stripHash(location.href);
    }

    function closestFormSubmitter(target) {
        return target?.closest?.('button[formaction], input[type="submit"][formaction], input[type="image"][formaction]') || null;
    }

    function closestForm(target) {
        return target?.closest?.('form') || null;
    }

    function collectIntent(target, event) {
        const link = target?.closest?.('a[href], area[href]') || null;
        const submitter = closestFormSubmitter(target);
        const form = submitter?.form || closestForm(target);
        const interactive = isInteractive(target);
        const ctrlLike = !!(event && (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1));
        const intent = {
            interactive,
            kind: interactive ? 'interactive' : 'non-interactive',
            urls: new Set(),
            allowsPopup: interactive,
            allowsSelfNavigation: interactive,
        };

        if (link) {
            const href = normalizeUrl(link.getAttribute('href'), link.baseURI);
            if (href) intent.urls.add(href);

            const targetAttr = (link.getAttribute('target') || '').toLowerCase();
            const newTab = ctrlLike || (targetAttr && !SELF_TARGETS.has(targetAttr));

            intent.kind = 'link';
            intent.allowsPopup = newTab;
            intent.allowsSelfNavigation = !newTab;
            return intent;
        }

        if (submitter || form) {
            const actionSource = submitter || form;
            const actionAttr = actionSource?.getAttribute?.('formaction') || form?.getAttribute?.('action') || form?.action;
            const action = normalizeUrl(actionAttr || location.href, document.baseURI);
            if (action) intent.urls.add(action);

            const targetAttr = (actionSource?.getAttribute?.('formtarget') || form?.getAttribute?.('target') || '').toLowerCase();
            const newTab = ctrlLike || (targetAttr && !SELF_TARGETS.has(targetAttr));

            intent.kind = 'form';
            intent.allowsPopup = newTab;
            intent.allowsSelfNavigation = !newTab;
            return intent;
        }

        if (interactive) {
            intent.kind = 'interactive';
        }

        return intent;
    }

    const state = {
        gestureActive: false,
        gestureToken: 0,
        navCount: 0,
        lastAllowedUrl: null,
        expiresAt: 0,
        intent: collectIntent(null, null),
        globalHandlerDepth: 0,
        suspiciousHandlerDepth: 0,
        resetTimer: null,
    };

    function resetGesture() {
        state.gestureActive = false;
        state.navCount = 0;
        state.lastAllowedUrl = null;
        state.expiresAt = 0;
        state.intent = collectIntent(null, null);
        if (state.resetTimer) {
            clearTimeout(state.resetTimer);
            state.resetTimer = null;
        }
    }

    function beginGesture(event) {
        state.gestureActive = true;
        state.gestureToken += 1;
        state.navCount = 0;
        state.lastAllowedUrl = null;
        state.expiresAt = Date.now() + GESTURE_WINDOW_MS;
        state.intent = collectIntent(event.target, event);

        if (state.resetTimer) clearTimeout(state.resetTimer);
        state.resetTimer = setTimeout(() => {
            if (Date.now() >= state.expiresAt) resetGesture();
        }, GESTURE_WINDOW_MS);
    }

    function ensureActiveGesture() {
        if (state.gestureActive && Date.now() <= state.expiresAt) return true;
        resetGesture();
        return false;
    }

    function matchesIntent(url) {
        if (!url || state.intent.urls.size === 0) return false;
        const bare = stripHash(url);
        for (const expected of state.intent.urls) {
            if (url === expected || bare === stripHash(expected)) return true;
        }
        return false;
    }

    function markAllowed(url) {
        const normalized = normalizeUrl(url);
        if (!normalized || isSameDocumentChange(normalized)) return true;
        const bare = stripHash(normalized);
        if (state.lastAllowedUrl && bare === stripHash(state.lastAllowedUrl)) return true;
        state.navCount += 1;
        state.lastAllowedUrl = normalized;
        return true;
    }

    function shouldAllowNavigation(rawUrl, { kind, target = '' } = {}) {
        const url = normalizeUrl(rawUrl);

        if (!url) {
            if (kind === 'popup' && !ensureActiveGesture()) return false;
            if (kind === 'popup' && state.navCount > 0) return false;
            if (kind === 'popup' && (!state.intent.interactive || state.intent.kind === 'link' || state.intent.kind === 'form')) {
                return false;
            }
            return true;
        }

        const selfNavigation =
            kind === 'location' ||
            kind === 'form' ||
            SELF_TARGETS.has((target || '').toLowerCase());

        if (isSameDocumentChange(url)) return true;
        if (!ensureActiveGesture()) return false;

        const matches = matchesIntent(url);
        const suspiciousContext = state.suspiciousHandlerDepth > 0;
        const intentKind = state.intent.kind;

        if (suspiciousContext && !matches) return false;

        if (matches) {
            if (selfNavigation && !state.intent.allowsSelfNavigation) return false;
            if (!selfNavigation && !state.intent.allowsPopup) return false;
            if (state.navCount > 0 && stripHash(url) !== stripHash(state.lastAllowedUrl)) return false;
            return markAllowed(url);
        }

        if (state.navCount > 0) return false;

        if (selfNavigation) {
            if (!state.intent.interactive) return false;
            if (intentKind === 'link' || intentKind === 'form') return false;
            return markAllowed(url);
        }

        if (!state.intent.interactive) return false;
        if (intentKind === 'link' || intentKind === 'form') return false;
        if (suspiciousContext) return false;
        return markAllowed(url);
    }

    // Wrap high-level click handlers. Ad scripts tend to attach to document/window
    // and then trigger navigation unrelated to the clicked element's true intent.
    const _addEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        const isGlobalTarget =
            this === document ||
            this === window ||
            this === document.documentElement ||
            this === document.body;

        if (
            isGlobalTarget &&
            (type === 'click' || type === 'mousedown' || type === 'mouseup' || type === 'touchstart' || type === 'touchend')
        ) {
            const wrapped = function () {
                const event = arguments[0];
                const suspicious = event instanceof Event && !isInteractive(event.target);

                state.globalHandlerDepth += 1;
                if (suspicious) state.suspiciousHandlerDepth += 1;

                try {
                    return listener.apply(this, arguments);
                } finally {
                    state.globalHandlerDepth -= 1;
                    if (suspicious) state.suspiciousHandlerDepth -= 1;
                }
            };

            return _addEventListener.call(this, type, wrapped, options);
        }

        return _addEventListener.call(this, type, listener, options);
    };

    for (const type of POINTER_EVENTS) {
        _addEventListener.call(document, type, beginGesture, { capture: true, passive: true });
    }

    for (const type of CLICK_EVENTS) {
        _addEventListener.call(document, type, beginGesture, true);
    }

    const _open = window.open;
    window.open = function (url, name, features) {
        const target = typeof name === 'string' ? name : '';
        if (!shouldAllowNavigation(url, { kind: 'popup', target })) return null;
        return _open.call(this, url, name, features);
    };

    function patchMethod(obj, method, kind, targetResolver, receiver = obj) {
        const original = obj?.[method];
        if (typeof original !== 'function') return;

        const wrapped = function (...args) {
            if (!shouldAllowNavigation(args[0], { kind, target: targetResolver?.call(this, ...args) || '' })) {
                return undefined;
            }
            return original.apply(receiver, args);
        };

        try {
            obj[method] = wrapped;
            if (obj[method] === wrapped) return;
        } catch (_) {
            // Some browser-owned objects (notably Location in Chromium) reject
            // direct method replacement on the instance. Fall through to a
            // prototype-level patch if possible.
        }

        try {
            const proto = Object.getPrototypeOf(obj);
            if (!proto) return;

            const descriptor = Object.getOwnPropertyDescriptor(proto, method);
            if (descriptor && descriptor.configurable === false && descriptor.writable === false) return;

            Object.defineProperty(proto, method, {
                configurable: descriptor?.configurable ?? true,
                enumerable: descriptor?.enumerable ?? false,
                writable: descriptor?.writable ?? true,
                value: wrapped,
            });
        } catch (_) {
            // Best-effort only: if the browser rejects both strategies, skip
            // this hook rather than breaking the rest of the blocker.
        }
    }

    patchMethod(window.location, 'assign', 'location', null, window.location);
    patchMethod(window.location, 'replace', 'location', null, window.location);

    const anchorClick = HTMLAnchorElement.prototype.click;
    if (typeof anchorClick === 'function') {
        HTMLAnchorElement.prototype.click = function () {
            const href = this.getAttribute('href') || this.href;
            const target = (this.getAttribute('target') || '').toLowerCase();
            const kind = SELF_TARGETS.has(target) ? 'location' : 'popup';
            if (!shouldAllowNavigation(href, { kind, target })) return;
            return anchorClick.call(this);
        };
    }

    const formSubmit = HTMLFormElement.prototype.submit;
    if (typeof formSubmit === 'function') {
        HTMLFormElement.prototype.submit = function () {
            const action = this.getAttribute('action') || this.action || location.href;
            const target = (this.getAttribute('target') || '').toLowerCase();
            const kind = SELF_TARGETS.has(target) ? 'form' : 'popup';
            if (!shouldAllowNavigation(action, { kind, target })) return;
            return formSubmit.call(this);
        };
    }

    function patchSetter(proto, property, kind) {
        try {
            const descriptor = Object.getOwnPropertyDescriptor(proto, property);
            if (!descriptor || typeof descriptor.set !== 'function' || typeof descriptor.get !== 'function') return;

            Object.defineProperty(proto, property, {
                configurable: descriptor.configurable,
                enumerable: descriptor.enumerable,
                get: descriptor.get,
                set(value) {
                    if (!shouldAllowNavigation(value, { kind })) return;
                    return descriptor.set.call(this, value);
                },
            });
        } catch (_) {
            // Some browser-owned accessors are not patchable. Best-effort only.
        }
    }

    const locationProto = Object.getPrototypeOf(window.location);
    if (locationProto) patchSetter(locationProto, 'href', 'location');
    if (window.Document?.prototype) patchSetter(Document.prototype, 'location', 'location');

    // Detect large transparent overlays that hijack clicks.
    function neutraliseOverlay(el) {
        if (!(el instanceof HTMLElement)) return;

        const s = window.getComputedStyle(el);
        if (!['fixed', 'absolute'].includes(s.position)) return;
        if ((parseInt(s.zIndex, 10) || 0) < 500) return;

        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (!vw || !vh || rect.width < vw * 0.5 || rect.height < vh * 0.5) return;

        const bg = s.backgroundColor;
        const transparent = bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)';
        const nearlyInvisible = parseFloat(s.opacity) < 0.05;
        if (!transparent && !nearlyInvisible) return;

        el.style.setProperty('pointer-events', 'none', 'important');
    }

    function scanExisting() {
        document.querySelectorAll('*').forEach(neutraliseOverlay);
    }

    const mo = new MutationObserver((muts) => {
        for (const m of muts) {
            for (const n of m.addedNodes) {
                neutraliseOverlay(n);
            }
        }
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
