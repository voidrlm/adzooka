// Adzooka — Popup
(async () => {
  const $status = document.getElementById('status-text');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const host  = tab?.url ? (() => { try { return new URL(tab.url).hostname; } catch (_) { return ''; } })() : '';
    if (host.includes('youtube.com'))  $status.textContent = 'Blocking YouTube ads';
    else if (host.includes('spotify.com')) $status.textContent = 'Blocking Spotify ads';
    else $status.textContent = 'Active';
  } catch (_) {}
})();
