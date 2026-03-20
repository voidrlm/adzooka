// Adzooka — Popup
(async () => {
  const $status = document.getElementById('status-text');
  const $dot    = document.getElementById('status-dot');
  const $host   = document.getElementById('toggle-host');
  const $toggle = document.getElementById('site-toggle');

  // Get current tab hostname
  let host = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    host = tab?.url ? (() => { try { return new URL(tab.url).hostname; } catch (_) { return ''; } })() : '';
  } catch (_) {}

  $host.textContent = host || 'No site';

  // Load disabled-sites list from storage
  const { disabledSites = [] } = await chrome.storage.local.get('disabledSites');
  const isDisabled = disabledSites.includes(host);

  function applyState(disabled) {
    $toggle.checked       = !disabled;
    $status.textContent   = disabled ? 'Paused on this site' : 'Active';
    $status.style.color   = disabled ? 'var(--muted)' : 'var(--green)';
    $dot.classList.toggle('off', disabled);
  }

  applyState(isDisabled);

  $toggle.addEventListener('change', async () => {
    const { disabledSites: list = [] } = await chrome.storage.local.get('disabledSites');
    const nowDisabled = !$toggle.checked;

    const updated = nowDisabled
      ? [...new Set([...list, host])]
      : list.filter(h => h !== host);

    await chrome.storage.local.set({ disabledSites: updated });
    applyState(nowDisabled);
  });
})();
