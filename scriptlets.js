// ─── Adzooka — Scriptlets (MAIN world, document_start) ───────────────────────
// Runs in the page's own JS context before any page script executes.
// Kept minimal to avoid breaking sites. Network-level blocking (declarativeNetRequest)
// handles the heavy lifting; these are targeted surgical overrides only.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // Skip on Google-family domains — their page init depends on the real googletag/adsbygoogle.
  // youtube.com, youtu.be, googleapis.com, etc. all break if we noop these globals.
  const ON_GOOGLE = /\b(google|youtube|youtu|googleapis|googleusercontent|gstatic|ggpht)\.(com|be|[a-z]{2}|co\.[a-z]{2})$/.test(location.hostname);

  // ── Ad domain set (for popup/open blocking only) ───────────────────────────
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
      // Check parent domain (e.g. cdn.doubleclick.net)
      const parts = h.split('.');
      for (let i = 1; i < parts.length - 1; i++) {
        if (AD_HOSTS.has(parts.slice(i).join('.'))) return true;
      }
      return false;
    } catch (_) { return false; }
  }

  // ── 1. window.open — block popups to ad domains ────────────────────────────
  // Also blocks chrome-less popup windows (no toolbar/menubar = ad pattern).
  const _open = window.open;
  window.open = function (url, target, features) {
    const u = String(url || '');
    if (u && u !== 'about:blank' && isAdHost(u)) return null;
    if (features && /toolbar=(?:no|0)/i.test(features) && /menubar=(?:no|0)/i.test(features)) return null;
    return _open.apply(window, arguments);
  };

  // ── 2. googletag noop ─────────────────────────────────────────────────────
  // Neutralises Google Publisher Tag on third-party sites.
  // Skipped on google.com itself to avoid breaking search page init.
  if (!ON_GOOGLE) {
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

    // ── 3. adsbygoogle noop ───────────────────────────────────────────────────
    try {
      Object.defineProperty(window, 'adsbygoogle', {
        get: () => ({ push() {}, length: 0 }),
        set() {},
        configurable: true,
      });
    } catch (_) {}
  }

  // ── 3b. YouTube — strip ad placements from player bootstrap data ─────────
  // YouTube embeds all player config (including ad slots) in a global called
  // ytInitialPlayerResponse before any JS runs. We intercept the setter and
  // delete the ad-related keys so the player never schedules ads.
  if (location.hostname.includes('youtube.com')) {
    const _stripAds = obj => {
      if (!obj || typeof obj !== 'object') return obj;
      delete obj.adPlacements;
      delete obj.playerAds;
      delete obj.adSlots;
      if (Array.isArray(obj.adBreakHeartbeatParams)) obj.adBreakHeartbeatParams = [];
      return obj;
    };

    let _ytpr;
    try {
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        get: ()  => _ytpr,
        set: val => { _ytpr = _stripAds(val); },
        configurable: true,
      });
    } catch (_) {}

    // Some YouTube page variants use ytplayer.config instead
    let _ytplayer;
    try {
      Object.defineProperty(window, 'ytplayer', {
        get: () => _ytplayer,
        set: val => {
          if (val?.config?.args?.raw_player_response) {
            _stripAds(val.config.args.raw_player_response);
          }
          _ytplayer = val;
        },
        configurable: true,
      });
    } catch (_) {}
  }

  // ── 4. Header-bidding framework noops ─────────────────────────────────────
  // Prebid.js, Amazon TAM, Criteo — swallowed with a no-op proxy.
  const noopProxy = new Proxy({}, {
    get:       () => noopProxy,
    set:       () => true,
    apply:     () => {},
    construct: () => noopProxy,
  });
  ['pbjs', 'apstag', 'Criteo'].forEach(name => {
    try {
      if (window[name] === undefined) {
        Object.defineProperty(window, name, { get: () => noopProxy, set() {}, configurable: true });
      }
    } catch (_) {}
  });

  // ── 5. Notification permission — block auto-prompts ───────────────────────
  // Blocks Notification.requestPermission() unless the user has already
  // interacted with the page (click/keydown) — auto-prompts are an ad pattern.
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
