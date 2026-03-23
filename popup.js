(async () => {
    const $s    = document.getElementById('status-text');
    const $d    = document.getElementById('status-dot');
    const $p    = document.getElementById('pulse-ring');
    const $h    = document.getElementById('toggle-host');
    const $t    = document.getElementById('site-toggle');
    const $editor = document.getElementById('editor-btn');
    const $btn    = document.getElementById('picker-btn');
    const $exp  = document.getElementById('export-btn');
    const $imp  = document.getElementById('import-btn');
    const $file = document.getElementById('import-file');

    let host = '';
    let tabId = null;
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        host  = tab?.url ? new URL(tab.url).hostname : '';
        tabId = tab?.id ?? null;
    } catch (_) {}

    $h.textContent = host || 'No site';

    const { disabledSites = [] } = await chrome.storage.local.get('disabledSites');
    const apply = d => {
        $t.checked = !d;
        $s.textContent = d ? 'Paused on this site' : 'Active';
        $s.style.color = d ? 'var(--muted)' : '';
        $d.classList.toggle('off', d);
        $p.classList.toggle('off', d);
    };
    apply(disabledSites.includes(host));

    $t.addEventListener('change', async () => {
        const { disabledSites: list = [] } = await chrome.storage.local.get('disabledSites');
        const off = !$t.checked;
        await chrome.storage.local.set({
            disabledSites: off ? [...new Set([...list, host])] : list.filter(h => h !== host),
        });
        apply(off);
    });

    // ── Rule editor ───────────────────────────────────────────────────────────
    $editor.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
        window.close();
    });

    // ── Element picker ────────────────────────────────────────────────────────
    $btn.addEventListener('click', () => {
        if (tabId === null) return;
        chrome.runtime.sendMessage({ action: 'startPicker', tabId });
        setTimeout(() => window.close(), 150);
    });

    // ── Export ────────────────────────────────────────────────────────────────
    $exp.addEventListener('click', async () => {
        const { blockedUrls = [], blockedSelectors = [] } =
            await chrome.storage.local.get(['blockedUrls', 'blockedSelectors']);

        const payload = JSON.stringify({ version: 1, blockedUrls, blockedSelectors }, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `adzooka-rules-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);

        const orig = $exp.textContent;
        $exp.textContent = 'Exported!';
        setTimeout(() => ($exp.textContent = orig), 1500);
    });

    // ── Import ────────────────────────────────────────────────────────────────
    $imp.addEventListener('click', () => $file.click());

    $file.addEventListener('change', async () => {
        const file = $file.files[0];
        if (!file) return;

        let data;
        try {
            data = JSON.parse(await file.text());
        } catch (_) {
            $imp.textContent = 'Invalid file';
            setTimeout(() => ($imp.textContent = 'Import rules'), 1800);
            return;
        }

        await chrome.runtime.sendMessage({ action: 'importRules', data });

        if (tabId !== null) chrome.tabs.reload(tabId);

        const urls = (data.blockedUrls || []).length;
        const sels = (data.blockedSelectors || []).length;
        $imp.textContent = `Imported ${urls}u + ${sels}s`;

        $file.value = '';
        setTimeout(() => window.close(), 1200);
    });
})();
