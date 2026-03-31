// Adzooka — Spotify ad muting (MAIN world)
(function () {
    'use strict';

    if (!location.hostname.includes('spotify.com')) return;

    const captured = new Set();

    const nativeCreate = document.createElement.bind(document);
    document.createElement = function (tag) {
        const el = nativeCreate.apply(this, arguments);
        if (typeof tag === 'string' && (tag === 'audio' || tag === 'video')) {
            captured.add(el);
        }
        return el;
    };

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
        document.querySelectorAll('audio, video').forEach(el => captured.add(el));
        return captured;
    }

    function isAdPlaying() {
        // Reliable selector-based checks only — no broad text scanning
        if (document.querySelector(
            '[data-testadtype="ad-type-ad"],' +
            '[data-testid="ad-break-ui"],' +
            '[data-testid="ad-break-overlay"],' +
            '[data-testid="advertisement"],' +
            'div[data-testid="ad-manager"]'
        )) return true;

        // Only scan the right-side "now playing" sidebar for ad break text,
        // not the whole page (avoids false positives from lyrics/descriptions)
        const sidebar = document.querySelector(
            '[data-testid="now-playing-widget"], ' +
            '[data-testid="right-sidebar"], ' +
            'aside[aria-label]'
        );
        const container = sidebar || document.body;
        if (!container) return false;

        return (
            container.innerText.includes('after the break') ||
            container.innerText.includes('left in the break')
        );
    }

    function muteAds() {
        for (const el of allMedia()) {
            try {
                // Only mute short-duration elements that are actively playing — those are ads.
                // Never seek or change playback rate (detectable + causes song skipping).
                const isPlaying = !el.paused && !el.ended && el.readyState >= 2;
                const isShort = isFinite(el.duration) && el.duration > 0 && el.duration < 45;
                if (isPlaying && isShort) {
                    el.muted = true;
                    el.volume = 0;
                    el.playbackRate = 10; // silent + fast — no seeking, so completes naturally
                }
            } catch (_) {}
        }
    }

    function restoreAudio() {
        for (const el of allMedia()) {
            try {
                el.muted = false;
                el.volume = 1;
                if (el.playbackRate !== 1) el.playbackRate = 1;
            } catch (_) {}
        }
    }

    let wasAdPlaying = false;
    let adConfirmCount = 0;

    setInterval(() => {
        const adNow = isAdPlaying();
        if (adNow) {
            adConfirmCount = Math.min(adConfirmCount + 1, 10);
            if (adConfirmCount >= 2) {
                muteAds();
                wasAdPlaying = true;
            }
        } else {
            adConfirmCount = 0;
            if (wasAdPlaying) {
                wasAdPlaying = false;
                restoreAudio();
            }
        }
    }, 400);
})();
