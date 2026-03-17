// ─── Adzooka — Popup Script v2 ────────────────────────────────────────

(async () => {
  // ── DOM refs ──────────────────────────────────────────────────────────────
  const $shieldIcon   = document.getElementById("shield-icon");
  const $statusText   = document.getElementById("status-text");
  const $toggleSite   = document.getElementById("toggle-site");
  const $blockedTab   = document.getElementById("blocked-tab");
  const $blockedTotal = document.getElementById("blocked-total");
  const $catNetN      = document.getElementById("cat-net-n");
  const $catCosN      = document.getElementById("cat-cos-n");
  const $catPopN      = document.getElementById("cat-pop-n");
  const $currentDomain= document.getElementById("current-domain");
  const $siteDot      = document.getElementById("site-dot");
  const $btnAllow     = document.getElementById("btn-allow-site");
  const $customDomain = document.getElementById("custom-domain");
  const $btnAdd       = document.getElementById("btn-add-filter");
  const $filterList   = document.getElementById("custom-filter-list");
  const $filterCount  = document.getElementById("filter-count");
  const $btnReset     = document.getElementById("btn-reset");

  // ── Current tab ───────────────────────────────────────────────────────────
  let currentTab  = null;
  let currentHost = "";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab  = tab;
    currentHost = tab?.url ? (() => {
      try { return new URL(tab.url).hostname; } catch (_) { return ""; }
    })() : "";
  } catch (_) {}

  $currentDomain.textContent = currentHost || "—";

  // ── Live scan: inject a quick counter into the page ───────────────────────
  // Ask content script how many elements it found last run (stored in window)
  let cosmeticRemovedCount = 0;
  let popupBlockCount = 0;

  if (currentTab?.id != null) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: () => ({
          cosmetic: window.__ubrCosmeticCount ?? 0,
          popups:   window.__ubrPopupCount    ?? 0,
        }),
        world: "MAIN",
      });
      if (results?.[0]?.result) {
        cosmeticRemovedCount = results[0].result.cosmetic ?? 0;
        popupBlockCount      = results[0].result.popups   ?? 0;
      }
    } catch (_) {}
  }

  // ── Load stats ────────────────────────────────────────────────────────────
  async function loadStats() {
    try {
      const stats = await chrome.runtime.sendMessage({
        type: "GET_STATS",
        tabId: currentTab?.id,
      });

      const tabCount = stats.tabCount ?? 0;

      $blockedTotal.textContent = formatNum(stats.blockedCount ?? 0);
      $blockedTab.textContent   = formatNum(tabCount);

      // Category chips
      $catNetN.textContent = formatNum(tabCount);
      $catCosN.textContent = formatNum(cosmeticRemovedCount);
      $catPopN.textContent = formatNum(popupBlockCount);

      // Render custom filters
      const filters = stats.customFilters ?? [];
      renderFilters(filters);
      $filterCount.textContent = filters.length;

      // Allowlist state
      const allowed = stats.allowedDomains ?? [];
      const siteAllowed = currentHost && allowed.includes(currentHost);

      if (siteAllowed) {
        $btnAllow.textContent = "Remove allow";
        $btnAllow.classList.add("active");
        $toggleSite.checked     = false;
        $statusText.textContent = "Disabled on this site";
        $siteDot.classList.add("blocked");
      } else {
        $btnAllow.textContent = "Allow site";
        $btnAllow.classList.remove("active");
        $toggleSite.checked     = true;
        $statusText.textContent = tabCount > 0
          ? `Blocked ${formatNum(tabCount)} request${tabCount !== 1 ? "s" : ""}`
          : "Protection active";
        $siteDot.classList.remove("blocked");
      }

      // Pulse shield if active and blocking
      if (!siteAllowed && tabCount > 0) {
        $shieldIcon.classList.add("pulse");
        setTimeout(() => $shieldIcon.classList.remove("pulse"), 700);
      }
    } catch (err) {
      $statusText.textContent = "Error loading stats";
      console.error("[popup] loadStats:", err);
    }
  }

  function formatNum(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
    return String(n);
  }

  // ── Render filter list ────────────────────────────────────────────────────
  function renderFilters(filters) {
    $filterList.innerHTML = "";
    for (const domain of filters) {
      const li  = document.createElement("li");
      const txt = document.createElement("span");
      txt.textContent = domain;

      const btn = document.createElement("button");
      btn.className   = "remove-btn";
      btn.textContent = "×";
      btn.title       = `Remove block for ${domain}`;
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        await chrome.runtime.sendMessage({ type: "REMOVE_CUSTOM_FILTER", domain });
        loadStats();
      });

      li.appendChild(txt);
      li.appendChild(btn);
      $filterList.appendChild(li);
    }
  }

  // ── Add custom filter ─────────────────────────────────────────────────────
  $btnAdd.addEventListener("click", async () => {
    let domain = $customDomain.value.trim().toLowerCase();
    // Normalise: strip protocol, path, port
    domain = domain.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
    if (!domain || !domain.includes(".")) {
      $customDomain.style.borderColor = "var(--accent)";
      setTimeout(() => ($customDomain.style.borderColor = ""), 1000);
      return;
    }
    $btnAdd.disabled = true;
    await chrome.runtime.sendMessage({ type: "ADD_CUSTOM_FILTER", domain });
    $customDomain.value = "";
    $btnAdd.disabled = false;
    loadStats();
  });

  $customDomain.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $btnAdd.click();
  });

  // ── Allow / disallow site ─────────────────────────────────────────────────
  $btnAllow.addEventListener("click", async () => {
    if (!currentHost) return;
    const stats   = await chrome.runtime.sendMessage({ type: "GET_STATS" });
    const allowed = stats.allowedDomains ?? [];
    if (allowed.includes(currentHost)) {
      await chrome.runtime.sendMessage({ type: "DISALLOW_DOMAIN", domain: currentHost });
    } else {
      await chrome.runtime.sendMessage({ type: "ALLOW_DOMAIN", domain: currentHost });
    }
    loadStats();
  });

  $toggleSite.addEventListener("change", () => $btnAllow.click());

  // ── Reset stats ───────────────────────────────────────────────────────────
  $btnReset.addEventListener("click", async () => {
    await chrome.storage.local.set({ blockedCount: 0 });
    if (currentTab?.id != null) {
      chrome.action.setBadgeText({ text: "", tabId: currentTab.id }).catch(() => {});
    }
    loadStats();
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  loadStats();

  // Auto-refresh every 3s while popup is open
  const refreshInterval = setInterval(loadStats, 3000);
  window.addEventListener("unload", () => clearInterval(refreshInterval));
})();
