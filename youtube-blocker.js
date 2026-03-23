// Adzooka — YouTube ad blocking (ISOLATED world)
// CSS rules from youtubeblocker extension. Hides ad elements and auto-skips.
(function () {
    'use strict';

    if (!location.hostname.includes('youtube.com')) return;

    // ── CSS rules (from youtubeblocker cssRulesFallback) ──────────────────────
    const AD_SELECTORS = [
        '#offer-module',
        '#promotion-shelf',
        '#description-inner > ytd-merch-shelf-renderer > #main.ytd-merch-shelf-renderer',
        '#shorts-inner-container > .ytd-shorts:has(> .ytd-reel-video-renderer > ytd-ad-slot-renderer)',
        '#shopping-timely-shelf',
        'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)',
        '.ytReelMetapanelViewModelHost > .ytReelMetapanelViewModelMetapanelItem > .ytShortsSuggestedActionViewModelStaticHost',
        '.ytd-section-list-renderer > .ytd-item-section-renderer > ytd-search-pyv-renderer.ytd-item-section-renderer',
        '.ytd-two-column-browse-results-renderer > ytd-rich-grid-renderer > #masthead-ad.ytd-rich-grid-renderer',
        '.ytd-watch-flexy > .ytd-watch-next-secondary-results-renderer > ytd-ad-slot-renderer.ytd-watch-next-secondary-results-renderer',
        '.ytd-watch-flexy > ytd-merch-shelf-renderer > #main.ytd-merch-shelf-renderer',
        '.grid.ytd-browse > #primary > .style-scope > .ytd-rich-grid-renderer > .ytd-rich-grid-renderer > .ytd-ad-slot-renderer',
        '.ytd-rich-item-renderer.style-scope > .ytd-rich-item-renderer > .ytd-ad-slot-renderer.style-scope',
        'ytd-item-section-renderer > .ytd-item-section-renderer > ytd-ad-slot-renderer.style-scope',
        '.ytp-suggested-action > .ytp-suggested-action-badge',
    ];

    // ── Inject CSS ─────────────────────────────────────────────────────────────
    function injectCSS() {
        if (document.getElementById('__adzooka-yt')) return;
        const s = document.createElement('style');
        s.id = '__adzooka-yt';
        s.textContent = AD_SELECTORS.map(sel => `${sel}{display:none!important}`).join('\n');
        (document.head || document.documentElement).appendChild(s);
    }

    // ── Auto-skip ad buttons ───────────────────────────────────────────────────
    function skipAds() {
        // Click skip button
        const skip = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-container button');
        if (skip) { skip.click(); return; }

        // If unskippable ad is playing, mute and fast-forward
        const adBadge = document.querySelector('.ytp-ad-player-overlay-instream-info');
        const video = document.querySelector('video');
        if (adBadge && video && video.duration && isFinite(video.duration)) {
            video.muted = true;
            video.currentTime = video.duration;
        }
    }

    // ── MutationObserver for dynamic ad insertion ──────────────────────────────
    const observer = new MutationObserver(skipAds);

    function init() {
        injectCSS();
        skipAds();
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    document.addEventListener('yt-navigate-finish', () => { injectCSS(); skipAds(); });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
