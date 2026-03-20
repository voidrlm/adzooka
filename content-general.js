// Adzooka — General Content Script (all sites, document_idle)
// Removes generic ad DOM elements, closes popup overlays, and collapses
// ad containers on any page. YouTube/Spotify-specific logic stays in content.js.
(function () {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.runtime) return;

  // Skip YouTube and Spotify — they have their own dedicated content.js
  const host = location.hostname;
  if (host.includes('youtube.com') || host.includes('spotify.com')) return;

  // ── Generic ad element selectors ──────────────────────────────────────────
  const AD_SELECTORS = [
    // Standard ad classes used across networks
    '.textads', '.adsbox', '.banner_ads', '.adbox', '.ADBox',
    '.ad-banner', '.ad-container', '.ad-slot', '.ad-wrapper',
    '.adsbygoogle', 'ins.adsbygoogle',
    '[data-ad-client]', '[data-ad-slot]',

    // Google / DFP
    'div[id^="google_ads_"]', 'iframe[id^="google_ads_iframe"]',
    'iframe[id^="aswift_"]', '[id^="div-gpt-ad"]',
    '#tads', '#tadsb', '#bottomads',

    // Taboola / Outbrain
    '[id^="taboola-"]', '.trc_rbox_div',
    '[id^="outbrain_"]', '.OUTBRAIN', '.ob-widget',

    // Criteo
    '.criteo-widget', '[id^="criteo_"]',

    // Reddit sponsored
    '[data-promoted="true"]', 'shreddit-ad-post',

    // Sticky/float banners
    '[class*="sticky-ad"]', '[class*="ad-sticky"]',
    'div[class*="float-ad"]', 'div[id*="float-ad"]',
  ].join(',');

  // ── Popup / overlay selectors ──────────────────────────────────────────────
  // Only targets elements that look like ad overlays, not legitimate modals.
  const POPUP_SELECTORS = [
    '#popup-ad', '#ad-popup', '#adOverlay', '#ad-overlay',
    '.popup-ad', '.ad-popup-wrapper',
    '[id*="popup-overlay"]', '[id*="ad-overlay"]',
  ].join(',');

  function removeAdElements() {
    try {
      document.querySelectorAll(AD_SELECTORS).forEach(el => {
        // Never remove real media
        if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') return;
        el.remove();
      });
    } catch (_) {}
  }

  function removePopupOverlays() {
    try {
      // CSS-selector-targeted ad popups
      document.querySelectorAll(POPUP_SELECTORS).forEach(el => el.remove());

      // Heuristic: fixed full-screen divs injected by ad scripts
      // Only matches elements with suspiciously high z-index covering the full viewport
      document.querySelectorAll(
        'div[style*="position: fixed"], div[style*="position:fixed"]'
      ).forEach(el => {
        const s = el.style;
        const zIndex = parseInt(s.zIndex, 10);
        if (!zIndex || zIndex < 1000) return;
        const rect = el.getBoundingClientRect();
        const coversViewport = rect.width >= window.innerWidth * 0.8 &&
                               rect.height >= window.innerHeight * 0.8;
        if (!coversViewport) return;
        // Only remove if it has no interactive child elements (forms, videos, inputs)
        if (el.querySelector('input, select, textarea, video, audio')) return;
        el.remove();
      });
    } catch (_) {}
  }

  function run() {
    removeAdElements();
    removePopupOverlays();
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  run();

  let _timer;
  new MutationObserver(() => {
    clearTimeout(_timer);
    _timer = setTimeout(run, 200);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
