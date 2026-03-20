// Adzooka — General Content Script (all sites, document_start)
//
//  1. Iframe/image collapsing for frames that load blocked ad domains
//  2. Element collapsing when resources fail to load (blocked by DNR)
//  3. Heuristic popup/overlay closer
(function () {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.runtime) return;

  // YouTube and Spotify have their own dedicated content.js
  const host = location.hostname;
  if (host.includes('youtube.com') || host.includes('spotify.com')) return;

  // Known ad iframe/image src patterns — used for frame collapsing
  const AD_FRAME_PATTERN = /doubleclick\.net|googlesyndication\.com|adnxs\.com|advertising\.com|adservice\.google|pagead2\.|moatads\.com|rubiconproject\.com|openx\.net|appnexus\.com|criteo\.(com|net)|outbrain\.com|taboola\.com|revcontent\.com|mgid\.com|adsrvr\.org|adgrx\.com|medianet\.com|yieldmanager\.com|spotxchange\.com|sharethrough\.com|33across\.com|trafficjunky\.(net|com)|exoclick\.com|realsrv\.com|juicyads\.com|plugrush\.com|trafficfactory\.biz|trafficstars\.com|twinred\.com|popads\.net|popcash\.net|ero-advertising\.com|adxpansion\.com|primis\.tech|tsyndicate\.com/i;

  // ── 1. Element collapsing (AdBlock's primary technique) ──────────────────
  // When a resource is blocked by DNR it fails to load → fires an error event.
  // AdBlock listens for these errors and collapses the parent container.
  // This is what removes the dark empty boxes — not just CSS hiding.

  function collapseBlockedElement(el) {
    // Hide the element itself
    el.style.setProperty('display', 'none', 'important');
    // Walk up to collapse the containing ad card too
    // (removes the empty dark box + "Ad" label completely)
    let parent = el.parentElement;
    for (let i = 0; i < 8 && parent && parent !== document.body; i++) {
      const r = parent.getBoundingClientRect();
      if (r.width > 80 && r.height > 80) {
        parent.style.setProperty('display', 'none', 'important');
        return;
      }
      parent = parent.parentElement;
    }
  }

  function attachCollapseListeners(root) {
    try {
      // Images — blocked by DNR → src fails → error fires
      (root || document).querySelectorAll('img,iframe,object,embed,video').forEach(el => {
        el.addEventListener('error', () => collapseBlockedElement(el), { once: true });
        // Also collapse immediately if already broken (naturalWidth === 0)
        if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0 && el.src) {
          collapseBlockedElement(el);
        }
      });
    } catch (_) {}
  }

  // ── 2. Frame collapsing for known ad src domains ──────────────────────────
  function collapseAdFrames(root) {
    try {
      (root || document).querySelectorAll('iframe[src],img[src],object[data],embed[src]').forEach(el => {
        const src = el.getAttribute('src') || el.getAttribute('data') || '';
        if (src && AD_FRAME_PATTERN.test(src)) {
          collapseBlockedElement(el);
        }
      });
    } catch (_) {}
  }

  // ── 3. Heuristic popup closer (eyeo-style: remove truly obstructive overlays)
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

  // ── 4. requestIdleCallback scheduler (eyeo approach) ─────────────────────
  // Defers expensive DOM work to idle time so it never blocks rendering.
  const IDLE_TIMEOUT = 3000; // ms — eyeo uses the same value
  let _scheduled = false;
  let _lastRun = -IDLE_TIMEOUT;

  function run(root) {
    _lastRun = performance.now();
    collapseAdFrames(root);
    attachCollapseListeners(root);
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

  // ── 5. MutationObserver (eyeo pattern) ───────────────────────────────────
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
