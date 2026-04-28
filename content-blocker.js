(function () {
    if (location.hostname.includes('youtube.com')) return;

    const STYLE_ID = '__adzooka-cosmetic-user';
    const site = window.location.hostname;
    const VIDEO_AD_TEXT_RE = /\b(skip(?:\s+(?:ad|ads|in))?|advertisement|commercial\s+break|your\s+video\s+will\s+resume|ad\s+\d{1,2}\b)\b/i;
    const SKIP_NOW_RE = /\bskip(?:\s+ad|\s+ads)?\b/i;
    const MUTE_RE = /\b(mute|unmute|volume)\b/i;
    const hiddenRoots = new WeakSet();
    const reportedHosts = new Set();
    const playerState = new WeakMap();
    let sweepTimer = null;

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
        el.textContent = selectors.map((selector) => `${selector}{display:none!important}`).join('\n');
    }

    chrome.storage.local.get('blockedSelectors', ({ blockedSelectors = {} }) => {
        applySelectors(blockedSelectors[site] || []);
    });

    chrome.storage.onChanged.addListener((changes) => {
        if (changes.blockedSelectors) {
            applySelectors((changes.blockedSelectors.newValue || {})[site] || []);
        }
    });

    function isElementVisible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            parseFloat(style.opacity || '1') > 0.01 &&
            rect.width > 10 &&
            rect.height > 10;
    }

    function isLargeMediaRect(rect) {
        return rect.width >= 220 && rect.height >= 120;
    }

    function elementText(el) {
        if (!(el instanceof HTMLElement)) return '';
        return [
            el.innerText,
            el.textContent,
            el.getAttribute('aria-label'),
            el.getAttribute('title'),
            el.getAttribute('data-testid'),
        ].filter(Boolean).join(' ').trim();
    }

    function looksLikeSkipButton(el) {
        if (!(el instanceof HTMLElement)) return false;
        if (!isElementVisible(el)) return false;
        const text = elementText(el);
        if (!SKIP_NOW_RE.test(text)) return false;
        const tag = el.tagName;
        return tag === 'BUTTON' || tag === 'A' || el.getAttribute('role') === 'button' || el.tabIndex >= 0;
    }

    function clickSkipButtons(root = document) {
        const candidates = root.querySelectorAll('button, a, div, span, [role="button"], [aria-label], [title]');
        for (const node of candidates) {
            if (!looksLikeSkipButton(node)) continue;
            try {
                node.click();
                return true;
            } catch (_) {}
        }
        return false;
    }

    function ensureBlackout(player) {
        let state = playerState.get(player);
        if (!state) {
            state = {
                blackout: null,
                originalPosition: '',
                originalMuted: null,
                active: false,
            };
            playerState.set(player, state);
        }

        if (!(state.blackout instanceof HTMLElement)) {
            const style = getComputedStyle(player);
            state.originalPosition = player.style.position || '';
            if (style.position === 'static') {
                player.style.setProperty('position', 'relative', 'important');
            }

            const blackout = document.createElement('div');
            blackout.textContent = 'Blocking video ad...';
            blackout.style.cssText = [
                'position:absolute',
                'inset:0',
                'display:flex',
                'align-items:center',
                'justify-content:center',
                'background:#000',
                'color:#fff',
                'font:600 14px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
                'letter-spacing:.2px',
                'z-index:2147483640',
                'pointer-events:none',
                'opacity:0',
                'transition:opacity .12s ease',
            ].join(';');
            player.appendChild(blackout);
            state.blackout = blackout;
        }

        state.blackout.style.opacity = '1';
        state.active = true;
        return state;
    }

    function clearBlackout(player) {
        const state = playerState.get(player);
        if (!state) return;

        state.active = false;
        if (state.blackout?.isConnected) {
            state.blackout.style.opacity = '0';
        }
        if (state.originalMuted !== null) {
            const media = player.matches('video, audio') ? player : player.querySelector('video, audio');
            if (media) {
                try { media.muted = state.originalMuted; } catch (_) {}
            }
            state.originalMuted = null;
        }
    }

    function pauseMediaInside(root) {
        for (const media of root.querySelectorAll('video, audio')) {
            try {
                media.pause();
            } catch (_) {}
        }
    }

    function killAdMediaInside(root) {
        const mediaNodes = root.querySelectorAll('video, audio');
        for (const media of mediaNodes) {
            try { media.pause(); } catch (_) {}
            try { media.removeAttribute('src'); } catch (_) {}
            for (const source of media.querySelectorAll('source')) {
                try { source.removeAttribute('src'); } catch (_) {}
            }
            try { media.load(); } catch (_) {}
        }

        const iframes = root.querySelectorAll('iframe');
        for (const frame of iframes) {
            try { frame.src = 'about:blank'; } catch (_) {}
            try { frame.removeAttribute('srcdoc'); } catch (_) {}
        }
    }

    function hostFromUrl(url) {
        if (typeof url !== 'string' || !url.trim()) return null;
        try {
            return new URL(url, location.href).hostname.toLowerCase();
        } catch (_) {
            return null;
        }
    }

    function collectSourceHosts(root) {
        const hosts = new Set();
        const siteHost = location.hostname.toLowerCase();
        const urlAttrs = ['src', 'data-src', 'data-lazy-src', 'poster'];

        const candidates = [
            root,
            ...root.querySelectorAll('video, audio, source, iframe, img, script, [src], [data-src], [data-lazy-src], [poster]'),
        ];

        for (const node of candidates) {
            if (!(node instanceof Element)) continue;

            for (const attr of urlAttrs) {
                const host = hostFromUrl(node.getAttribute(attr));
                if (!host || host === siteHost) continue;
                hosts.add(host);
            }

            const currentSrc = hostFromUrl(node.currentSrc);
            if (currentSrc && currentSrc !== siteHost) hosts.add(currentSrc);
        }

        return [...hosts];
    }

    function findPlayableMedia(start) {
        if (start instanceof HTMLVideoElement || start instanceof HTMLAudioElement) return start;
        if (start instanceof HTMLElement) {
            const direct = start.querySelector('video, audio');
            if (direct) return direct;
        }
        return null;
    }

    function findPlayerRoot(start) {
        let node = start instanceof HTMLElement ? start : null;
        while (node && node !== document.body && node !== document.documentElement) {
            const rect = node.getBoundingClientRect();
            if ((findPlayableMedia(node) || node.querySelector('iframe')) && isLargeMediaRect(rect)) {
                return node;
            }
            node = node.parentElement;
        }
        return null;
    }

    function forceFinishMediaAd(media) {
        if (!(media instanceof HTMLMediaElement)) return;

        try {
            const player = findPlayerRoot(media) || media.parentElement;
            const state = player ? ensureBlackout(player) : null;
            if (state && state.originalMuted === null) {
                state.originalMuted = media.muted;
            }

            media.muted = true;
            media.volume = 0;
        } catch (_) {}

        try {
            if (Number.isFinite(media.duration) && media.duration > 1) {
                media.currentTime = Math.max(media.duration - 0.05, media.currentTime + 30);
            }
        } catch (_) {}

        try {
            media.playbackRate = Math.max(media.playbackRate || 1, 16);
        } catch (_) {}

        try {
            media.play().catch?.(() => {});
        } catch (_) {}
    }

    function neutralizePlayerAd(root) {
        const player = findPlayerRoot(root);
        if (!player) return false;

        reportSourceHosts(player);

        const media = findPlayableMedia(player);
        if (media) {
            if (root instanceof HTMLElement && root !== player) {
                root.style.setProperty('display', 'none', 'important');
                root.style.setProperty('visibility', 'hidden', 'important');
                root.style.setProperty('pointer-events', 'none', 'important');
            }
            forceFinishMediaAd(media);
            return true;
        }

        const frame = player.querySelector('iframe');
        if (frame) {
            killAdMediaInside(player);
            ensureBlackout(player);
            try { frame.src = 'about:blank'; } catch (_) {}
            return true;
        }

        return false;
    }

    function reportSourceHosts(root) {
        const freshHosts = collectSourceHosts(root).filter((host) => !reportedHosts.has(host));
        if (!freshHosts.length) return;

        freshHosts.forEach((host) => reportedHosts.add(host));
        chrome.runtime.sendMessage({
            action: 'blockSourceHosts',
            hosts: freshHosts,
        }).catch?.(() => {});
    }

    function hideRoot(root) {
        if (!(root instanceof HTMLElement) || hiddenRoots.has(root)) return;
        hiddenRoots.add(root);
        reportSourceHosts(root);
        killAdMediaInside(root);
        pauseMediaInside(root);
        root.style.setProperty('display', 'none', 'important');
        root.style.setProperty('visibility', 'hidden', 'important');
        root.style.setProperty('pointer-events', 'none', 'important');
    }

    function isLargeOverlay(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const z = parseInt(style.zIndex, 10) || 0;
        const vw = window.innerWidth || 0;
        const vh = window.innerHeight || 0;
        const coversEnough = rect.width >= vw * 0.35 && rect.height >= vh * 0.2;
        return ['fixed', 'absolute', 'sticky'].includes(style.position) && z >= 10 && coversEnough;
    }

    function hasMediaSignals(el) {
        if (!(el instanceof HTMLElement)) return false;
        if (el.matches('video, iframe')) return true;
        if (el.querySelector('video, iframe')) return true;
        const text = elementText(el);
        if (MUTE_RE.test(text) && isLargeOverlay(el)) return true;
        return false;
    }

    function findVideoAdRoot(start) {
        let node = start instanceof HTMLElement ? start : null;
        let fallback = null;

        while (node && node !== document.body && node !== document.documentElement) {
            const text = elementText(node);
            if (VIDEO_AD_TEXT_RE.test(text) && isLargeOverlay(node)) {
                fallback = node;
                if (hasMediaSignals(node)) return node;
            }
            if (isLargeOverlay(node) && hasMediaSignals(node) && fallback) {
                return node;
            }
            node = node.parentElement;
        }

        return fallback;
    }

    function releaseFinishedPlayers() {
        for (const video of document.querySelectorAll('video, audio')) {
            const player = findPlayerRoot(video);
            if (!player) continue;
            const state = playerState.get(player);
            if (!state?.active) continue;

            const inAdMode = isAdUiNear(player) || isAdUiNear(video.parentElement);
            if (!inAdMode) {
                clearBlackout(player);
                try { video.playbackRate = 1; } catch (_) {}
            }
        }
    }

    function isAdUiNear(root) {
        if (!(root instanceof HTMLElement)) return false;
        if (VIDEO_AD_TEXT_RE.test(elementText(root))) return true;
        const nodes = root.querySelectorAll('button, a, div, span, section, aside, [role="dialog"], [aria-label], [title]');
        for (const node of nodes) {
            if (isElementVisible(node) && VIDEO_AD_TEXT_RE.test(elementText(node))) return true;
        }
        return false;
    }

    function hasVisibleGlobalAdMarker() {
        const nodes = document.querySelectorAll('button, a, div, span, section, aside, [role="dialog"], [aria-label], [title]');
        let seen = 0;
        for (const node of nodes) {
            if (!(node instanceof HTMLElement) || !isElementVisible(node)) continue;
            if (VIDEO_AD_TEXT_RE.test(elementText(node))) return true;
            seen += 1;
            if (seen > 300) break;
        }
        return false;
    }

    function mediaHostScore(media) {
        const host = hostFromUrl(media.currentSrc || media.src || media.getAttribute('src'));
        if (!host) return 0;
        if (host !== location.hostname.toLowerCase()) return 2;
        return 0;
    }

    function shortClipScore(media) {
        if (!Number.isFinite(media.duration) || media.duration <= 0) return 0;
        if (media.duration <= 120) return 1;
        return 0;
    }

    function autoplayingScore(media) {
        if (media.paused) return 0;
        if (media.autoplay) return 1;
        if (media.currentTime < 2) return 1;
        return 0;
    }

    function adScoreForMedia(media) {
        if (!(media instanceof HTMLMediaElement)) return 0;
        const player = findPlayerRoot(media);
        if (!player) return 0;
        if (!isElementVisible(player)) return 0;
        if (!isLargeMediaRect(player.getBoundingClientRect())) return 0;

        let score = 0;
        if (isAdUiNear(player)) score += 4;
        if (hasVisibleGlobalAdMarker()) score += 2;
        score += mediaHostScore(media);
        score += shortClipScore(media);
        score += autoplayingScore(media);

        return score;
    }

    function scanForVideoAds(root = document) {
        clickSkipButtons(root);

        if (root instanceof HTMLElement && VIDEO_AD_TEXT_RE.test(elementText(root))) {
            const rootCandidate = findVideoAdRoot(root);
            if (rootCandidate) {
                if (!neutralizePlayerAd(rootCandidate)) hideRoot(rootCandidate);
            }
        }

        const candidates = root.querySelectorAll('button, a, div, span, section, aside, [role="dialog"], [aria-label], [title]');
        for (const node of candidates) {
            if (!(node instanceof HTMLElement)) continue;
            const text = elementText(node);
            if (!VIDEO_AD_TEXT_RE.test(text)) continue;
            const adRoot = findVideoAdRoot(node);
            if (adRoot) {
                if (!neutralizePlayerAd(adRoot)) hideRoot(adRoot);
            }
        }

        for (const media of root.querySelectorAll?.('video, audio') || []) {
            const player = findPlayerRoot(media);
            if (!player) continue;
            if (isAdUiNear(player)) {
                reportSourceHosts(player);
                forceFinishMediaAd(media);
            }
        }

        for (const media of document.querySelectorAll('video, audio')) {
            const score = adScoreForMedia(media);
            if (score >= 4) {
                const player = findPlayerRoot(media);
                if (player) {
                    reportSourceHosts(player);
                    forceFinishMediaAd(media);
                }
            }
        }
    }

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const added of mutation.addedNodes) {
                if (!(added instanceof HTMLElement)) continue;
                scanForVideoAds(added);
            }
            if (mutation.type === 'characterData' && mutation.target.parentElement) {
                scanForVideoAds(mutation.target.parentElement);
            }
        }
    });

    if (document.documentElement) {
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => scanForVideoAds(document), { once: true });
    } else {
        scanForVideoAds(document);
    }

    sweepTimer = setInterval(() => {
        scanForVideoAds(document);
        releaseFinishedPlayers();
    }, 500);
})();
