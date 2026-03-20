// Adzooka — Scriptlets (MAIN world, document_start)
// Runs on all pages. Noops common ad/tracking APIs so ad slots never render
// even if a script partially loads. YouTube gets its own deeper intercept.
(function () {
  'use strict';

  // Spotify's SPA crashes on any global override — bail immediately
  if (location.hostname.includes('spotify.com')) return;

  // ── 1. YouTube — strip ad placements from player bootstrap data ───────────
  if (location.hostname.includes('youtube.com')) {
    let _ytpr;
    try {
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        get: () => _ytpr,
        set: val => {
          if (val && typeof val === 'object') {
            val.adPlacements = [];
            val.playerAds    = [];
          }
          _ytpr = val;
        },
        configurable: true,
      });
    } catch (_) {}
    return; // YouTube needs real googletag — skip the noops below
  }

  // ── 2. googletag (Google Publisher Tag / DFP) noop ─────────────────────────
  try {
    const fakeGPT = {
      cmd: { push() {} },
      defineSlot:          () => fakeGPT,
      defineOutOfPageSlot: () => fakeGPT,
      pubads: () => ({
        enableSingleRequest()          {},
        collapseEmptyDivs()            {},
        disableInitialLoad()           {},
        addEventListener()             {},
        refresh()                      {},
        setTargeting()                 {},
        setRequestNonPersonalizedAds() {},
      }),
      enableServices() {},
      display()        {},
      destroySlots:    () => true,
    };
    Object.defineProperty(window, 'googletag', {
      get: () => fakeGPT, set() {}, configurable: true,
    });
  } catch (_) {}

  // ── 3. adsbygoogle noop ────────────────────────────────────────────────────
  try {
    Object.defineProperty(window, 'adsbygoogle', {
      get: () => ({ push() {}, length: 0 }),
      set() {},
      configurable: true,
    });
  } catch (_) {}

  // ── 4. Google Analytics / GTM dataLayer noop ──────────────────────────────
  try {
    window.dataLayer = window.dataLayer || [];
    const _gtag = function () {};
    Object.defineProperty(window, 'gtag', {
      get: () => _gtag, set() {}, configurable: true,
    });
  } catch (_) {}

  // ── 5. Yandex.Metrica + Yandex Direct noops ────────────────────────────────
  try {
    Object.defineProperty(window, 'ym', {
      get: () => function () {}, set() {}, configurable: true,
    });
    window.yandex_rtb = window.yandex_rtb || {};
    window.yaContextCb = window.yaContextCb || { push() {} };
    window.yandexContextAsyncCallbacks = window.yandexContextAsyncCallbacks || { push() {} };
  } catch (_) {}

  // ── 6. Hotjar noop ─────────────────────────────────────────────────────────
  try {
    window._hjSettings = window._hjSettings || {};
    const noopFn = function () {};
    Object.defineProperty(window, 'hj', {
      get: () => noopFn, set() {}, configurable: true,
    });
  } catch (_) {}

  // ── 7. Sentry / Raven noop ─────────────────────────────────────────────────
  // Handles both old Raven.js API and new Sentry SDK
  try {
    const noopSentry = {
      config:           () => noopSentry,
      install:          () => noopSentry,
      captureException: () => {},
      captureMessage:   () => {},
      captureEvent:     () => {},
      addBreadcrumb:    () => {},
      setUser:          () => {},
      setTag:           () => {},
      setExtra:         () => {},
      configureScope:   () => {},
      withScope:        () => {},
      init:             () => {},
      getCurrentHub:    () => ({ getClient: () => null }),
    };
    Object.defineProperty(window, 'Raven',  { get: () => noopSentry, set() {}, configurable: true });
    Object.defineProperty(window, 'Sentry', { get: () => noopSentry, set() {}, configurable: true });
  } catch (_) {}

  // ── 8. Bugsnag noop ────────────────────────────────────────────────────────
  // Handles both old bugsnag("apiKey") API and new Bugsnag.start() API
  try {
    const noopBugsnag = function () { return noopBugsnag; };
    noopBugsnag.notify          = () => {};
    noopBugsnag.notifyException = () => {};
    noopBugsnag.refresh         = () => {};
    noopBugsnag.start           = () => noopBugsnag;
    noopBugsnag.createClient    = () => noopBugsnag;
    Object.defineProperty(window, 'bugsnag',  { get: () => noopBugsnag, set() {}, configurable: true });
    Object.defineProperty(window, 'Bugsnag',  { get: () => noopBugsnag, set() {}, configurable: true });
  } catch (_) {}

})();
