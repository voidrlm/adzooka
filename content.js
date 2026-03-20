// Adzooka — Content Script
// YouTube: removes ad DOM elements, clicks skip buttons, fast-forwards unskippable ads.
// Spotify: bails immediately — Spotify ads are audio streams; DOM removal breaks their
//          React app. Spotify ad tracking is blocked via DNR (ad_block_rules.json).
(function () {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.runtime) return;

  // Spotify: no DOM manipulation — just let DNR rules handle it
  if (location.hostname.includes('spotify.com')) return;

  // Only run on YouTube
  if (!location.hostname.includes('youtube.com')) return;

  // ── YouTube ad DOM selectors ───────────────────────────────────────────────
  const YT_SELECTORS = [
    '#masthead-ad',
    '#player-ads',
    '.ytd-ad-slot-renderer',
    '.ytd-in-feed-ad-layout-renderer',
    '.ytd-promoted-video-renderer',
    '.ytd-promoted-sparkles-web-renderer',
    '.ytd-banner-promo-renderer',
    'ytd-action-companion-ad-renderer',
    'ytd-display-ad-renderer',
    'ytd-statement-banner-renderer',
    'yt-mealbar-promo-renderer',
    '.ytp-ad-module',
    '.ytp-ad-overlay-container',
    '.ytp-ad-text-overlay',
    '.ytp-ad-progress',
    '.ytp-ad-progress-list',
  ].join(',');

  // ── YouTube skip-button selectors ─────────────────────────────────────────
  const YT_SKIP_BTN = [
    '.ytp-ad-skip-button',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-modern',
    'button.ytp-ad-skip-button-container',
  ].join(',');

  function removeYTAdElements() {
    try { document.querySelectorAll(YT_SELECTORS).forEach(el => el.remove()); } catch (_) {}
  }

  // Clicks the skip button if visible, otherwise fast-forwards unskippable ads.
  function handleYouTubeAd() {
    try {
      const btn = document.querySelector(YT_SKIP_BTN);
      if (btn) { btn.click(); return; }

      const player = document.querySelector('.ad-showing');
      if (!player) return;
      const video = document.querySelector('video');
      if (!video) return;
      if (!isFinite(video.duration) || video.duration <= 0) return;
      if (video.currentTime < 0.5) return;
      if (video.currentTime >= video.duration - 0.1) return;
      video.currentTime = video.duration;
    } catch (_) {}
  }

  function run() {
    removeYTAdElements();
    handleYouTubeAd();
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }

  let _timer;
  new MutationObserver(() => {
    clearTimeout(_timer);
    _timer = setTimeout(run, 80);
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('load', () => {
    run();
    setTimeout(run, 1500);
    setTimeout(run, 4000);
  }, { once: true });

  // Poll every 300 ms to catch mid-roll ads injected during playback
  setInterval(handleYouTubeAd, 300);
})();
