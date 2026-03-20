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

  // ── 10. window.open popup blocker (eyeo user-gesture approach) ────────────
  // Two-layer defence:
  //   a) Domain blocklist — always blocks known ad popup networks
  //   b) User-gesture timing — blocks any window.open that fires more than
  //      1 second after the last user interaction (ad scripts delay on purpose)
  // Mirrors the technique used in eyeo's webext-ad-filtering-solution.
  try {
    const _origOpen = window.open.bind(window);

    // Track last real user interaction (click, key, touch)
    let _lastGesture = 0;
    const _trackGesture = () => { _lastGesture = Date.now(); };
    document.addEventListener('mousedown', _trackGesture, true);
    document.addEventListener('click',     _trackGesture, true);
    document.addEventListener('keydown',   _trackGesture, true);
    document.addEventListener('touchend',  _trackGesture, true);

    const AD_POPUP_RE = /trafficjunky\.(net|com)|exoclick\.com|realsrv\.com|juicyads\.(com|me|net)|plugrush\.com|trafficfactory\.biz|trafficstars\.com|tsyndicate\.com|twinred\.com|popcash\.net|popads\.(net|com)|clickadu\.com|adxpansion\.com|ero-advertising\.com|adultforce\.com|propellerads\.com|adcash\.com|adf\.ly|linkbucks\.com|clkmon\.com|ouo\.io|shorte\.st|adfoc\.us|sh\.st|ceesty\.com|destyy\.com|cut-urls\.com/i;

    window.open = function (url, target, features) {
      const urlStr = String(url || '');

      // Always block known ad popup domains
      if (AD_POPUP_RE.test(urlStr)) return null;

      // Block any open that happens >1000 ms after last user gesture —
      // ad scripts intentionally delay their opens to evade simple blockers
      const msSinceGesture = Date.now() - _lastGesture;
      if (msSinceGesture > 1000 && urlStr && urlStr !== 'about:blank' && urlStr !== '') {
        return null;
      }

      return _origOpen(url, target, features);
    };
  } catch (_) {}

})();
