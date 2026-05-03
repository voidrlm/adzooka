(function () {
    if (location.hostname.includes('youtube.com')) return;

    const STYLE_ID = '__adzooka-cosmetic-user';
    const FRAME_CLUSTER_PREFIX = 'adzooka-frame-cluster:';
    const site = window.location.hostname;
    const VIDEO_AD_TEXT_RE = /\b(skip\s+(?:ad|ads)|skip\s+in\s+\d|advertisement|commercial\s+break|your\s+video\s+will\s+resume|this\s+ad\s+will\s+end\s+in|remove\s+ads?|log\s*in\s+or\s+sign\s*up\s+to\s+remove\s+ads|skip\s+ad\s*>>|ad\s+\d{1,2})\b/i;
    const SKIP_NOW_RE = /\bskip\s+ads?\b/i;
    const STRONG_AD_TEXT_RE = /\b(this\s+ad\s+will\s+end\s+in|remove\s+ads?|log\s*in\s+or\s+sign\s*up\s+to\s+remove\s+ads|skip\s+ad\s*>>)\b/i;
    const MUTE_RE = /\b(mute|unmute|volume)\b/i;
    const SUPPRESSION_HOLD_MS = 1400;
    const RELEASE_GRACE_MS = 1200;
    const PLAYER_COOLDOWN_MS = 2500;
    const hiddenRoots = new WeakSet();
    const playerState = new WeakMap();
    let frameClusterRules = [];
    let sweepTimer = null;
    let siteEnabled = true;

    function parseFrameClusterRule(selector) {
        if (typeof selector !== 'string' || !selector.startsWith(FRAME_CLUSTER_PREFIX)) return null;
        try {
            const rule = JSON.parse(selector.slice(FRAME_CLUSTER_PREFIX.length));
            if (!rule || typeof rule !== 'object') return null;
            return rule;
        } catch (_) {
            return null;
        }
    }

    function querySelectorAllIncludingShadow(selector, root = document) {
        const results = [];
        const visited = new Set();

        function traverse(node) {
            if (!node || visited.has(node)) return;
            visited.add(node);

            if (node.nodeType === Node.ELEMENT_NODE) {
                try {
                    const matches = node.querySelectorAll(selector);
                    for (const match of matches) {
                        if (!visited.has(match)) {
                            visited.add(match);
                            results.push(match);
                        }
                    }
                } catch (_) {}

                // Check shadow root
                if (node.shadowRoot) {
                    traverse(node.shadowRoot);
                }

                // Traverse children
                for (const child of node.children) {
                    traverse(child);
                }
            }
        }

        traverse(root);
        return results;
    }

    function querySelectorIncludingShadow(selector, root = document) {
        const results = querySelectorAllIncludingShadow(selector, root);
        return results.length > 0 ? results[0] : null;
    }

    function applySelectors(selectors) {
        let el = document.getElementById(STYLE_ID);
        frameClusterRules = (selectors || []).map(parseFrameClusterRule).filter(Boolean);
        const cssSelectors = (selectors || []).filter((selector) => !parseFrameClusterRule(selector));

        if (cssSelectors.length === 0) {
            if (el) el.remove();
        } else {
            if (!el) {
                el = document.createElement('style');
                el.id = STYLE_ID;
                (document.head || document.documentElement).appendChild(el);
            }
            el.textContent = cssSelectors.map((selector) => `${selector}{display:none!important}`).join('\n');
        }

        applyFrameClusterRules();
    }

    function hideFrameClusterNode(node) {
        if (!isDomElement(node) || hiddenRoots.has(node)) return false;
        hiddenRoots.add(node);
        node.style.setProperty('display', 'none', 'important');
        node.style.setProperty('visibility', 'hidden', 'important');
        node.style.setProperty('pointer-events', 'none', 'important');
        return true;
    }

    function applyFrameClusterRule(rule, root = document) {
        let matched = 0;

        try {
            const anchor = querySelectorIncludingShadow(rule.anchor || 'body') || document.body;
            const frames = Array.from(querySelectorAllIncludingShadow('iframe, frame', anchor));
            const frame = frames[rule.index];
            if (frame && hideFrameClusterNode(frame)) matched += 1;
        } catch (_) {}

        return matched;
    }

    function applyFrameClusterRules(root = document) {
        if (!frameClusterRules.length) return;
        for (const rule of frameClusterRules) {
            applyFrameClusterRule(rule, root);
        }
    }

    chrome.storage.local.get(['blockedSelectors', 'disabledSites'], ({ blockedSelectors = {}, disabledSites = [] }) => {
        siteEnabled = !disabledSites.includes(site);
        if (siteEnabled) applySelectors(blockedSelectors[site] || []);
    });

    chrome.storage.onChanged.addListener((changes) => {
        if (changes.disabledSites) {
            siteEnabled = !(changes.disabledSites.newValue || []).includes(site);
            if (!siteEnabled) applySelectors([]);
        }
        if (changes.blockedSelectors && siteEnabled) {
            applySelectors((changes.blockedSelectors.newValue || {})[site] || []);
        }
    });

    function isSearchUiHost() {
        return /(^|\.)google\./i.test(site) ||
            /(^|\.)bing\.com$/i.test(site) ||
            /(^|\.)duckduckgo\.com$/i.test(site) ||
            /(^|\.)search\.yahoo\.com$/i.test(site);
    }

    function isDomElement(el) {
        return !!el &&
            el.nodeType === Node.ELEMENT_NODE &&
            typeof el.matches === 'function' &&
            typeof el.getAttribute === 'function';
    }

    function safeRect(el) {
        if (!isDomElement(el) || typeof el.getBoundingClientRect !== 'function') return null;
        try {
            return el.getBoundingClientRect();
        } catch (_) {
            return null;
        }
    }

    function isElementVisible(el) {
        if (!isDomElement(el)) return false;
        let style;
        try {
            style = getComputedStyle(el);
        } catch (_) {
            return false;
        }
        const rect = safeRect(el);
        if (!rect) return false;
        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            parseFloat(style.opacity || '1') > 0.01 &&
            rect.width > 10 &&
            rect.height > 10;
    }

    function isLargeMediaRect(rect) {
        return rect.width >= 220 && rect.height >= 120;
    }

    function isPrimaryPlayerRect(rect) {
        const vw = window.innerWidth || 0;
        const vh = window.innerHeight || 0;
        return rect.width >= Math.max(420, vw * 0.4) && rect.height >= Math.max(236, vh * 0.22);
    }

    function hasMeaningfulMedia(root = document) {
        if (isSearchUiHost()) return false;

        const candidates = querySelectorAllIncludingShadow('video, audio, iframe', root);
        for (const node of candidates) {
            if (!isDomElement(node) || !isElementVisible(node)) continue;
            const rect = safeRect(node);
            if (!rect) continue;
            if (isLargeMediaRect(rect)) return true;
        }
        return false;
    }

    function elementText(el) {
        if (!isDomElement(el)) return '';
        return [
            el.innerText,
            el.textContent,
            el.getAttribute('aria-label'),
            el.getAttribute('title'),
            el.getAttribute('data-testid'),
        ].filter(Boolean).join(' ').trim();
    }

    function looksLikeSkipButton(el) {
        if (!isDomElement(el)) return false;
        if (!isElementVisible(el)) return false;
        const text = elementText(el);
        if (!SKIP_NOW_RE.test(text)) return false;
        const tag = el.tagName;
        return tag === 'BUTTON' || tag === 'A' || el.getAttribute('role') === 'button' || el.tabIndex >= 0;
    }

    function clickSkipButtons(root = document) {
        const candidates = querySelectorAllIncludingShadow('button, a, div, span, [role="button"], [aria-label], [title]', root);
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
                holdUntil: 0,
                lastAdSignalAt: 0,
                cooldownUntil: 0,
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

    function markPlayerAdActive(player) {
        const state = ensureBlackout(player);
        const now = Date.now();
        state.active = true;
        state.lastAdSignalAt = now;
        state.holdUntil = now + SUPPRESSION_HOLD_MS;
        state.cooldownUntil = 0;
        return state;
    }

    function clearBlackout(player) {
        const state = playerState.get(player);
        if (!state) return;

        state.active = false;
        state.holdUntil = 0;
        state.lastAdSignalAt = 0;
        state.cooldownUntil = Date.now() + PLAYER_COOLDOWN_MS;
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
        for (const media of querySelectorAllIncludingShadow('video, audio', root)) {
            try {
                media.pause();
            } catch (_) {}
        }
    }

    function killAdMediaInside(root) {
        const mediaNodes = querySelectorAllIncludingShadow('video, audio', root);
        for (const media of mediaNodes) {
            try { media.pause(); } catch (_) {}
            try { media.removeAttribute('src'); } catch (_) {}
            for (const source of querySelectorAllIncludingShadow('source', media)) {
                try { source.removeAttribute('src'); } catch (_) {}
            }
            try { media.load(); } catch (_) {}
        }

        const iframes = querySelectorAllIncludingShadow('iframe', root);
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

    function findPlayableMedia(start) {
        if (start instanceof HTMLVideoElement || start instanceof HTMLAudioElement) return start;
        if (isDomElement(start)) {
            const direct = start.querySelector('video, audio');
            if (direct) return direct;
        }
        return null;
    }

    function findPlayerRoot(start) {
        let node = isDomElement(start) ? start : null;
        while (node && node !== document.body && node !== document.documentElement) {
            const rect = safeRect(node);
            if (!rect) {
                node = node.parentElement;
                continue;
            }
            if ((findPlayableMedia(node) || node.querySelector('iframe')) && isLargeMediaRect(rect)) {
                return node;
            }
            node = node.parentElement;
        }
        return null;
    }

    function isLikelyPreviewMedia(media) {
        if (!(media instanceof HTMLMediaElement)) return false;
        const rect = media.getBoundingClientRect();
        const player = findPlayerRoot(media);
        const playerRect = player?.getBoundingClientRect?.() || rect;
        const anchored = !!media.closest('a');
        const muted = !!media.muted;
        const noControls = !media.controls;
        const loops = !!media.loop;
        const smallish = playerRect.width < 420 || playerRect.height < 236;
        return smallish && muted && noControls && (loops || anchored);
    }

    function rectsOverlap(a, b, padding = 0) {
        if (!a || !b) return false;
        return !(a.right < b.left - padding ||
            a.left > b.right + padding ||
            a.bottom < b.top - padding ||
            a.top > b.bottom + padding);
    }

    function hasTextMarkerNearPlayer(player, regex) {
        if (!isDomElement(player)) return false;
        const playerRect = safeRect(player);
        if (!playerRect) return false;
        const scopes = [player];
        if (player.parentElement) scopes.push(player.parentElement);
        if (player.parentElement?.parentElement) scopes.push(player.parentElement.parentElement);

        let seen = 0;
        for (const scope of scopes) {
            if (!(scope instanceof HTMLElement)) continue;
            if (regex.test(elementText(scope))) return true;

            const nodes = querySelectorAllIncludingShadow('button, a, div, span, p, section, aside, strong, small, [role="dialog"], [aria-label], [title]', scope);
            for (const node of nodes) {
                if (!isDomElement(node) || !isElementVisible(node)) continue;
                const text = elementText(node);
                if (!text || !regex.test(text)) continue;
                if (rectsOverlap(playerRect, safeRect(node), 24)) return true;
                seen += 1;
                if (seen > 250) return false;
            }
        }

        return false;
    }

    function forceFinishMediaAd(media) {
        if (!(media instanceof HTMLMediaElement)) return;

        // Never manipulate long-form content (> 3 min) without a confirmed strong ad signal
        if (Number.isFinite(media.duration) && media.duration > 180) {
            const player = findPlayerRoot(media) || media.parentElement;
            if (!player || !hasTextMarkerNearPlayer(player, STRONG_AD_TEXT_RE)) return;
        }

        try {
            const player = findPlayerRoot(media) || media.parentElement;
            const state = player ? playerState.get(player) : null;
            const hasLocalAdMarker = player ? hasTextMarkerNearPlayer(player, VIDEO_AD_TEXT_RE) : false;
            if (player && state?.cooldownUntil > Date.now() && !hasLocalAdMarker) {
                return;
            }

            const activeState = player ? markPlayerAdActive(player) : null;
            if (activeState && activeState.originalMuted === null) {
                activeState.originalMuted = media.muted;
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

        const media = findPlayableMedia(player);
        if (media) {
            // Don't touch long-form content that lacks ad markers within the player
            if (Number.isFinite(media.duration) && media.duration > 60 &&
                !hasTextMarkerNearPlayer(player, VIDEO_AD_TEXT_RE)) {
                return false;
            }
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

    function hideRoot(root) {
        if (!isDomElement(root) || hiddenRoots.has(root)) return;
        hiddenRoots.add(root);
        killAdMediaInside(root);
        pauseMediaInside(root);
        root.style.setProperty('display', 'none', 'important');
        root.style.setProperty('visibility', 'hidden', 'important');
        root.style.setProperty('pointer-events', 'none', 'important');
    }

    function isLargeOverlay(el) {
        if (!isDomElement(el)) return false;
        const style = getComputedStyle(el);
        const rect = safeRect(el);
        if (!rect) return false;
        const z = parseInt(style.zIndex, 10) || 0;
        const vw = window.innerWidth || 0;
        const vh = window.innerHeight || 0;
        const coversEnough = rect.width >= vw * 0.35 && rect.height >= vh * 0.2;
        return ['fixed', 'absolute', 'sticky'].includes(style.position) && z >= 10 && coversEnough;
    }

    function hasMediaSignals(el) {
        if (!isDomElement(el)) return false;
        if (el.matches('video, iframe')) return true;
        if (el.querySelector('video, iframe')) return true;
        const text = elementText(el);
        if (MUTE_RE.test(text) && isLargeOverlay(el)) return true;
        return false;
    }

    function findVideoAdRoot(start) {
        let node = isDomElement(start) ? start : null;
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
        const now = Date.now();
        for (const video of document.querySelectorAll('video, audio')) {
            const player = findPlayerRoot(video);
            if (!player) continue;
            const state = playerState.get(player);
            if (!state?.active) continue;

            const inAdMode = hasTextMarkerNearPlayer(player, VIDEO_AD_TEXT_RE) || isAdUiNear(player) || isAdUiNear(video.parentElement);
            if (inAdMode) {
                state.lastAdSignalAt = now;
                state.holdUntil = Math.max(state.holdUntil || 0, now + 250);
                continue;
            }

            if ((state.holdUntil && now < state.holdUntil) || (state.lastAdSignalAt && now - state.lastAdSignalAt < RELEASE_GRACE_MS)) {
                continue;
            }

            clearBlackout(player);
            try { video.playbackRate = 1; } catch (_) {}
        }
    }

    function isAdUiNear(root) {
        if (!isDomElement(root)) return false;
        if (VIDEO_AD_TEXT_RE.test(elementText(root))) return true;
        const nodes = querySelectorAllIncludingShadow('button, a, div, span, section, aside, [role="dialog"], [aria-label], [title]', root);
        for (const node of nodes) {
            if (isElementVisible(node) && VIDEO_AD_TEXT_RE.test(elementText(node))) return true;
        }
        return false;
    }

    function getLargestVisibleMedia() {
        let best = null;
        let bestArea = 0;
        for (const media of querySelectorAllIncludingShadow('video, audio')) {
            if (!(media instanceof HTMLMediaElement)) continue;
            const player = findPlayerRoot(media);
            if (!player || !isElementVisible(player)) continue;
            const rect = safeRect(player);
            if (!rect) continue;
            if (!isLargeMediaRect(rect)) continue;
            const area = rect.width * rect.height;
            if (area > bestArea) {
                best = media;
                bestArea = area;
            }
        }
        return best;
    }

    function mediaHostScore(media) {
        const host = hostFromUrl(media.currentSrc || media.src || media.getAttribute('src'));
        if (!host) return 0;
        if (host !== location.hostname.toLowerCase()) return 2;
        return 0;
    }

    function shortClipScore(media) {
        if (!Number.isFinite(media.duration) || media.duration <= 0) return 0;
        if (media.duration <= 30) return 1;
        return 0;
    }

    function autoplayingScore(media) {
        if (media.paused) return 0;
        if (media.autoplay) return 1;
        return 0;
    }

    function adScoreForMedia(media) {
        if (!(media instanceof HTMLMediaElement)) return 0;
        if (isLikelyPreviewMedia(media)) return 0;
        const player = findPlayerRoot(media);
        if (!player) return 0;
        if (!isElementVisible(player)) return 0;
        const rect = safeRect(player);
        if (!rect) return 0;
        if (!isLargeMediaRect(rect)) return 0;
        if (!isPrimaryPlayerRect(rect) && !isAdUiNear(player)) return 0;

        let score = 0;
        if (isAdUiNear(player)) score += 4;
        if (hasTextMarkerNearPlayer(player, VIDEO_AD_TEXT_RE)) score += 2;
        if (hasTextMarkerNearPlayer(player, STRONG_AD_TEXT_RE)) score += 4;
        score += mediaHostScore(media);
        score += shortClipScore(media);
        score += autoplayingScore(media);

        return score;
    }

    function scanForVideoAds(root = document) {
        if (!siteEnabled) return;
        if (!hasMeaningfulMedia(root) && !hasMeaningfulMedia(document)) return;

        clickSkipButtons(root);

        const primary = getLargestVisibleMedia();
        const primaryPlayer = primary ? findPlayerRoot(primary) : null;
        if (primary && primaryPlayer && hasTextMarkerNearPlayer(primaryPlayer, STRONG_AD_TEXT_RE)) {
            if (!isLikelyPreviewMedia(primary)) {
                forceFinishMediaAd(primary);
            }
        }

        if (root instanceof HTMLElement && VIDEO_AD_TEXT_RE.test(elementText(root))) {
            const rootCandidate = findVideoAdRoot(root);
            if (rootCandidate) {
                if (!neutralizePlayerAd(rootCandidate)) hideRoot(rootCandidate);
            }
        }

        const candidates = querySelectorAllIncludingShadow('button, a, div, span, section, aside, [role="dialog"], [aria-label], [title]', root);
        for (const node of candidates) {
            if (!(node instanceof HTMLElement)) continue;
            const text = elementText(node);
            if (!VIDEO_AD_TEXT_RE.test(text)) continue;
            const adRoot = findVideoAdRoot(node);
            if (adRoot) {
                if (!neutralizePlayerAd(adRoot)) hideRoot(adRoot);
            }
        }

        for (const media of querySelectorAllIncludingShadow('video, audio', root)) {
            const player = findPlayerRoot(media);
            if (!player) continue;
            if (!isLikelyPreviewMedia(media) && isAdUiNear(player)) {
                forceFinishMediaAd(media);
            }
        }

        for (const media of querySelectorAllIncludingShadow('video, audio')) {
            const score = adScoreForMedia(media);
            if (score >= 6) {
                forceFinishMediaAd(media);
            }
        }
    }

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const added of mutation.addedNodes) {
                if (!isDomElement(added)) continue;
                if (siteEnabled) applyFrameClusterRules(added);
                if (siteEnabled) scanForVideoAds(added);
            }
            if (mutation.type === 'characterData' && mutation.target.parentElement) {
                if (siteEnabled) scanForVideoAds(mutation.target.parentElement);
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
        if (!siteEnabled) return;
        applyFrameClusterRules(document);
        if (!hasMeaningfulMedia(document)) return;
        scanForVideoAds(document);
        releaseFinishedPlayers();
    }, 500);
})();
