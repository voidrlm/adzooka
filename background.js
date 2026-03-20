// Adzooka — Background Service Worker
//
// Two systems, both ported from AdBlock's background:
//
// 1. CSS injection via chrome.scripting.insertCSS({ origin:"USER" })
//    Mirrors AdBlock's injectCSS() → applyContentFilters() pipeline.
//    USER-origin CSS beats every author !important on the page.
//    Fires on every frame commit so iframes are covered too.
//
// 2. Popup blocker via webNavigation.onCreatedNavigationTarget
//    Mirrors AdBlock's popup-blocker-service-worker.js.
//    Closes any new tab whose URL matches a known ad/popup network.

// ═══════════════════════════════════════════════════════════════════════════
// 1. ELEMENT HIDING CSS  (AdBlock: generateStylesheet → injectCSS)
// ═══════════════════════════════════════════════════════════════════════════
//
// The selector list mirrors what AdBlock's EasyList filter engine produces
// for global (non-domain-specific) element hiding rules.
// Format: selector{display:none!important} — identical to AdBlock's output.

const HIDE_CSS = `
.ad,.ads,.adv,.ad-block,.ad-box,.ad-container,.ad-slot,.ad-unit,
.ad-wrapper,.ad-banner,.ad-content,.ad-footer,.ad-frame,.ad-header,
.ad-holder,.ad-leaderboard,.ad-left,.ad-placement,.ad-right,.ad-row,
.ad-section,.ad-sidebar,.ad-space,.ad-tag,.ad-text,.ad-top,.ad-tower,
.ad-zone,.ads-bar,.ads-container,.ads-inner,.ads-section,.ads-slot,
.ads-widget,.ads-wrapper,
#ad,#ads,#adv,#ad-box,#ad-container,#ad-slot,#ad-unit,#ad-wrapper,#ad-space,
.adarea,.adbar,.adbanner,.adbox,.adcontainer,.adcontent,.adframe,.adholder,
.adimage,.adinner,.adlabel,.adplace,.adrow,.adsbox,.adsense,.adset,.adside,
.adsidebar,.adslot,.adspace,.adspot,.adtag,.adtext,.adtile,.adtop,.adunit,
.adwrap,.adwrapper,.adzone,#adbox,#adspace,#adunit,#adplace,
.advert,.adverts,.advertise,.advertisement,.advertisements,
.advertbox,.advertorial,.adview,#advert,#adverts,#advertisement,#advertorial,
.banner-ad,.banner_ad,.bannerads,.banner_ads,.block-ad,.block_ad,
.bottomad,.bottomads,.display-ad,.dfp-ad,.dfp-unit,.div-gpt-ad,
.footer-ad,.footer_ad,.google-ad,.google_ad,.google-ads,.google_ads,
.googleAd,.googleads,.header-ad,.header_ad,.horizontal-ad,.horizontal_ad,
.inarticle-ad,.inline-ad,.inline_ad,.inside-ad,.interstitial-ad,
.interstitial-container,#interstitial-ad,.leader-ad,.leaderboard-ad,
.leaderboard_ad,.medium-rectangle,.middle-ad,.middle_ad,.module-ad,
.module_ad,.mpu,.mpu-ad,.mpu_ad,.native-ad,.native_ad,.nativead,
.outstream-ad,.page-ad,.page_ad,.paid-content,.partner-ad,.partner_ad,
.post-ad,.post_ad,.promo-ad,.promo_ad,.rectangle-ad,.responsive-ad,
.right-ad,.right_ad,.rhs-ad,#rhs-ad,.sidebar-ad,.sidebar_ad,.site-ad,
.site_ad,.skyscraper,.skyscraper-ad,.slot-ad,.slot_ad,.sponsor-ad,
.sponsor_ad,.sponsor-area,.sponsor-block,.sponsor-box,.sponsor-content,
.sponsor-label,.sponsor-link,.sponsored,.Sponsored,.sponsored-ad,
.sponsored_ad,.sponsored-area,.sponsored-block,.sponsored-container,
.sponsored-content,.sponsored-item,.sponsored-label,.sponsored-link,
.sponsored-links,.sponsored-post,.sponsored-result,.sponsored-widget,
.sponsoredbadge,.sponsoredby,.sponsoredcontent,
#sponsored,#sponsored-content,#sponsoredLinks,
.sticky-ad,.sticky_ad,.text-ad,.text_ad,.textad,.textads,.text-ads,
#text-ads,.top-ad,.top_ad,.topads,#top-ad,#topads,#bottomads,
.tower-ad,.under-ad,.vertical-ad,.wide-ad,
.adsbygoogle,ins.adsbygoogle,[data-ad-client],[data-ad-slot],
[data-ad-unit-id],[data-google-query-id],
div[id^="google_ads_"],div[id^="google_vignette"],
iframe[id^="google_ads_iframe"],iframe[id^="aswift_"],
[id^="div-gpt-ad"],[id^="ad-slot-"],[id^="ad_slot_"],
#tads,#tadsb,#tads-b,#bottomads,#topads,#google-ads,.google-ads-container,
#masthead-ad,#player-ads,.ytd-ad-slot-renderer,
.ytd-in-feed-ad-layout-renderer,.ytd-promoted-video-renderer,
.ytd-promoted-sparkles-web-renderer,.ytd-banner-promo-renderer,
ytd-action-companion-ad-renderer,ytd-display-ad-renderer,
ytd-statement-banner-renderer,yt-mealbar-promo-renderer,
ytd-rich-item-renderer:has(ytd-ad-slot-renderer),ytd-ad-slot-renderer,
.ytp-ad-module,.ytp-ad-overlay-container,.ytp-ad-text-overlay,
.ytp-ad-progress,.ytp-ad-progress-list,.ytp-ad-image-overlay,
.ytp-ad-persistent-progress-bar-container,
[data-promoted="true"],shreddit-ad-post,
div[data-testid*="promoted"],.promotedlink,
[data-testid="placementTracking"],
article:has([data-testid="promotedIndicator"]),
[id^="taboola-"],.trc_rbox_div,.trc_related_container,
[id^="outbrain_"],.OUTBRAIN,.ob-widget,.ob-smartfeed-wrapper,
.criteo-widget,[id^="criteo_"],#criteo-placeholder,
#carbonads,.carbon-wrap,.carbonads,[id^="bsa_zone_"],.bsa_it,
[id^="yandex_rtb_"],.yandex-ad,[id^="Ya_"],#yandex_ad,
[id^="mn_"],[id^="media_net_"],
.mgid-container,[id^="mgid_container"],[id^="mgid-"],
.zergnet-widget,#zergnet,
[id^="tj_"],[id^="TJ_"],.tj-container,[data-tj-id],#tj_ab_div,.tj-bb,
[id^="exo_"],[id^="exo-"],.exo-container,.exoclick-unit,
[id^="juicy_"],.juicyads-container,
[id^="plugrush_"],.plugrush-unit,
.primisslate,[id^="primis_"],.primis-container,.primis-player,
[id^="tf_ad_"],.trafficfactory-unit,[id^="ts_"],.trafficstars-unit,
#popad,#pop_overlay,.popad-container,
#popup-ad,#ad-popup,#adPopup,#adOverlay,#ad-overlay,
.popup-ad,.ad-popup-wrapper,.ad-popup,.popup-ad-container,
[id*="popup-overlay"],[id*="ad-overlay"],.overlay-ad,.ad-overlay,
.modal-ad,.ad-modal,.lightbox-ad,#lightbox-ad,
#newsletter-popup,.newsletter-popup,
[class*="sticky-ad"],[class*="ad-sticky"],[id*="sticky-ad"],
.ads-sticky-banner,div[class*="float-ad"],div[id*="float-ad"],
.fixed-ad,#fixed-ad,[class*="fixed-ad"],
.adhesion-ad,.adhesion-unit,.ad-adhesion,.ad-anchor,#adhesion-ad,
[data-label="Ad"],[data-ad-label],[aria-label="Advertisement"],
img[src*="/ads/"],img[src*="/advert/"],img[src*="/banners/"],
img[src*="ads_banner"],img[src*="banner_ads"],
iframe[src*="doubleclick"],iframe[src*="googlesyndication"],
iframe[src*="adnxs"],iframe[src*="advertising"],
iframe[src*="trafficjunky"],iframe[src*="exoclick"]
{display:none!important}

/* Collapse broken images/iframes (blocked by DNR → load fails → empty box) */
img[src=""],img:not([src]),
iframe[src=""],iframe:not([src]),
img[alt="advertisement"],img[alt="ad"],
object:not([data]),embed:not([src])
{display:none!important}

video,audio,video source{display:block!important;visibility:visible!important}
`;

// Inject CSS into a single frame — mirrors AdBlock's injectCSS()
function injectHideCSS(tabId, frameId) {
  chrome.scripting.insertCSS({
    target: { tabId, frameIds: [frameId] },
    css: HIDE_CSS,
    origin: 'USER',           // USER origin beats any author !important
  }).catch(() => {});
}

async function isSiteDisabled(url) {
  try {
    const host = new URL(url).hostname;
    const { disabledSites = [] } = await chrome.storage.local.get('disabledSites');
    return disabledSites.includes(host);
  } catch (_) { return false; }
}

// Fire on every frame commit — mirrors AdBlock's applyContentFilters() trigger
chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
  if (!url || !url.startsWith('http')) return;
  if (await isSiteDisabled(url)) return;
  injectHideCSS(tabId, frameId);
});

// Also inject when a frame's DOM is ready (belt-and-suspenders for SPAs)
chrome.webNavigation.onDOMContentLoaded.addListener(async ({ tabId, frameId, url }) => {
  if (!url || !url.startsWith('http')) return;
  if (await isSiteDisabled(url)) return;
  injectHideCSS(tabId, frameId);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. POPUP BLOCKER  (AdBlock: popup-blocker-service-worker.js)
// ═══════════════════════════════════════════════════════════════════════════

const POPUP_BLOCK = /trafficjunky\.(net|com)|exoclick\.com|realsrv\.com|realsrvcdn\.com|juicyads\.(com|me|net|org)|plugrush\.com|plugadverts\.com|trafficfactory\.biz|trafficstars\.com|tsyndicate\.com|twinred\.com|popcash\.net|popads\.(net|com)|clickadu\.com|hilltopads\.(net|com)|adxpansion\.com|ero-advertising\.com|eromedia\.net|adultforce\.com|trafmag\.com|tubecorporate\.com|propellerads\.com|adcash\.com|ad-maven\.com|adf\.ly|linkbucks\.com|shorte\.st|ouo\.io|clkmon\.com|clicksfly\.com|adfoc\.us|sh\.st|ceesty\.com|destyy\.com|cut-urls\.com|popunder\.net|pounder\.pro|popunderbanner\.com/i;

const pendingPopups = new Map();

function onCreatedNavigationTarget({ tabId, url, sourceTabId }) {
  if (url && url !== 'about:blank' && POPUP_BLOCK.test(url)) {
    chrome.tabs.remove(tabId).catch(() => {});
    return;
  }
  pendingPopups.set(tabId, sourceTabId);
}

function onBeforeNavigate({ tabId, frameId, url }) {
  if (frameId !== 0) return;
  if (!pendingPopups.has(tabId)) return;
  if (url && url !== 'about:blank' && POPUP_BLOCK.test(url)) {
    chrome.tabs.remove(tabId).catch(() => {});
    pendingPopups.delete(tabId);
  }
}

function onNavCompleted({ tabId, frameId }) {
  if (frameId !== 0) return;
  pendingPopups.delete(tabId);
}

chrome.webNavigation.onCreatedNavigationTarget.addListener(onCreatedNavigationTarget);
chrome.webNavigation.onBeforeNavigate.addListener(onBeforeNavigate);
chrome.webNavigation.onCompleted.addListener(onNavCompleted);
chrome.tabs.onRemoved.addListener(tabId => pendingPopups.delete(tabId));
