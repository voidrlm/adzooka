// ─── Adzooka — Scriptlets (MAIN world / page context) ─────────────────
// Runs at document_start in the page's own JS context.
// This lets us override browser APIs before ad scripts execute.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  "use strict";

  // ── Comprehensive ad / tracker domain list ────────────────────────────────
  const AD_DOMAINS = new Set([
    "doubleclick.net","googlesyndication.com","googleadservices.com",
    "adnxs.com","advertising.com","outbrain.com","taboola.com",
    "amazon-adsystem.com","criteo.com","criteo.net","openx.net",
    "rubiconproject.com","pubmatic.com","casalemedia.com","media.net",
    "moatads.com","adsafeprotected.com","doubleverify.com",
    "indexww.com","sovrn.com","lijit.com","triplelift.com",
    "sharethrough.com","33across.com","nativo.com","contextweb.com",
    "conversantmedia.com","yieldmanager.com","yieldmanager.net",
    "teads.tv","adform.net","rhythmone.com","emxdgt.com",
    "districtm.io","adtelligent.com","yumenetworks.com",
    "smartadserver.com","undertone.com","flashtalking.com",
    "valueclick.com","zedo.com","adtech.de","adsrvr.org",
    "bidswitch.net","bidr.io","buzzoola.com","mopub.com",
    "quantserve.com","scorecardresearch.com","exelate.com",
    "bluekai.com","demdex.net","addthis.com","sharethis.com",
    "lotame.com","acuityads.com","rlcdn.com","liadm.com",
    "everesttech.net","cxense.com","kruxdigital.com","mathtag.com",
    "id5-sync.com","prebid.a-mo.net","gumgum.com",
    "coinhive.com","coin-hive.com","minero.cc","webmine.pro",
    "cryptoloot.pro","jsecoin.com","authedmine.com","monerominer.rocks",
    "ppoi.org","afminer.com","listat.biz","lmodr.biz","hashing.win",
    "adf.ly","linkbucks.com","ouo.io","bc.vc","shorte.st",
    "sh.st","adfoc.us","exe.io","fc.lc","adfly.com","cutwin.com",
    "celinks.net","clkmon.com","clkrev.com","reachjunction.com",
    "bestpopads.net","popunder.ru","adcash.com","adsterra.com",
    "propellerads.com","popcash.net","popads.net","exoclick.com",
    "trafficjunky.net","coinzilla.io","mgid.com","clicksor.com",
    "revcontent.com","mediamath.com","dataxu.com","turn.com",
    "freewheel.tv","springserve.com","spotxchange.com","spotx.tv",
    "tremorvideo.com","tremor.com","innovid.com","adap.tv",
    "inmobi.com","applovin.com","vungle.com","ironsrc.com",
    "millennial-media.com","tapjoy.com","leadbolt.net","mobvista.com",
    "inneractive.com","mobfox.com","pangle.io","chartboost.com",
    "airpush.com","jumptap.com","aarki.com","supersonic.com",
    "ads.twitter.com","static.ads-twitter.com","analytics.twitter.com",
    "ads.linkedin.com","snap.licdn.com","ad.tiktok.com",
    "analytics.tiktok.com","pixel.facebook.com","bat.bing.com",
    "widespace.com","justpremium.com","strossle.com","zergnet.com",
    "content.ad","adblade.com","smartclip.net","appier.com",
    "adbrite.com","bannersnack.com","steelhousemedia.com",
    "realmedia.com","appsflyer.com","kochava.com","tune.com",
  ]);

  // Common redirect/tracking URL parameters
  const REDIRECT_PARAMS = [
    "adclick","ad_click","clickthrough","click_through",
    "adredirect","ad_redirect","redirect_to","redir_to",
    "aff_link","affiliate_link","clkout","outclick",
  ];

  // ── Helpers ───────────────────────────────────────────────────────────────

  function isAdDomain(url) {
    if (!url || typeof url !== "string") return false;
    try {
      const hostname = new URL(url, location.href).hostname.toLowerCase();
      if (AD_DOMAINS.has(hostname)) return true;
      // Check parent domains (e.g. "cdn.doubleclick.net")
      const parts = hostname.split(".");
      for (let i = 1; i < parts.length - 1; i++) {
        if (AD_DOMAINS.has(parts.slice(i).join("."))) return true;
      }
      return false;
    } catch (_) { return false; }
  }

  function isAdUrl(url) {
    if (!url || typeof url !== "string") return false;
    if (isAdDomain(url)) return true;
    // Also catch redirect param patterns
    const lower = url.toLowerCase();
    return REDIRECT_PARAMS.some(p => lower.includes(p));
  }

  // Features string that suggests a popup ad window (toolbar=no, tiny size, etc.)
  function isAdPopupFeatures(features) {
    if (!features) return false;
    const f = features.toLowerCase().replace(/\s/g, "");
    if ((f.includes("toolbar=no") || f.includes("toolbar=0")) &&
        (f.includes("menubar=no") || f.includes("menubar=0")) &&
        (f.includes("scrollbars=no") || f.includes("scrollbars=0"))) {
      return true;
    }
    return false;
  }

  // ── 1. Aggressive window.open() interception ──────────────────────────────
  const _origOpen = window.open;
  window.open = function (url, target, features) {
    const resolvedUrl = url ? String(url) : "";

    // Always allow about:blank (used by legit SPAs, OAuth flows)
    if (!resolvedUrl || resolvedUrl === "about:blank") {
      return _origOpen.call(window, url, target, features);
    }

    // Block ad domain opens
    if (isAdDomain(resolvedUrl)) {
      console.debug("[Adzooka] Blocked window.open (ad domain):", resolvedUrl);
      return null;
    }

    // Block opens that use popup ad feature strings (even without ad URL)
    if (isAdPopupFeatures(features)) {
      console.debug("[Adzooka] Blocked window.open (ad features):", resolvedUrl);
      return null;
    }

    // Block blank-target opens from within known ad containers
    // (heuristic: small window or no toolbar when coming from ad context)
    if (target === "_blank" && features && isAdUrl(resolvedUrl)) {
      return null;
    }

    return _origOpen.call(window, url, target, features);
  };

  // Freeze our override so ad scripts can't restore the original
  const _patchedOpen = window.open;
  try {
    Object.defineProperty(window, "open", {
      get: () => _patchedOpen,
      set: () => {
        console.debug("[Adzooka] Blocked reassignment of window.open");
      },
      configurable: false,
    });
  } catch (_) {}

  // ── 2. document.write / document.writeln interception ─────────────────────
  // Ad networks love injecting via document.write to bypass CSP.
  const _origWrite   = Document.prototype.write;
  const _origWriteln = Document.prototype.writeln;

  function containsAdMarkup(html) {
    const lower = String(html).toLowerCase();
    // Check for ad domain references in the markup
    for (const domain of AD_DOMAINS) {
      if (lower.includes(domain)) return true;
    }
    // Check for common ad script patterns
    if (lower.includes("adsense") || lower.includes("adsbygoogle") ||
        lower.includes("doubleclick") || lower.includes("googlesyndication")) {
      return true;
    }
    return false;
  }

  Document.prototype.write = function (...args) {
    const html = args.join("");
    if (containsAdMarkup(html)) {
      console.debug("[Adzooka] Blocked document.write (ad content)");
      return;
    }
    return _origWrite.apply(this, args);
  };

  Document.prototype.writeln = function (...args) {
    const html = args.join("");
    if (containsAdMarkup(html)) {
      console.debug("[Adzooka] Blocked document.writeln (ad content)");
      return;
    }
    return _origWriteln.apply(this, args);
  };

  // ── 3. fetch() interception ───────────────────────────────────────────────
  const _origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input :
                (input instanceof Request ? input.url : String(input));
    if (isAdDomain(url)) {
      console.debug("[Adzooka] Blocked fetch:", url);
      return Promise.reject(new TypeError("Adzooka: blocked ad request"));
    }
    return _origFetch.apply(window, arguments);
  };

  // ── 4. XMLHttpRequest interception ────────────────────────────────────────
  const _origXhrOpen = XMLHttpRequest.prototype.open;
  const _origXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    const blockedFlag = isAdDomain(String(url || ""));
    if (blockedFlag) {
      console.debug("[Adzooka] Blocked XHR:", url);
      // Mark this instance; don't throw yet (send() will silently no-op)
      Object.defineProperty(this, "_ubr_blocked", { value: true, writable: false });
    }
    return _origXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    if (this._ubr_blocked) return; // silently drop
    return _origXhrSend.apply(this, arguments);
  };

  // ── 5. navigator.sendBeacon interception ──────────────────────────────────
  if (navigator.sendBeacon) {
    const _origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      if (isAdDomain(String(url || ""))) {
        console.debug("[Adzooka] Blocked sendBeacon:", url);
        return true; // pretend success to avoid site errors
      }
      return _origBeacon(url, data);
    };
  }

  // ── 6. Nullify / intercept ad framework globals ───────────────────────────
  // We use lazy defineProperty so we don't break sites that legitimately
  // check for these (e.g. consent flows), but we no-op the calls.

  function noopAdGlobal(name) {
    const noop = () => {};
    const noopObj = new Proxy({}, {
      get: () => noopObj,
      set: () => true,
      apply: () => {},
      construct: () => noopObj,
    });

    if (window[name] === undefined) {
      try {
        Object.defineProperty(window, name, {
          get: () => noopObj,
          set: () => {},   // absorb attempts to initialise it
          configurable: true,
        });
      } catch (_) {}
    }
  }

  // Prebid.js — header bidding framework used by ad networks
  noopAdGlobal("pbjs");
  // Amazon Publisher Services TAM
  noopAdGlobal("apstag");
  // Criteo
  noopAdGlobal("Criteo");

  // googletag (Google Publisher Tag / DFP) — intercept cmd queue
  if (!window.googletag || !window.googletag._ubrPatched) {
    const cmdQueue = [];
    const fakeGoogletag = {
      _ubrPatched: true,
      cmd: {
        push: (fn) => { /* intentionally dropped */ },
      },
      defineSlot: () => fakeGoogletag,
      defineOutOfPageSlot: () => fakeGoogletag,
      pubads: () => ({
        enableSingleRequest: () => {},
        collapseEmptyDivs: () => {},
        disableInitialLoad: () => {},
        addEventListener: () => {},
        refresh: () => {},
        setTargeting: () => {},
        setRequestNonPersonalizedAds: () => {},
      }),
      enableServices: () => {},
      display: () => {},
      destroySlots: () => true,
    };
    try {
      Object.defineProperty(window, "googletag", {
        get: () => fakeGoogletag,
        set: () => {},
        configurable: false,
      });
    } catch (_) {}
  }

  // adsbygoogle push — silently swallow ad push calls
  (function interceptAdsByGoogle() {
    const existing = window.adsbygoogle;
    const fakeArr = {
      push: () => {},
      length: 0,
    };
    try {
      Object.defineProperty(window, "adsbygoogle", {
        get: () => fakeArr,
        set: () => {},
        configurable: false,
      });
    } catch (_) {
      // If already defined and frozen, wrap the push method
      if (existing && typeof existing.push === "function") {
        existing.push = () => {};
      }
    }
  })();

  // ── 7. setTimeout / setInterval popup abuse prevention ───────────────────
  // Some sites use delayed window.open calls. We patch the timers but only
  // inspect string-form callbacks (eval-style), not function refs.
  const _origSetTimeout  = window.setTimeout;
  const _origSetInterval = window.setInterval;

  const popupPattern = /window\s*\.\s*open\s*\(|location\s*\.(?:href|assign|replace)\s*=/;

  function isAdTimerCode(code) {
    if (typeof code !== "string") return false;
    if (!popupPattern.test(code)) return false;
    return AD_DOMAINS.has([...AD_DOMAINS].find(d => code.includes(d)) || "");
  }

  window.setTimeout = function (fn, delay, ...args) {
    if (isAdTimerCode(fn)) {
      console.debug("[Adzooka] Blocked setTimeout with ad popup code");
      return 0;
    }
    return _origSetTimeout.call(window, fn, delay, ...args);
  };

  window.setInterval = function (fn, delay, ...args) {
    if (isAdTimerCode(fn)) {
      console.debug("[Adzooka] Blocked setInterval with ad popup code");
      return 0;
    }
    return _origSetInterval.call(window, fn, delay, ...args);
  };

  // ── 8. Prevent window.location redirect hijacking ────────────────────────
  // Some ad scripts set window.location.href directly.
  // We intercept the setter and block redirects to ad domains.
  const _locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
  if (_locationDescriptor && !_locationDescriptor.set) {
    // location.href setter
    const hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, "href");
    if (hrefDesc && hrefDesc.set) {
      const _origHrefSet = hrefDesc.set;
      Object.defineProperty(Location.prototype, "href", {
        get: hrefDesc.get,
        set(url) {
          if (isAdDomain(String(url || ""))) {
            console.debug("[Adzooka] Blocked location.href redirect:", url);
            return;
          }
          return _origHrefSet.call(this, url);
        },
        configurable: true,
      });
    }
  }

  // ── 9. Notification permission blocking from ad contexts ──────────────────
  // Block push notification permission requests initiated by ad scripts.
  // We heuristically detect if Notification.requestPermission is called
  // immediately on page load (common ad/spam pattern).
  const _origNotifReq = Notification.requestPermission?.bind(Notification);
  if (_origNotifReq) {
    let pageInteracted = false;
    document.addEventListener("click", () => { pageInteracted = true; }, { once: true, capture: true });
    document.addEventListener("keydown", () => { pageInteracted = true; }, { once: true, capture: true });

    Notification.requestPermission = function (...args) {
      if (!pageInteracted) {
        console.debug("[Adzooka] Blocked Notification.requestPermission (no user gesture)");
        return Promise.resolve("denied");
      }
      return _origNotifReq(...args);
    };
  }

  // ── 10. WebSocket interception (crypto miners) ────────────────────────────
  const _origWebSocket = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    if (isAdDomain(String(url || ""))) {
      console.debug("[Adzooka] Blocked WebSocket:", url);
      // Return a dead socket that never connects
      const fake = Object.create(WebSocket.prototype);
      fake.readyState = WebSocket.CLOSED;
      fake.send = () => {};
      fake.close = () => {};
      return fake;
    }
    return new _origWebSocket(url, protocols);
  };
  window.WebSocket.prototype = _origWebSocket.prototype;
  window.WebSocket.CONNECTING = _origWebSocket.CONNECTING;
  window.WebSocket.OPEN       = _origWebSocket.OPEN;
  window.WebSocket.CLOSING    = _origWebSocket.CLOSING;
  window.WebSocket.CLOSED     = _origWebSocket.CLOSED;

  // ── 11. Anti-adblock detection bypass ────────────────────────────────────
  // Some sites poll for the existence of ad-related elements or globals
  // to detect ad blockers. We create dummy bait elements/globals.

  // Fake a functioning adsbygoogle element (bait for adblock detectors)
  const baitEl = document.createElement("div");
  baitEl.className = "adsbygoogle";
  baitEl.style.cssText = "position:absolute;top:-9999px;left:-9999px;width:1px;height:1px;";
  // Only append when DOM is ready
  if (document.body) {
    document.body.appendChild(baitEl);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      document.body?.appendChild(baitEl);
    }, { once: true });
  }

  // ── 12. iframe creation interception ─────────────────────────────────────
  // Block dynamically created iframes pointing to ad domains.
  const _origCreateElement = Document.prototype.createElement;
  Document.prototype.createElement = function (tagName, options) {
    const el = _origCreateElement.call(this, tagName, options);
    if (String(tagName).toLowerCase() === "iframe") {
      const _srcDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
      // Observe src being set
      Object.defineProperty(el, "src", {
        get: _srcDescriptor ? _srcDescriptor.get : undefined,
        set(url) {
          if (isAdDomain(String(url || ""))) {
            console.debug("[Adzooka] Blocked iframe src:", url);
            // Set to blank instead of ad URL
            if (_srcDescriptor?.set) _srcDescriptor.set.call(el, "about:blank");
            return;
          }
          if (_srcDescriptor?.set) _srcDescriptor.set.call(el, url);
        },
        configurable: true,
      });
    }
    return el;
  };

})();
