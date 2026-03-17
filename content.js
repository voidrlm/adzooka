// ─── Adzooka — Content Script (ISOLATED world) ───────────────────────────────

(function () {
  "use strict";

  // ── Ad domains ────────────────────────────────────────────────────────────
  const AD_DOMAINS = [
    "doubleclick.net","googlesyndication.com","googleadservices.com",
    "adnxs.com","advertising.com","outbrain.com","taboola.com",
    "amazon-adsystem.com","criteo.com","openx.net","rubiconproject.com",
    "pubmatic.com","casalemedia.com","media.net","moatads.com",
    "smartadserver.com","exoclick.com","propellerads.com","popcash.net",
    "popads.net","trafficjunky.net","coinzilla.io","adcash.com",
    "adsterra.com","mgid.com","revcontent.com","adf.ly","linkbucks.com",
    "ouo.io","bc.vc","shorte.st","sh.st","adfoc.us","clkmon.com",
    "clkrev.com","spotxchange.com","springserve.com","freewheel.tv",
    "coinhive.com","coin-hive.com","minero.cc","cryptoloot.pro",
    "gumgum.com","indexww.com","sovrn.com","sharethrough.com",
    "flashtalking.com","valueclick.com","turn.com","zedo.com",
    "spotx.tv","innovid.com","adap.tv","inmobi.com","applovin.com",
    "strossle.com","zergnet.com","content.ad","teads.tv",
    "triplelift.com","33across.com","nativo.com","rhythmone.com",
    "adsrvr.org","bidswitch.net","bidr.io","scorecardresearch.com",
    "quantserve.com","addthis.com","sharethis.com","demdex.net",
    "bluekai.com","exelate.com","lotame.com","rlcdn.com","id5-sync.com",
    "everesttech.net","chartbeat.com","bat.bing.com","ads.twitter.com",
    "analytics.tiktok.com","ad.tiktok.com","pangle.io",
  ];

  // IAB standard display ad sizes [width, height]
  const IAB_AD_SIZES = [
    [728,90],[300,250],[160,600],[300,600],[320,50],[970,250],
    [468,60],[234,60],[120,600],[336,280],[300,1050],[970,90],
    [750,300],[750,100],[480,320],[320,480],[300,50],[320,100],
    [250,250],[200,200],[180,150],[125,125],[240,400],[980,120],
    [930,180],[250,360],[580,400],[320,480],[1024,768],
  ];
  const SIZE_TOLERANCE = 5; // px tolerance for size matching

  // Click redirect params
  const REDIRECT_PARAMS = [
    "redirect=http","redirect=//","redir=http","redir=//",
    "goto=http","goto=//","url=http","url=//","link=http","link=//",
    "out=http","out=//","click?url","clickthrough","clickout","clkout",
    "outclick","adclick","adredirect","aff_link","affiliate_link",
    "ad_redirect","ad_click","trackurl","track?url","trk?url",
    "visit?url","visit=http",
  ];

  const REDIRECT_WRAPPERS = [
    { host: "www.google.com",       param: "q"   },
    { host: "google.com",           param: "q"   },
    { host: "l.facebook.com",       param: "u"   },
    { host: "lm.facebook.com",      param: "u"   },
    { host: "out.reddit.com",       param: "url" },
    { host: "www.bing.com",         param: "url" },
    { host: "redirect.viglink.com", param: "u"   },
    { host: "exit.sc",              param: "url" },
    { host: "anon.to",              param: "u"   },
  ];

  // Anti-adblock overlay phrases
  const ANTI_ADBLOCK_TEXTS = [
    "disable your ad blocker","turn off your adblocker",
    "ad blocker detected","adblock detected",
    "we detected an ad blocker","you are using adblocking",
    "your ad blocker is on","disable adblock",
    "whitelist our site","allow ads on this site",
    "please support us by disabling","ad-free experience",
  ];

  const SAFE_TAGS = new Set([
    "html","body","head","header","nav","main","footer",
    "article","section","aside","h1","h2","h3","h4","h5","h6","p",
  ]);

  // ── Selector-based selectors ──────────────────────────────────────────────

  const COSMETIC_SELECTORS = [
    // Google / AdSense
    "ins.adsbygoogle",".adsbygoogle",
    "[data-ad-client]","[data-ad-slot]","[data-ad-unit-id]",
    "iframe[id^='google_ads_iframe']","iframe[id^='aswift_']",
    "div[id^='google_ads_']","div[id^='div-gpt-ad']",
    "[id^='div-gpt-ad']","[id*='_gpt_ad']",
    "[data-google-av-cxn]","[data-google-query-id]",

    // YouTube
    ".ytd-banner-promo-renderer",".ytd-promoted-sparkles-web-renderer",
    ".ytd-promoted-video-renderer",".ytd-ad-slot-renderer",
    ".ytd-in-feed-ad-layout-renderer","yt-mealbar-promo-renderer",
    "#masthead-ad","#player-ads",".ytp-ad-overlay-container",
    ".ytp-ad-text-overlay",".ytp-ad-module",".ytp-ad-image-overlay",
    ".ytp-ad-progress",".ytp-ad-progress-list",
    "ytd-action-companion-ad-renderer","ytd-display-ad-renderer",
    "ytd-statement-banner-renderer",

    // Google Search
    "#tads","#tadsb","#bottomads",".ads-ad","li.ads-ad",
    ".commercial-unit-desktop-top","[data-text-ad]",

    // Taboola
    ".trc_rbox_div",".trc_rbox",".taboola-widget",
    "#taboola-below-article-thumbnails",
    "#taboola-above-article-thumbnails",
    "#taboola-right-rail-thumbnails",
    "[id^='taboola-']","[class^='taboola-']",

    // Outbrain
    ".OUTBRAIN",".ob-widget",".ob-smartfeed-wrapper",
    ".ob-container","[data-widget-id^='AR_']","[id^='outbrain_']",

    // Criteo
    "[id^='criteo-']","[class*='criteo']",

    // Reddit
    "[data-promoted='true']",".promotedlink",".promoted-link",

    // Twitter/X
    "[data-testid='placementTracking']","[aria-label='Promoted Tweet']",

    // ARIA-labelled ad elements
    "[aria-label='Advertisement']","[aria-label='advertisement']",
    "[aria-label='Advertisements']","[aria-label='Sponsored']",
    "[aria-label='sponsored']","[aria-label='Sponsored content']",

    // Generic patterns
    "[id^='div-gpt-']","[id*='-dfp-']","[id*='_dfp_']",
    "[class*='dfp-ad']","[class*='gpt-ad']",
    "[id*='ad-container']","[class*='ad-container']",
    "[id*='ad-wrapper']","[class*='ad-wrapper']",
    "[id*='ad-slot']","[class*='ad-slot']",
    "[id*='ad-unit']","[class*='ad-unit']",
    "[id*='advert']","[class*='advert']",
    "[id*='advertisement']","[class*='advertisement']",
    "[id*='adsense']","[class*='adsense']",
    "[id*='ads-']","[class*='ads-wrapper']",
    "[id*='banner-ad']","[class*='banner-ad']",
    "[class*='ad-banner']","[id*='ad-banner']",
    "[class*='sponsored']","[id*='sponsored']",
    "[class*='sticky-ad']","[class*='float-ad']",
    "[class*='overlay-ad']","[class*='interstitial']",
    "[class*='popup-ad']","[class*='takeover-ad']",

    // Anti-adblock overlays
    ".adblock-notice",".adblock-overlay",".adblock-wall",
    ".ad-block-notice","[class*='adblock-']","[id*='adblock-']",
    "[class*='anti-adblock']","[class*='adblocker']",

    // Popup Maker
    ".pum-container",".pum-overlay",

    // Ad iframes from known networks
    "iframe[src*='doubleclick.net']","iframe[src*='googlesyndication.com']",
    "iframe[src*='adnxs.com']","iframe[src*='openx.net']",
    "iframe[src*='rubiconproject.com']","iframe[src*='pubmatic.com']",
    "iframe[src*='criteo.com']","iframe[src*='taboola.com']",
    "iframe[src*='outbrain.com']","iframe[src*='media.net']",
    "iframe[src*='exoclick.com']","iframe[src*='propellerads.com']",
    "iframe[src*='popcash.net']","iframe[src*='popads.net']",
    "iframe[src*='trafficjunky.net']","iframe[src*='adcash.com']",
    "iframe[src*='mgid.com']","iframe[src*='coinzilla.io']",
    "iframe[src*='adsterra.com']","iframe[src*='freewheel.tv']",
    "iframe[src*='spotx.tv']","iframe[src*='innovid.com']",
    "iframe[src*='amazon-adsystem.com']","iframe[src*='gumgum.com']",
    "iframe[src*='flashtalking.com']","iframe[src*='serving-sys.com']",

    // Tracking pixels
    "img[src*='doubleclick.net']","img[src*='googlesyndication.com']",
    "img[src*='scorecardresearch.com']","img[src*='quantserve.com']",
    "img[src*='facebook.com/tr']","img[src*='bat.bing.com']",
    "img[width='1'][height='1']","img[width='0'][height='0']",

    // Amazon native ads
    ".native-ads","iframe[src*='amazon-adsystem.com']",

    // Crypto miners
    "script[src*='coinhive.com']","script[src*='coin-hive.com']",
    "script[src*='cryptoloot.pro']","script[src*='minero.cc']",
  ].join(",");

  // ── Inject persistent <style> that can't be overridden by page CSS ────────
  // We add !important via a high-specificity injected stylesheet so ad
  // elements stay hidden even if the site tries to show them.

  function injectLiveStylesheet() {
    const existing = document.getElementById("__adzooka_css__");
    if (existing) return;
    const style = document.createElement("style");
    style.id = "__adzooka_css__";
    style.textContent = `
      /* Adzooka injected CSS */
      [id^="div-gpt-ad"],
      [id*="-dfp-"],[id*="_dfp_"],
      [class*="dfp-ad"],[class*="gpt-ad"],
      ins.adsbygoogle,.adsbygoogle,
      [data-ad-client],[data-ad-slot],
      iframe[src*="doubleclick.net"],
      iframe[src*="googlesyndication.com"],
      iframe[src*="amazon-adsystem.com"],
      iframe[src*="adnxs.com"],
      iframe[src*="openx.net"],
      iframe[src*="rubiconproject.com"],
      iframe[src*="pubmatic.com"],
      iframe[src*="criteo.com"],
      iframe[src*="taboola.com"],
      iframe[src*="outbrain.com"],
      iframe[src*="media.net"],
      iframe[src*="exoclick.com"],
      iframe[src*="propellerads.com"],
      #tads,#tadsb,#bottomads,.ads-ad,
      .OUTBRAIN,.ob-widget,
      [id^="taboola-"],[class^="taboola-"],
      .ytd-ad-slot-renderer,#masthead-ad,#player-ads,
      .ytp-ad-module,.ytp-ad-overlay-container,
      ytd-action-companion-ad-renderer,ytd-display-ad-renderer,
      [aria-label="Advertisement"],[aria-label="Sponsored"],
      img[width="1"][height="1"],img[width="0"][height="0"],
      .pum-container,.pum-overlay,
      .adblock-notice,.adblock-overlay,.adblock-wall,
      [class*="adblock-"],[id*="adblock-"] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
        height: 0 !important;
        max-height: 0 !important;
        overflow: hidden !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function isAdDomain(hostname) {
    if (!hostname) return false;
    hostname = hostname.toLowerCase();
    return AD_DOMAINS.some(d => hostname === d || hostname.endsWith("." + d));
  }

  function isAdUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    if (REDIRECT_PARAMS.some(p => lower.includes(p))) return true;
    try {
      return isAdDomain(new URL(url, location.href).hostname);
    } catch (_) { return false; }
  }

  function isSafeTag(el) {
    return SAFE_TAGS.has(el.tagName?.toLowerCase());
  }

  function isAdSize(width, height) {
    return IAB_AD_SIZES.some(([w, h]) =>
      Math.abs(width - w) <= SIZE_TOLERANCE &&
      Math.abs(height - h) <= SIZE_TOLERANCE
    );
  }

  // ── 1. Selector-based removal ─────────────────────────────────────────────

  function removeBySelectors(root = document) {
    let count = 0;
    try {
      const els = root.querySelectorAll(COSMETIC_SELECTORS);
      for (const el of els) {
        if (!isSafeTag(el)) { el.remove(); count++; }
      }
    } catch (_) {}
    return count;
  }

  // ── 2. Heuristic: third-party iframes at IAB ad sizes ────────────────────

  function removeThirdPartyAdIframes(root = document) {
    let count = 0;
    const pageHost = location.hostname;
    try {
      const iframes = root.querySelectorAll("iframe");
      for (const fr of iframes) {
        let srcHost = "";
        try { srcHost = new URL(fr.src || fr.getAttribute("src") || "").hostname; }
        catch (_) {}

        // Must be cross-origin
        if (!srcHost || srcHost === pageHost || srcHost.endsWith("." + pageHost)) continue;

        // Check declared width/height attributes first (fast path)
        const attrW = parseInt(fr.width  || fr.getAttribute("width")  || "0", 10);
        const attrH = parseInt(fr.height || fr.getAttribute("height") || "0", 10);
        if (attrW > 0 && attrH > 0 && isAdSize(attrW, attrH)) {
          fr.remove(); count++; continue;
        }

        // Check computed size (slower but catches CSS-sized iframes)
        const rect = fr.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && isAdSize(rect.width, rect.height)) {
          fr.remove(); count++;
        }
      }
    } catch (_) {}
    return count;
  }

  // ── 3. Heuristic: elements with IAB ad sizes from ad-like parents ─────────
  // Catches divs that wrap iframes/images of ad dimensions.

  function removeHeuristicAdElements(root = document) {
    let count = 0;
    try {
      // Target divs/spans with width/height attributes matching IAB sizes
      const candidates = root.querySelectorAll(
        "div[style*='width'],div[style*='height']," +
        "div[width],div[height],span[width],span[height]"
      );
      for (const el of candidates) {
        if (isSafeTag(el)) continue;

        // Check style attribute
        const style = el.getAttribute("style") || "";
        const wMatch = style.match(/width\s*:\s*(\d+)px/);
        const hMatch = style.match(/height\s*:\s*(\d+)px/);
        if (wMatch && hMatch) {
          const w = parseInt(wMatch[1], 10);
          const h = parseInt(hMatch[1], 10);
          if (isAdSize(w, h)) {
            // Extra check: must contain an iframe or have ad-related content
            const hasAdChild = el.querySelector("iframe, [class*='ad'], [id*='ad']");
            if (hasAdChild) { el.remove(); count++; continue; }
          }
        }

        // Check width/height attributes
        const attrW = parseInt(el.getAttribute("width") || "0", 10);
        const attrH = parseInt(el.getAttribute("height") || "0", 10);
        if (attrW > 0 && attrH > 0 && isAdSize(attrW, attrH)) {
          const hasAdChild = el.querySelector("iframe");
          if (hasAdChild) { el.remove(); count++; }
        }
      }
    } catch (_) {}
    return count;
  }

  // ── 4. Anti-adblock overlay bypass ───────────────────────────────────────

  function removeAntiAdblockOverlays(root = document) {
    let count = 0;
    try {
      const els = root.querySelectorAll(
        ".adblock-notice,.adblock-overlay,.adblock-wall,.ad-block-notice," +
        "[class*='adblock-'],[id*='adblock-'],[class*='anti-adblock']," +
        "[class*='adblocker'],[id*='adblocker']"
      );
      for (const el of els) { el.remove(); count++; }
    } catch (_) {}

    // Scan large fixed/absolute overlays for anti-adblock text
    try {
      const fixed = root.querySelectorAll(
        "[style*='position:fixed'],[style*='position: fixed']," +
        "[style*='position:absolute'],[style*='position: absolute']"
      );
      for (const el of fixed) {
        if (isSafeTag(el)) continue;
        const computed = window.getComputedStyle(el);
        const z = parseInt(computed.zIndex, 10);
        if (z < 100) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < window.innerWidth * 0.5) continue;
        const text = (el.textContent || "").toLowerCase();
        if (ANTI_ADBLOCK_TEXTS.some(t => text.includes(t))) {
          el.remove(); count++;
        }
      }
    } catch (_) {}

    // Restore scroll lock
    try {
      if (document.body?.style.overflow === "hidden") document.body.style.overflow = "";
    } catch (_) {}

    return count;
  }

  // ── 5. Sticky banner ad removal ───────────────────────────────────────────

  function removeStickyAdBanners() {
    try {
      const all = document.querySelectorAll("*");
      for (const el of all) {
        if (isSafeTag(el)) continue;
        const s = window.getComputedStyle(el);
        if (s.position !== "fixed" && s.position !== "sticky") continue;
        const hint = (el.id + " " + el.className).toLowerCase();
        if (!/ad|banner|sponsor|promo|advert/.test(hint)) continue;
        const rect = el.getBoundingClientRect();
        const isBar = rect.width > window.innerWidth * 0.4 && rect.height < 250;
        if (isBar) el.remove();
      }
    } catch (_) {}
  }

  // ── 6. Collapse empty ad slot divs ───────────────────────────────────────
  // After network blocking, GPT slot divs are empty. Hide them.

  function collapseEmptyAdSlots(root = document) {
    try {
      const slots = root.querySelectorAll(
        "[id^='div-gpt-ad'],[id*='-dfp-'],[class*='gpt-ad'],[class*='dfp-ad']," +
        "[class*='ad-slot'],[class*='ad-container'],[class*='ad-wrapper']"
      );
      for (const el of slots) {
        if (el.children.length === 0 && !(el.textContent || "").trim()) {
          el.style.setProperty("display", "none", "important");
        }
      }
    } catch (_) {}
  }

  // ── 7. Block meta refresh redirects ──────────────────────────────────────

  function blockMetaRedirects() {
    const metas = document.querySelectorAll('meta[http-equiv="refresh"],meta[http-equiv="Refresh"]');
    for (const meta of metas) {
      const match = (meta.getAttribute("content") || "").match(/url\s*=\s*(.+)/i);
      if (match) {
        const url = match[1].trim().replace(/['"]/g, "");
        if (isAdUrl(url)) meta.remove();
      }
    }
  }

  // ── 8. Link unwrapping ────────────────────────────────────────────────────

  function unwrapLinks(root = document) {
    try {
      const anchors = root.querySelectorAll("a[href]");
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        try {
          const url = new URL(href, location.href);
          for (const { host, param } of REDIRECT_WRAPPERS) {
            if (url.hostname === host && param) {
              const dest = url.searchParams.get(param);
              if (dest && /^https?:\/\//.test(dest)) {
                a.setAttribute("href", dest);
                a.removeAttribute("onclick");
                break;
              }
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  // ── Click / mousedown redirect interception ───────────────────────────────

  function blockIfAdLink(e) {
    const anchor = e.target.closest("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href") || "";
    if (isAdUrl(href)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
  document.addEventListener("mousedown", blockIfAdLink, true);
  document.addEventListener("click",     blockIfAdLink, true);
  document.addEventListener("auxclick",  blockIfAdLink, true);

  // ── window.open backup (isolated world) ──────────────────────────────────
  const _origOpen = window.open;
  window.open = function (url, target, features) {
    const u = String(url || "");
    if (u && u !== "about:blank" && isAdUrl(u)) return null;
    return _origOpen?.call(window, url, target, features);
  };

  // ── Master run ────────────────────────────────────────────────────────────

  function runAll() {
    injectLiveStylesheet();
    const c1 = removeBySelectors();
    const c2 = removeThirdPartyAdIframes();
    const c3 = removeHeuristicAdElements();
    const c4 = removeAntiAdblockOverlays();
    removeStickyAdBanners();
    collapseEmptyAdSlots();
    const total = c1 + c2 + c3 + c4;
    if (total > 0) {
      chrome.runtime.sendMessage({ type: "CONTENT_BLOCKED", count: total }).catch(() => {});
    }
  }

  // ── MutationObserver — no debounce for critical first pass ───────────────

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    // Use microtask for near-instant response
    Promise.resolve().then(() => {
      scheduled = false;
      runAll();
    });
  });

  function startObserver() {
    observer.observe(document.documentElement, {
      childList: true, subtree: true,
    });
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  // Run immediately (document_start)
  injectLiveStylesheet();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      runAll();
      blockMetaRedirects();
      unwrapLinks();
      startObserver();
    });
  } else {
    runAll();
    blockMetaRedirects();
    unwrapLinks();
    startObserver();
  }

  // Extra passes: 500ms and 3s after load for lazy-loaded / lazy-rendered ads
  window.addEventListener("load", () => {
    runAll();
    setTimeout(runAll, 500);
    setTimeout(runAll, 3000);
  });

})();
