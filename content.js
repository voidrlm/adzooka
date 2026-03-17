// ─── Adzooka — Content Script v3 ─────────────────────────────────────────────
// Layers:
//   1. cosmetic.css  — static CSS injected by the browser at document_start
//   2. Filter-list CSS — fetched by background.js, injected here from storage
//   3. DOM removal   — removes elements that survive CSS hiding
//   4. Anti-adblock  — removes overlay walls asking you to disable the blocker
//   5. Skip-ad       — auto-clicks "Skip ad" buttons on video players
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';
  // Bail out if the extension context has been invalidated (e.g. after reload)
  if (typeof chrome === 'undefined' || !chrome.runtime) return;

  // Spotify: ads are audio streams, not DOM elements. DOM removal breaks their
  // React app and causes "Something went wrong". DNR rules in ad_block_rules.json
  // redirect ad audio to noop-1s.mp4 — no JS manipulation needed here.
  if (location.hostname.includes('spotify.com')) return;

  // ── 1. Inject filter-list cosmetic CSS from storage ───────────────────────
  // background.js fetches EasyList + uBO filter lists and stores the parsed
  // CSS. We inject it here as early as possible (document_start).
  function injectFilterListCSS() {
    if (document.getElementById('__az_fl__')) return;
    try {
      chrome.storage?.local.get('cosmeticCSS', ({ cosmeticCSS }) => {
        if (!cosmeticCSS) return;
        const s = document.createElement('style');
        s.id = '__az_fl__';
        s.textContent = cosmeticCSS;
        (document.head || document.documentElement).appendChild(s);
      });
    } catch (_) {}
  }

  // ── 2. Targeted DOM removal ───────────────────────────────────────────────
  // Only well-tested, specific selectors — no broad [class*="ad-"] patterns.
  const SELECTORS = [
    // Google AdSense
    'ins.adsbygoogle',
    '[data-ad-client]',
    '[data-ad-slot]',
    'div[id^="google_ads_"]',
    'iframe[id^="google_ads_iframe"]',
    'iframe[id^="aswift_"]',
    // Google Publisher Tag / DFP
    '[id^="div-gpt-ad"]',
    '[data-google-query-id]',
    // Google Search ads
    '#tads',
    '#tadsb',
    '#bottomads',
    '[data-text-ad]',
    // YouTube
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
    // Outbrain
    '.OUTBRAIN',
    '.ob-widget',
    '[id^="outbrain_"]',
    // Taboola
    '[id^="taboola-"]',
    '[class^="taboola-"]',
    '.trc_rbox_div',
    // Twitter/X promoted
    '[data-testid="placementTracking"]',
    '[aria-label="Promoted Tweet"]',
    // ARIA-labelled ad slots
    '[aria-label="Advertisement"]',
    '[aria-label="Sponsored"]',
    // Tracking pixels
    'img[width="1"][height="1"]',
    'img[width="0"][height="0"]',
    // Anti-adblock nag elements
    '.adblock-notice',
    '.adblock-overlay',
    '.adblock-wall',
    // Known ad iframes
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="googlesyndication.com"]',
    'iframe[src*="adnxs.com"]',
    'iframe[src*="amazon-adsystem.com"]',
    'iframe[src*="exoclick.com"]',
    'iframe[src*="trafficjunky.net"]',
    'iframe[src*="juicyads.com"]',
    'iframe[src*="trafficfactory.biz"]',
    'iframe[src*="plugrush.com"]',
    'iframe[src*="hilltopads.net"]',
  ].join(',');

  function removeBySelectors() {
    let n = 0;
    try {
      document.querySelectorAll(SELECTORS).forEach(el => { el.remove(); n++; });
    } catch (_) {}
    return n;
  }

  // ── 3. Collapse empty GPT/DFP slot divs ──────────────────────────────────
  // After network blocking, these divs are empty but still take up space.
  function collapseEmptySlots() {
    try {
      document.querySelectorAll(
        '[id^="div-gpt-ad"],[id*="-dfp-"],[class*="gpt-ad"],[class*="dfp-ad"]'
      ).forEach(el => {
        if (!el.children.length && !el.textContent.trim()) {
          el.style.setProperty('display', 'none', 'important');
        }
      });
    } catch (_) {}
  }

  // ── 4. Anti-adblock overlay removal ──────────────────────────────────────
  // Detects fixed/absolute overlays with adblock-detection text and removes them.
  const ANTIBLOCK_PHRASES = [
    'disable your ad blocker',
    'turn off adblock',
    'ad blocker detected',
    'adblock detected',
    'we detected an ad blocker',
    'disable adblock',
    'whitelist our site',
    'please disable your adblocker',
    'you are using an ad blocker',
    'ad blocking software',
  ];

  function removeAdblockWalls() {
    try {
      document.querySelectorAll('div,section,aside,article').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'absolute') return;
        if (parseInt(cs.zIndex) < 100) return;
        const r = el.getBoundingClientRect();
        if (r.width < window.innerWidth * 0.3) return;
        const text = el.textContent.toLowerCase();
        if (ANTIBLOCK_PHRASES.some(p => text.includes(p))) {
          el.remove();
          if (document.body?.style.overflow === 'hidden') document.body.style.overflow = '';
        }
      });
    } catch (_) {}
  }

  // ── 5. Auto-click "Skip ad" buttons ──────────────────────────────────────
  // "ad/ads/advertisement" is now REQUIRED after "skip" — bare "Skip" (e.g.
  // Spotify's track-skip or YouTube's next-video button) no longer matches.
  const SKIP_RE = /^skip\s*(ad|ads|this\s*ad|advertisement|>+)\s*$/i;

  function clickSkipButtons() {
    try {
      document.querySelectorAll('button,[role="button"],a,div,span').forEach(el => {
        const text = (el.textContent || el.getAttribute('aria-label') || '').trim();
        if (!SKIP_RE.test(text)) return;
        const r = el.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) el.click();
      });
    } catch (_) {}
  }

  // ── 6. YouTube ad skipper ─────────────────────────────────────────────────
  // Handles ads that slip past the ytInitialPlayerResponse intercept in
  // scriptlets.js (e.g. mid-roll ads injected after page load).
  //   • Clicks skip button if present
  //   • Fast-forwards the video to its end for unskippable ads
  //   • Hides the ad overlay UI

  const YT_SKIP_BTN = [
    '.ytp-ad-skip-button',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-modern',
    'button.ytp-ad-skip-button-container',
  ].join(',');

  function handleYouTubeAd() {
    if (!location.hostname.includes('youtube.com')) return;
    try {
      // 1. Click skip button if visible
      const btn = document.querySelector(YT_SKIP_BTN);
      if (btn) { btn.click(); return; }

      // 2. Fast-forward unskippable ad — only when ALL conditions are met:
      //    • .ad-showing is on the player (YouTube's own ad indicator)
      //    • video has a finite, non-zero duration (fully loaded stream)
      //    • video has been playing for at least 0.5 s (avoids firing on load)
      const player = document.querySelector('.ad-showing');
      if (!player) return;
      const video = document.querySelector('video');
      if (!video) return;
      if (!isFinite(video.duration) || video.duration <= 0) return;
      if (video.currentTime < 0.5) return;          // too early — still loading
      if (video.currentTime >= video.duration - 0.1) return; // already at end

      video.currentTime = video.duration;
    } catch (_) {}
  }

  // ── Restore hidden video containers ──────────────────────────────────────
  // Walk up from every <video> and un-hide ancestors that our rules may have
  // collapsed. Stops at <body> or after 10 levels.
  const STOP_TAGS = new Set(['body','html','main','article','section']);
  function restoreVideoContainers() {
    try {
      document.querySelectorAll('video').forEach(vid => {
        let el = vid.parentElement;
        let steps = 0;
        while (el && !STOP_TAGS.has(el.tagName.toLowerCase()) && steps < 10) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') {
            el.style.setProperty('display', 'block', 'important');
            el.style.setProperty('visibility', 'visible', 'important');
          }
          el = el.parentElement;
          steps++;
        }
      });
    } catch (_) {}
  }

  // ── Master run ────────────────────────────────────────────────────────────
  function run() {
    const n = removeBySelectors();
    collapseEmptySlots();
    removeAdblockWalls();
    clickSkipButtons();
    handleYouTubeAd();
    if (n > 0) {
      chrome.runtime?.sendMessage({ type: 'CONTENT_BLOCKED', count: n })?.catch(() => {});
    }
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  injectFilterListCSS();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }

  // MutationObserver — debounced so it doesn't thrash on heavy SPAs
  let _timer;
  new MutationObserver(() => {
    clearTimeout(_timer);
    _timer = setTimeout(run, 80);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Extra passes after full page load for lazy-loaded / deferred ads
  window.addEventListener('load', () => {
    run();
    setTimeout(run, 1500);
    setTimeout(run, 4000);
  }, { once: true });

  // YouTube: poll every 300 ms to catch mid-roll ads injected during playback
  if (location.hostname.includes('youtube.com')) {
    setInterval(handleYouTubeAd, 300);
  }

})();
