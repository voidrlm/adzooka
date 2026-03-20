// Adzooka — General Content Script (all sites, document_start)
//
// Element-hiding approach ported from eyeo's webext-ad-filtering-solution:
//  1. Inject a <style> tag early into the page (catches elements before paint)
//  2. Use style.setProperty('display','none','important') on found nodes —
//     more resilient than .remove() since SPAs re-add removed nodes
//  3. requestIdleCallback scheduler — never blocks the main thread
//  4. Throttled MutationObserver watching childList + attributes on full doc
//  5. Iframe/image collapsing for frames that load blocked ad domains
(function () {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.runtime) return;

  // YouTube and Spotify have their own dedicated content.js
  const host = location.hostname;
  if (host.includes('youtube.com') || host.includes('spotify.com')) return;

  // ── Ad selectors ──────────────────────────────────────────────────────────
  // Mirrors cosmetic.css so the JS hider covers the same surface.
  // Kept as an array so we can join them efficiently.
  const AD_SELECTORS = [
    // Generic classes
    '.ad','.ads','.adv','.ad-block','.ad-box','.ad-container','.ad-slot',
    '.ad-unit','.ad-wrapper','.ad-banner','.ad-content','.ad-footer',
    '.ad-frame','.ad-header','.ad-holder','.ad-leaderboard','.ad-left',
    '.ad-placement','.ad-right','.ad-row','.ad-section','.ad-sidebar',
    '.ad-space','.ad-tag','.ad-text','.ad-top','.ad-tower','.ad-zone',
    '.ads-bar','.ads-container','.ads-inner','.ads-section','.ads-slot',
    '.ads-widget','.ads-wrapper',
    '#ad','#ads','#adv','#ad-box','#ad-container','#ad-slot','#ad-unit',
    '#ad-wrapper','#ad-space',
    '.adarea','.adbar','.adbanner','.adbox','.adcontainer','.adcontent',
    '.adframe','.adholder','.adimage','.adinner','.adlabel','.adplace',
    '.adrow','.adsbox','.adsense','.adset','.adside','.adsidebar',
    '.adslot','.adspace','.adspot','.adtag','.adtext','.adtile',
    '.adtop','.adunit','.adwrap','.adwrapper','.adzone',
    '#adbox','#adspace','#adunit','#adplace','#adsensecontainer',
    '.advert','.adverts','.advertise','.advertisement','.advertisements',
    '.advertbox','.advertorial','.adview',
    '#advert','#adverts','#advertisement','#advertorial',
    '.banner-ad','.banner_ad','.bannerads','.banner_ads',
    '.block-ad','.block_ad','.bottomad','.bottomads',
    '.display-ad','.dfp-ad','.dfp-unit','.div-gpt-ad',
    '.footer-ad','.footer_ad',
    '.google-ad','.google_ad','.google-ads','.google_ads',
    '.googleAd','.googleads',
    '.header-ad','.header_ad',
    '.horizontal-ad','.horizontal_ad',
    '.inarticle-ad','.inline-ad','.inline_ad','.inside-ad',
    '.interstitial-ad','.interstitial-container',
    '#interstitial-ad',
    '.leader-ad','.leaderboard-ad','.leaderboard_ad',
    '.medium-rectangle','.middle-ad','.middle_ad',
    '.module-ad','.module_ad','.mpu','.mpu-ad','.mpu_ad',
    '.native-ad','.native_ad','.nativead',
    '.outstream-ad','.page-ad','.page_ad','.paid-content',
    '.partner-ad','.partner_ad','.post-ad','.post_ad',
    '.promo-ad','.promo_ad','.rectangle-ad','.responsive-ad',
    '.right-ad','.right_ad','.rhs-ad','#rhs-ad',
    '.sidebar-ad','.sidebar_ad','.site-ad','.site_ad',
    '.skyscraper','.skyscraper-ad',
    '.slot-ad','.slot_ad',
    '.sponsor-ad','.sponsor_ad','.sponsor-area','.sponsor-block',
    '.sponsor-box','.sponsor-content','.sponsor-label','.sponsor-link',
    '.sponsored','.Sponsored','.sponsored-ad','.sponsored_ad',
    '.sponsored-area','.sponsored-block','.sponsored-container',
    '.sponsored-content','.sponsored-item','.sponsored-label',
    '.sponsored-link','.sponsored-links','.sponsored-post',
    '.sponsored-result','.sponsored-widget',
    '.sponsoredbadge','.sponsoredby','.sponsoredcontent',
    '#sponsored','#sponsored-content','#sponsoredLinks',
    '.sticky-ad','.sticky_ad',
    '.text-ad','.text_ad','.textad','.textads','.text-ads',
    '#text-ads',
    '.top-ad','.top_ad','.topads',
    '#top-ad','#topads','#bottomads',
    '.tower-ad','.under-ad','.vertical-ad','.wide-ad',
    // Google Adsense / GPT
    '.adsbygoogle','ins.adsbygoogle',
    '[data-ad-client]','[data-ad-slot]','[data-ad-unit-id]',
    '[data-google-query-id]',
    'div[id^="google_ads_"]','div[id^="google_vignette"]',
    'iframe[id^="google_ads_iframe"]','iframe[id^="aswift_"]',
    '[id^="div-gpt-ad"]','[id^="ad-slot-"]','[id^="ad_slot_"]',
    '#tads','#tadsb','#tads-b','#bottomads','#topads',
    '#google-ads','.google-ads-container',
    // YouTube
    '#masthead-ad','#player-ads','.ytd-ad-slot-renderer',
    '.ytd-in-feed-ad-layout-renderer','.ytd-promoted-video-renderer',
    '.ytd-promoted-sparkles-web-renderer','.ytd-banner-promo-renderer',
    'ytd-action-companion-ad-renderer','ytd-display-ad-renderer',
    'ytd-statement-banner-renderer','yt-mealbar-promo-renderer',
    '.ytp-ad-module','.ytp-ad-overlay-container','.ytp-ad-text-overlay',
    '.ytp-ad-progress','.ytp-ad-progress-list',
    // Facebook / Meta
    '[aria-label="Sponsored"][role="link"]',
    // Reddit
    '[data-promoted="true"]','shreddit-ad-post',
    'div[data-testid*="promoted"]','.promotedlink',
    // Taboola / Outbrain
    '[id^="taboola-"]','.trc_rbox_div','.trc_related_container',
    '[id^="outbrain_"]','.OUTBRAIN','.ob-widget','.ob-smartfeed-wrapper',
    '[id^="cto_"]',
    // Criteo
    '.criteo-widget','[id^="criteo_"]','#criteo-placeholder',
    // BuySellAds / Carbon
    '#carbonads','.carbon-wrap','.carbonads',
    '[id^="bsa_zone_"]','.bsa_it',
    // Yandex
    '[id^="yandex_rtb_"]','.yandex-ad','[id^="Ya_"]','#yandex_ad',
    // Media.net / MGID / Zergnet
    '[id^="mn_"]','[id^="media_net_"]',
    '.mgid-container','[id^="mgid_container"]','[id^="mgid-"]',
    '.zergnet-widget','#zergnet',
    // Popups / overlays
    '#popup-ad','#ad-popup','#adPopup','#adOverlay','#ad-overlay',
    '.popup-ad','.ad-popup-wrapper','.ad-popup','.popup-ad-container',
    '[id*="popup-overlay"]','[id*="ad-overlay"]','.overlay-ad',
    '.ad-overlay','.modal-ad','.ad-modal','.lightbox-ad','#lightbox-ad',
    '#newsletter-popup','.newsletter-popup',
    // Sticky / floating
    '[class*="sticky-ad"]','[class*="ad-sticky"]','[id*="sticky-ad"]',
    '.ads-sticky-banner','div[class*="float-ad"]','div[id*="float-ad"]',
    '.fixed-ad','#fixed-ad','[class*="fixed-ad"]',
    '.adhesion-ad','.adhesion-unit','.ad-adhesion','.ad-anchor',
    '#adhesion-ad',
  ];

  // Known ad iframe/image src patterns — used for frame collapsing
  const AD_FRAME_PATTERN = /doubleclick\.net|googlesyndication\.com|adnxs\.com|advertising\.com|adservice\.google|pagead2\.|moatads\.com|rubiconproject\.com|openx\.net|appnexus\.com|criteo\.(com|net)|outbrain\.com|taboola\.com|revcontent\.com|mgid\.com|adsrvr\.org|adgrx\.com|medianet\.com|yieldmanager\.com|spotxchange\.com|sharethrough\.com|33across\.com/i;

  // Joined selector string (computed once)
  const SEL = AD_SELECTORS.join(',');

  // ── 1. Inject <style> into page head (eyeo approach) ─────────────────────
  // Runs immediately at document_start — catches elements before first paint.
  function injectStyleTag() {
    try {
      if (document.getElementById('_adzooka_hide')) return;
      const style = document.createElement('style');
      style.id = '_adzooka_hide';
      style.textContent = AD_SELECTORS.join(',') + '{display:none!important}';
      (document.head || document.documentElement).appendChild(style);
    } catch (_) {}
  }

  // ── 2. Hide elements via style.setProperty (eyeo approach) ───────────────
  // Using setProperty instead of remove() because SPAs often re-use DOM nodes;
  // removal triggers React/Vue reconciliation errors. Hiding is safer.
  function hideElements(root) {
    try {
      (root || document).querySelectorAll(SEL).forEach(el => {
        if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') return;
        el.style.setProperty('display', 'none', 'important');
      });
    } catch (_) {}
  }

  // ── 3. Frame collapsing (eyeo approach) ──────────────────────────────────
  // Hides iframes and images whose src points at a known ad domain.
  function collapseAdFrames(root) {
    try {
      (root || document).querySelectorAll('iframe[src],img[src]').forEach(el => {
        const src = el.getAttribute('src') || '';
        if (src && AD_FRAME_PATTERN.test(src)) {
          el.style.setProperty('display', 'none', 'important');
        }
      });
    } catch (_) {}
  }

  // ── 4. Heuristic popup closer (eyeo-style: remove truly obstructive overlays)
  function closeAdOverlays() {
    try {
      document.querySelectorAll(
        'div[style*="position:fixed"],div[style*="position: fixed"]'
      ).forEach(el => {
        const z = parseInt(el.style.zIndex, 10);
        if (!z || z < 1000) return;
        const r = el.getBoundingClientRect();
        if (r.width < window.innerWidth * 0.8 || r.height < window.innerHeight * 0.8) return;
        if (el.querySelector('input,select,textarea,video,audio,form')) return;
        el.style.setProperty('display', 'none', 'important');
      });
    } catch (_) {}
  }

  // ── 5. requestIdleCallback scheduler (eyeo approach) ─────────────────────
  // Defers expensive DOM work to idle time so it never blocks rendering.
  const IDLE_TIMEOUT = 3000; // ms — eyeo uses the same value
  let _scheduled = false;
  let _lastRun = -IDLE_TIMEOUT;

  function run(root) {
    _lastRun = performance.now();
    injectStyleTag();
    hideElements(root);
    collapseAdFrames(root);
    closeAdOverlays();
  }

  function scheduleRun(root) {
    if (_scheduled) return;
    _scheduled = true;
    const exec = (deadline) => {
      _scheduled = false;
      if (deadline.timeRemaining() > 0 || deadline.didTimeout) {
        run(root || document);
      } else {
        scheduleRun(root); // yield and retry next idle period
      }
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(exec, { timeout: IDLE_TIMEOUT });
    } else {
      setTimeout(() => exec({ timeRemaining: () => 50, didTimeout: false }), 100);
    }
  }

  // ── 6. MutationObserver (eyeo pattern) ───────────────────────────────────
  // Watches for new nodes AND attribute changes (class/id can be added late).
  // Throttles to once per animation frame to avoid thrashing on heavy SPAs.
  let _mutationPending = false;
  const observer = new MutationObserver(mutations => {
    if (_mutationPending) return;
    const now = performance.now();
    if (now - _lastRun < 50) return; // already ran very recently
    _mutationPending = true;
    requestAnimationFrame(() => {
      _mutationPending = false;
      scheduleRun(document);
    });
  });

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  injectStyleTag(); // inject immediately, even before DOM is ready

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      run(document);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'id', 'style', 'src'],
      });
    }, { once: true });
  } else {
    run(document);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'id', 'style', 'src'],
    });
  }

  window.addEventListener('load', () => scheduleRun(document), { once: true });
})();
