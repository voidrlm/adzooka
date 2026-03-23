// Adzooka — Spotify ad skipping (MAIN world)
(function () {
    'use strict';

    if (!location.hostname.includes('spotify.com')) return;

    const captured = new Set();

    // Intercept document.createElement('audio'/'video')
    const nativeCreate = document.createElement.bind(document);
    document.createElement = function (tag) {
        const el = nativeCreate.apply(this, arguments);
        if (typeof tag === 'string' && (tag === 'audio' || tag === 'video')) {
            captured.add(el);
        }
        return el;
    };

    // Intercept new Audio()
    const NativeAudio = window.Audio;
    if (NativeAudio) {
        window.Audio = function (...args) {
            const el = new NativeAudio(...args);
            captured.add(el);
            return el;
        };
        window.Audio.prototype = NativeAudio.prototype;
    }

    function allMedia() {
        // union of captured + anything in the DOM
        const domMedia = Array.from(document.querySelectorAll('audio, video'));
        domMedia.forEach(el => captured.add(el));
        return captured;
    }

    function skipAd() {
        for (const el of allMedia()) {
            try {
                el.muted = true;
                // Try seeking to end; fall back to 16× speed
                if (el.duration && isFinite(el.duration)) {
                    el.currentTime = el.duration;
                } else {
                    el.playbackRate = 16;
                }
            } catch (_) {}
        }
    }

    function isAdPlaying() {
        return !!document.querySelector(
            '[data-testadtype="ad-type-ad"], ' +
            '[aria-label*="Advertisement"], ' +
            '.UpgradeToPremiumBanner, ' +
            'div[data-testid="ad-manager"]'
        );
    }

    // Poll every 500ms
    setInterval(() => {
        if (isAdPlaying()) skipAd();
    }, 500);

    // Also react immediately via MutationObserver
    new MutationObserver(() => {
        if (isAdPlaying()) skipAd();
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-testadtype'] });
})();
