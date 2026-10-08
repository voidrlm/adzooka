// Video ad handling is independent of cosmetic element rules. YouTube has its own adapter.
(() => {
    if (/(^|\.)youtube\.com$/i.test(location.hostname)) return;
    const PLAYER = '.fluid_video_wrapper, .video-js, .jwplayer, [data-player], [data-video-player]';
    const AD_MODE = '.vjs-ad-playing, .jw-flag-ads, [data-ad-playing="true"]';
    const AD_UI = '.fluid_ad_playing, .ad_countdown, .skip_button, .jw-skip, .vjs-skip-ad';
    const SKIP = /^skip\s+(?:this\s+)?ads?(?:\s*(?:[>»›→]+|now))?\s*$/i;
    const AD_LABEL = /^(?:advertisement|advertising|ad(?:\s+\d+\s+of\s+\d+)?|commercial\s+break|skip\s+(?:ads?\s+)?in\s+\d+(?:\s*(?:s|seconds?))?[.!…]*|skip\s+ads?\s+in\s+\d+(?:\s*(?:s|seconds?))?[.!…]*)$/i;
    const videos = new Set();
    const roots = new Map();
    const suppressed = new Map();
    const clicked = new WeakMap();
    const skipPending = new WeakSet();
    const waitingForContent = new WeakSet();
    let enabled = false;
    let suspended = false;
    let timer = 0;
    let dueAt = 0;
    let revision = 0;
    let site = location.hostname;
    try { site = new URL(window.top.location.href).hostname; }
    catch (_) {
        try {
            const origins = location.ancestorOrigins;
            if (origins?.length) site = new URL(origins[origins.length - 1]).hostname;
        } catch (_) {}
    }

    function visible(element) {
        if (!element?.isConnected || !element.getClientRects().length) return false;
        return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }

    function parent(element) { return element.parentElement || element.getRootNode()?.host || null; }

    function scopeFor(video) {
        // Never climb to an article/body and mistake surrounding prose for player UI.
        const rect = video.getBoundingClientRect();
        let fallback = !video.parentElement && video.getRootNode() instanceof ShadowRoot ? video.getRootNode() : video;
        for (let node = parent(video), depth = 0; node && depth < 6; node = parent(node), depth++) {
            if (node === document.body || node === document.documentElement) break;
            if (node.matches(PLAYER)) return node;
            const box = node.getBoundingClientRect();
            if (box.width > rect.width * 1.3 + 40 || box.height > rect.height * 1.3 + 100) break;
            if (node.querySelectorAll('video').length > 1) break;
            fallback = node;
        }
        return fallback;
    }

    function overlaps(element, videoRect) {
        const box = element.getBoundingClientRect();
        return box.right >= videoRect.left && box.left <= videoRect.right &&
            box.bottom >= videoRect.top - 12 && box.top <= videoRect.bottom + 48;
    }

    function label(element) {
        const attribute = element.getAttribute('aria-label') || element.getAttribute('title');
        if (attribute && attribute.length < 100) return attribute.trim();
        // Read only small controls, never the text of a whole player/page subtree.
        if (element.childElementCount > 3) return '';
        const text = element.textContent;
        return text.length <= 100 ? text.replace(/\s+/g, ' ').trim() : '';
    }

    function signals(scope, video) {
        if (!scope?.querySelectorAll) return { ad: false, skip: null };
        let ad = scope.matches?.(AD_MODE) || false;
        let skip = null;
        const rect = video.getBoundingClientRect();
        const candidates = scope.querySelectorAll(`${AD_UI}, button, a, [role="button"], [aria-label], span, div, small`);
        for (const element of candidates) {
            if (element === video || element.contains(video)) continue;
            if (!visible(element) || !overlaps(element, rect)) continue;
            const text = label(element);
            const ready = SKIP.test(text);
            const marker = element.matches(AD_UI);
            if (marker || ready || (element.childElementCount === 0 && AD_LABEL.test(text))) ad = true;
            if (!ready || skip) continue;
            if (element.closest('[disabled], [aria-disabled="true"], .skip_button_disabled') ||
                /(?:^|[\s_-])disabled(?:$|[\s_-])/i.test(element.className)) continue;
            // Fluid Player attaches the handler to its nested link, not the wrapper.
            const control = element.querySelector('button, a, [role="button"]') || element;
            if (control.matches('[disabled], [aria-disabled="true"]')) continue;
            const anchor = control.closest('a[href]');
            if (anchor) {
                const href = anchor.getAttribute('href').trim();
                if (href && !href.startsWith('#') && !/^javascript:\s*(?:void\s*\(\s*0\s*\)|;)?\s*;?$/i.test(href)) continue;
            }
            if (getComputedStyle(control).pointerEvents !== 'none') skip = control;
        }
        return { ad, skip };
    }

    function restore(video) {
        const state = suppressed.get(video);
        if (!state) return;
        suppressed.delete(video);
        if (video.muted) video.muted = state.muted;
        if (video.style.getPropertyValue('filter') === 'brightness(0)' &&
            video.style.getPropertyPriority('filter') === 'important') {
            if (state.filter) video.style.setProperty('filter', state.filter, state.filterPriority);
            else video.style.removeProperty('filter');
        }
    }

    function suppress(video) {
        let state = suppressed.get(video);
        if (!state) {
            state = {
                muted: video.muted,
                filter: video.style.getPropertyValue('filter'),
                filterPriority: video.style.getPropertyPriority('filter'),
                source: video.currentSrc || video.src,
                sought: false,
            };
            suppressed.set(video, state);
            video.muted = true;
            // Black out only the ad video. Keep the player's skip controls operable.
            video.style.setProperty('filter', 'brightness(0)', 'important');
        }
        // Let the player handle its natural ended event. Never remove its source,
        // fabricate ended events, force autoplay, or seek a live/long content stream.
        if (!state.sought && !video.seeking && Number.isFinite(video.duration) &&
            video.duration > 0.3 && video.duration <= 180 && video.seekable.length) {
            const end = Math.min(video.duration, video.seekable.end(video.seekable.length - 1));
            if (end >= video.duration - 0.5 && video.currentTime < end - 0.2) {
                try { video.currentTime = Math.max(video.currentTime, end - 0.1); state.sought = true; } catch (_) {}
            }
        }
    }

    function mediaEvent(event) {
        const video = event.target;
        if (!(video instanceof HTMLVideoElement)) return;
        videos.add(video);
        if (['loadstart', 'emptied', 'ended'].includes(event.type)) {
            if (suppressed.has(video) || skipPending.has(video)) waitingForContent.add(video);
            skipPending.delete(video);
            restore(video);
        }
        schedule();
    }

    const mediaEvents = ['play', 'playing', 'pause', 'loadedmetadata', 'durationchange', 'loadstart', 'emptied', 'ended'];
    function watch(root) {
        if (roots.has(root)) return;
        const observer = new MutationObserver(records => {
            for (const record of records) {
                for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE && node.isConnected) discover(node);
                if (record.target.nodeType === Node.ELEMENT_NODE && record.target.shadowRoot) discover(record.target.shadowRoot);
            }
            if (records.some(record => record.removedNodes.length)) prune();
            if (videos.size) schedule();
        });
        observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'disabled', 'aria-disabled', 'aria-label', 'src', 'data-ad-playing'] });
        for (const type of mediaEvents) root.addEventListener(type, mediaEvent, true);
        roots.set(root, observer);
    }

    function discover(root) {
        if (root instanceof ShadowRoot) {
            if (roots.has(root)) return;
            watch(root);
        }
        function visit(node) {
            if (node instanceof HTMLVideoElement) videos.add(node);
            if (node.shadowRoot) discover(node.shadowRoot);
        }
        if (root.nodeType === Node.ELEMENT_NODE) visit(root);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) visit(node);
    }

    function unwatch(root, observer) {
        observer.disconnect();
        for (const type of mediaEvents) root.removeEventListener(type, mediaEvent, true);
        roots.delete(root);
    }

    function prune() {
        for (const [root, observer] of roots) if (root instanceof ShadowRoot && !root.host.isConnected) unwatch(root, observer);
        for (const video of videos) if (!video.isConnected) { restore(video); videos.delete(video); }
    }

    function scan() {
        timer = 0;
        if (!enabled || suspended) return;
        prune();
        let playing = false;
        for (const video of videos) {
            if (!video.isConnected) { restore(video); videos.delete(video); continue; }
            const state = suppressed.get(video);
            if (state && state.source !== (video.currentSrc || video.src)) {
                restore(video); waitingForContent.add(video);
            }
            const signal = visible(video) ? signals(scopeFor(video), video) : { ad: false, skip: null };
            if (!signal.ad) {
                restore(video);
                waitingForContent.delete(video);
                skipPending.delete(video);
            }
            if (video.paused || video.ended) { restore(video); continue; }
            playing = true;
            if (!signal.ad) continue;
            if (signal.skip && performance.now() - (clicked.get(signal.skip) ?? -Infinity) > 1000) {
                clicked.set(signal.skip, performance.now());
                skipPending.add(video);
                signal.skip.click();
                // The click may synchronously switch to the actual content.
                continue;
            }
            if (!waitingForContent.has(video)) suppress(video);
        }
        if (playing) schedule(document.hidden ? 1500 : 400);
    }

    function schedule(delay = 100) {
        if (!enabled || suspended) return;
        const next = performance.now() + delay;
        if (timer && dueAt <= next) return;
        clearTimeout(timer);
        dueAt = next;
        timer = setTimeout(scan, delay);
    }

    function stop() {
        clearTimeout(timer);
        timer = 0;
        for (const [root, observer] of roots) unwatch(root, observer);
        for (const video of suppressed.keys()) restore(video);
        videos.clear();
    }

    function start() {
        if (!enabled || suspended) return;
        watch(document);
        discover(document);
        schedule(0);
    }

    function configure(disabledSites) {
        const next = !disabledSites.includes(site) && !disabledSites.includes(location.hostname);
        if (enabled === next) return;
        enabled = next;
        if (enabled) start(); else stop();
    }
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.disabledSites) return;
        revision++;
        configure(changes.disabledSites.newValue || []);
    });
    async function initialize() {
        const before = revision;
        const { disabledSites = [] } = await chrome.storage.local.get('disabledSites');
        if (before === revision) configure(disabledSites);
    }
    initialize().catch(console.error);
    document.addEventListener('DOMContentLoaded', () => { if (enabled) { discover(document); schedule(0); } }, { once: true });
    document.addEventListener('visibilitychange', () => schedule(0));
    window.addEventListener('pagehide', () => { suspended = true; stop(); });
    window.addEventListener('pageshow', () => { suspended = false; start(); });
})();
