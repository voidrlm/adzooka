// Adzooka — Background Service Worker
//
// Popup blocker ported from AdBlock's popup-blocker-service-worker.js:
//   webNavigation.onCreatedNavigationTarget  →  catches every new tab/popup
//   webNavigation.onBeforeNavigate           →  checks URL as soon as it's known
//   webNavigation.onCompleted                →  final cleanup
//   chrome.tabs.remove()                     →  closes the blocked tab
//
// This catches popups that bypass window.open interception:
//   • <a target="_blank"> links clicked by ad scripts
//   • window.open("about:blank") then redirect tricks
//   • Delayed opens via setTimeout outside user gesture

// ── Blocked popup domains (ad networks + popup/redirect services) ─────────
const POPUP_BLOCK = /trafficjunky\.(net|com)|exoclick\.com|realsrv\.com|realsrvcdn\.com|juicyads\.(com|me|net|org)|plugrush\.com|plugadverts\.com|trafficfactory\.biz|trafficstars\.com|tsyndicate\.com|twinred\.com|popcash\.net|popads\.(net|com)|clickadu\.com|hilltopads\.(net|com)|adxpansion\.com|ero-advertising\.com|eromedia\.net|adultforce\.com|trafmag\.com|tubecorporate\.com|propellerads\.com|adcash\.com|ad-maven\.com|ad-fly\.|adf\.ly|linkbucks\.com|shorte\.st|ouo\.io|clkmon\.com|clicksfly\.com|bc\.vc|za\.gl|za\.gl|srt\.am|ppid\.me|shrinkearn\.com|earnhub\.net|oke\.io|fc\.lc|sh\.st|ceesty\.com|gestyy\.com|destyy\.com|clck\.ru|u\.to|gg\.gg|doods\.pro|exe\.io|zee\.gl|cut-urls\.com|adfly|shorte\.st|adfoc\.us|adshorten\.|tinyurl\.com\/ad|go2l\.ink/i;

// ── Popup tracker: tabId → openerTabId (mirrors PotentialPopupMap) ─────────
const pendingPopups = new Map();

// Called when any page opens a new tab or popup window.
// Mirrors AdBlock's onPopup() — the heart of the popup blocker.
function onCreatedNavigationTarget({ tabId, url, sourceTabId }) {
  // If the URL is already known, decide immediately
  if (url && url !== 'about:blank' && url !== '') {
    if (POPUP_BLOCK.test(url)) {
      chrome.tabs.remove(tabId).catch(() => {});
      return;
    }
  }
  // URL not yet known (about:blank trick) — track it and wait
  pendingPopups.set(tabId, sourceTabId);
}

// Fires just before each navigation; URL is now definitive.
// Mirrors AdBlock's onPopupURLChanged().
function onBeforeNavigate({ tabId, frameId, url }) {
  if (frameId !== 0) return; // top-level frame only
  if (!pendingPopups.has(tabId)) return;

  if (url && url !== 'about:blank' && POPUP_BLOCK.test(url)) {
    chrome.tabs.remove(tabId).catch(() => {});
    pendingPopups.delete(tabId);
  }
}

// Fires when navigation finishes — clean up the tracker.
// Mirrors AdBlock's onCompleted().
function onCompleted({ tabId, frameId }) {
  if (frameId !== 0) return;
  pendingPopups.delete(tabId);
}

// Clean up when a tab closes naturally.
function onTabRemoved(tabId) {
  pendingPopups.delete(tabId);
}

// ── Start the popup blocker ────────────────────────────────────────────────
chrome.webNavigation.onCreatedNavigationTarget.addListener(onCreatedNavigationTarget);
chrome.webNavigation.onBeforeNavigate.addListener(onBeforeNavigate);
chrome.webNavigation.onCompleted.addListener(onCompleted);
chrome.tabs.onRemoved.addListener(onTabRemoved);
