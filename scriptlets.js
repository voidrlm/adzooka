// ─── Adzooka — Scriptlets (MAIN world, document_start) ───────────────────────
(function () {
  'use strict';

  // Domains where our overrides break the site — bail out immediately.
  // Google/YouTube need real googletag. Spotify's SPA crashes on any noop.
  const EXEMPT = /\b(google|youtube|youtu|googleapis|googleusercontent|gstatic|ggpht|spotify|scdn|spotifycdn)\.(com|be|net|[a-z]{2}|co\.[a-z]{2})$/.test(location.hostname);
  if (EXEMPT) return;

  // ── Ad host check (used only for popup blocking) ───────────────────────────
  const AD_HOSTS = new Set([
    'doubleclick.net','googlesyndication.com','googleadservices.com',
    'adnxs.com','advertising.com','openx.net','rubiconproject.com',
    'pubmatic.com','criteo.com','media.net','exoclick.com',
    'trafficjunky.net','propellerads.com','popcash.net','popads.net',
    'adsterra.com','adcash.com','mgid.com','coinzilla.io',
    'coinhive.com','coin-hive.com','cryptoloot.pro','minero.cc',
    'juicyads.com','trafficfactory.biz','plugrush.com','hilltopads.net',
    'adnium.com','spotx.tv','freewheel.tv','innovid.com',
  ]);

  function isAdHost(url) {
    try {
      const h = new URL(url, location.href).hostname.toLowerCase();
      if (AD_HOSTS.has(h)) return true;
      const parts = h.split('.');
      for (let i = 1; i < parts.length - 1; i++) {
        if (AD_HOSTS.has(parts.slice(i).join('.'))) return true;
      }
      return false;
    } catch (_) { return false; }
  }

  // ── 1. window.open — block popups to ad domains ────────────────────────────
  const _open = window.open;
  window.open = function (url, target, features) {
    const u = String(url || '');
    if (u && u !== 'about:blank' && isAdHost(u)) return null;
    if (features && /toolbar=(?:no|0)/i.test(features) && /menubar=(?:no|0)/i.test(features)) return null;
    return _open.apply(window, arguments);
  };

  // ── 2. googletag noop ──────────────────────────────────────────────────────
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

  // ── 4. YouTube — strip ad placements from player bootstrap data ───────────
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
  }

  // ── 5. Prebid.js noop — call bidsBackHandler immediately with no bids ─────
  // A pure no-op causes sites to wait forever for the callback → error screens.
  if (window.pbjs === undefined) {
    try {
      const _pbjs = {
        que: [],
        requestBids({ bidsBackHandler } = {}) { try { bidsBackHandler?.(); } catch (_) {} },
        addAdUnits() {},
        setConfig()  {},
        getConfig:   () => ({}),
        adUnits:     [],
      };
      Object.defineProperty(window, 'pbjs', { get: () => _pbjs, set() {}, configurable: true });
    } catch (_) {}
  }

  // ── 6. Amazon TAM / Criteo noops ──────────────────────────────────────────
  const noopProxy = new Proxy({}, {
    get: () => noopProxy, set: () => true, apply: () => {}, construct: () => noopProxy,
  });
  ['apstag', 'Criteo'].forEach(name => {
    try {
      if (window[name] === undefined) {
        Object.defineProperty(window, name, { get: () => noopProxy, set() {}, configurable: true });
      }
    } catch (_) {}
  });

  // ── 7. Notification permission — block auto-prompts ───────────────────────
  let _interacted = false;
  ['click', 'keydown'].forEach(e =>
    document.addEventListener(e, () => { _interacted = true; }, { once: true, capture: true })
  );
  if (Notification?.requestPermission) {
    const _origNotif = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = function () {
      if (!_interacted) return Promise.resolve('denied');
      return _origNotif.apply(this, arguments);
    };
  }

})();
