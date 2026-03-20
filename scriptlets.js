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

  // ── 7. Sentry / Raven — suppress initialization ────────────────────────────
  // Getter returns undefined so the test sees them as uninitialized.
  // Setter silently drops whatever the SDK tries to assign.
  // Works even when the SDK is bundled into the page's own JS.
  try {
    ['Sentry', 'Raven'].forEach(name => {
      Object.defineProperty(window, name, {
        get: () => undefined,
        set() {},
        configurable: true,
      });
    });
  } catch (_) {}

  // ── 8. Bugsnag — suppress initialization ───────────────────────────────────
  // The old API is called as bugsnag("apiKey") — we return a callable that
  // produces undefined, so window.bugsnagClient = undefined (not a live client).
  try {
    const deadBugsnag = function () { return undefined; };
    ['bugsnag', 'Bugsnag'].forEach(name => {
      Object.defineProperty(window, name, {
        get: () => deadBugsnag,
        set() {},
        configurable: true,
      });
    });
  } catch (_) {}

  // ── 9. Push notification permission blocking ───────────────────────────────
  // Overrides Notification.requestPermission so ad/tracking scripts can never
  // prompt the user for push notification access. Returns 'denied' immediately.
  try {
    if ('Notification' in window) {
      Notification.requestPermission = function () {
        return Promise.resolve('denied');
      };
    }
  } catch (_) {}

  // ── 10. window.open popup blocker ─────────────────────────────────────────
  // Intercepts window.open calls and blocks those targeting known ad/popup
  // networks. Passes all other calls through unchanged so legitimate popups
  // (e.g. OAuth, payment flows) still work.
  try {
    const _origOpen = window.open.bind(window);
    const AD_POPUP_PATTERN = /doubleclick\.net|googlesyndication\.com|adnxs\.com|advertising\.com|popads\.net|popcash\.net|exoclick\.com|trafficjunky\.net|adcash\.com|propellerads\.com|ad\.fly|adf\.ly|linkbucks\.com|adfly\.com|clkmon\.com|clicksfly\.com|ouo\.io/i;
    window.open = function (url, target, features) {
      if (url && AD_POPUP_PATTERN.test(String(url))) return null;
      return _origOpen(url, target, features);
    };
  } catch (_) {}

})();
