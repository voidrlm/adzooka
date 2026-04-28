(async () => {
    const $s = document.getElementById('status-text');
    const $d = document.getElementById('status-dot');
    const $p = document.getElementById('pulse-ring');
    const $h = document.getElementById('toggle-host');
    const $t = document.getElementById('site-toggle');
    const $editor = document.getElementById('editor-btn');
    const $btn = document.getElementById('picker-btn');
    const $exp = document.getElementById('export-btn');
    const $imp = document.getElementById('import-btn');
    const $file = document.getElementById('import-file');
    const $rulesList = document.getElementById('rules-list');
    const $rulesClear = document.getElementById('rules-clear');

    let host = '';
    let tabId = null;

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        host = tab?.url ? new URL(tab.url).hostname : '';
        tabId = tab?.id ?? null;
    } catch (_) {}

    $h.textContent = host || 'No site';

    const escapeHtml = (value) =>
        value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const labelForSelector = (selector) => {
        if (selector.startsWith('adzooka-frame-cluster:')) {
            try {
                const rule = JSON.parse(selector.slice('adzooka-frame-cluster:'.length));
                const anchor = rule.anchor || 'body';
                const number = Number.isInteger(rule.index) ? rule.index + 1 : '?';
                return `iframe cluster: ${anchor} iframe #${number}`;
            } catch (_) {
                return selector;
            }
        }
        return selector;
    };

    const getBlockedSelectorsMap = async () => {
        const { blockedSelectors = {} } = await chrome.storage.local.get('blockedSelectors');
        return blockedSelectors;
    };

    const getSiteSelectors = async () => {
        if (!host) return [];
        const blockedSelectors = await getBlockedSelectorsMap();
        return blockedSelectors[host] || [];
    };

    const setSiteSelectors = async (selectors) => {
        if (!host) return;
        const blockedSelectors = await getBlockedSelectorsMap();
        const next = { ...blockedSelectors };

        if (selectors.length) next[host] = selectors;
        else delete next[host];

        await chrome.storage.local.set({ blockedSelectors: next });
    };

    const renderRules = async () => {
        const selectors = await getSiteSelectors();
        $rulesClear.style.visibility = selectors.length ? 'visible' : 'hidden';

        if (!selectors.length) {
            $rulesList.innerHTML = '<div class="rules-empty">No blocked element rules on this site yet.</div>';
            return;
        }

        $rulesList.innerHTML = selectors
            .map((selector, index) => `
                <div class="rule-item">
                  <span class="rule-bullet">#</span>
                  <div class="rule-text">${escapeHtml(labelForSelector(selector))}</div>
                  <button class="rule-remove" type="button" data-index="${index}" aria-label="Remove rule">×</button>
                </div>
            `)
            .join('');
    };

    const { disabledSites = [] } = await chrome.storage.local.get('disabledSites');
    const apply = (disabled) => {
        $t.checked = !disabled;
        $s.textContent = disabled ? 'Paused on this site' : 'Active';
        $s.style.color = disabled ? 'var(--muted)' : '';
        $d.classList.toggle('off', disabled);
        $p.classList.toggle('off', disabled);
    };

    apply(disabledSites.includes(host));
    await renderRules();

    $t.addEventListener('change', async () => {
        const { disabledSites: list = [] } = await chrome.storage.local.get('disabledSites');
        const off = !$t.checked;

        await chrome.storage.local.set({
            disabledSites: off ? [...new Set([...list, host])] : list.filter((entry) => entry !== host),
        });

        apply(off);
    });

    $editor.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
        window.close();
    });

    $btn.addEventListener('click', () => {
        if (tabId === null) return;
        chrome.runtime.sendMessage({ action: 'startPicker', tabId });
        setTimeout(() => window.close(), 150);
    });

    $rulesList.addEventListener('click', async (event) => {
        const button = event.target.closest('.rule-remove');
        if (!button) return;

        const selectors = await getSiteSelectors();
        const index = Number(button.dataset.index);
        if (Number.isNaN(index) || index < 0 || index >= selectors.length) return;

        selectors.splice(index, 1);
        await setSiteSelectors(selectors);
        await renderRules();

        if (tabId !== null) chrome.tabs.reload(tabId);
    });

    $rulesClear.addEventListener('click', async () => {
        const selectors = await getSiteSelectors();
        if (!selectors.length) return;

        await setSiteSelectors([]);
        await renderRules();

        if (tabId !== null) chrome.tabs.reload(tabId);
    });

    $exp.addEventListener('click', async () => {
        const { blockedUrls = [], blockedSelectors = {} } =
            await chrome.storage.local.get(['blockedUrls', 'blockedSelectors']);

        const payload = JSON.stringify({ version: 1, blockedUrls, blockedSelectors }, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `adzooka-rules-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);

        const original = $exp.textContent;
        $exp.textContent = 'Exported!';
        setTimeout(() => {
            $exp.textContent = original;
        }, 1500);
    });

    $imp.addEventListener('click', () => $file.click());

    $file.addEventListener('change', async () => {
        const file = $file.files[0];
        if (!file) return;

        let data;
        try {
            data = JSON.parse(await file.text());
        } catch (_) {
            $imp.textContent = 'Invalid file';
            setTimeout(() => {
                $imp.textContent = 'Import rules';
            }, 1800);
            return;
        }

        await chrome.runtime.sendMessage({ action: 'importRules', data });
        await renderRules();

        if (tabId !== null) chrome.tabs.reload(tabId);

        const urls = (data.blockedUrls || []).length;
        const selectorCount = Object.values(data.blockedSelectors || {}).reduce(
            (count, selectors) => count + selectors.length,
            0
        );
        $imp.textContent = `Imported ${urls}u + ${selectorCount}s`;

        $file.value = '';
        setTimeout(() => window.close(), 1200);
    });

    chrome.storage.onChanged.addListener((changes) => {
        if (changes.blockedSelectors) {
            renderRules().catch(console.error);
        }
    });
})();
