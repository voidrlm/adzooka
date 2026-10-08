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
    const $popupToggle = document.getElementById('popup-toggle');
    const $notice = document.getElementById('notice');
    let supported = false;

    let host = '';
    let tabId = null;

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        host = tab?.url ? new URL(tab.url).hostname : '';
        tabId = tab?.id ?? null;
        supported = !!tab?.url && /^https?:/.test(new URL(tab.url).protocol);
    } catch (_) {}

    $h.textContent = host || 'No site';
    $t.disabled = !supported;
    if (!supported) $notice.textContent = 'Open a website to use the element picker.';

    const escapeHtml = (value) =>
        value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const labelForSelector = (selector) => {
        if (selector.startsWith('adzooka-shadow:')) {
            try { return JSON.parse(selector.slice('adzooka-shadow:'.length)).join(' → '); } catch (_) {}
        }
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

    let renderedSelectors = [];
    let renderRevision = 0;
    const renderRules = async () => {
        const revision = ++renderRevision;
        const selectors = await getSiteSelectors();
        if (revision !== renderRevision) return;
        renderedSelectors = selectors;
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

    const { disabledSites = [], popupBlockingEnabled = true } = await chrome.storage.local.get(['disabledSites', 'popupBlockingEnabled']);
    $popupToggle.checked = popupBlockingEnabled;
    $popupToggle.addEventListener('change', async () => {
        $popupToggle.disabled = true;
        try {
            await chrome.storage.local.set({ popupBlockingEnabled: $popupToggle.checked });
            $notice.textContent = '';
        } catch (error) {
            $popupToggle.checked = !$popupToggle.checked;
            $notice.textContent = error.message || 'Could not save popup settings.';
        } finally { $popupToggle.disabled = false; }
    });
    const apply = (disabled) => {
        $t.checked = !disabled;
        $btn.disabled = !supported || disabled;
        $btn.title = disabled ? 'Enable this site to pick elements.' : '';
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

    $btn.addEventListener('click', async () => {
        if (tabId === null || !supported) return;
        $btn.disabled = true;
        try {
            const response = await chrome.runtime.sendMessage({ action: 'startPicker', tabId });
            if (!response?.ok) throw new Error(response?.error || 'Could not start the picker.');
            window.close();
        } catch (error) {
            $notice.textContent = error.message || 'This page does not allow element picking.';
            $btn.disabled = false;
        }
    });

    $rulesList.addEventListener('click', async (event) => {
        const button = event.target.closest('.rule-remove');
        if (!button) return;

        const index = Number(button.dataset.index);
        const selector = renderedSelectors[index];
        if (!selector) return;

        const response = await chrome.runtime.sendMessage({ action: 'removeBlockedElement', selector, site: host });
        if (!response?.ok) $notice.textContent = response?.error || 'Could not remove the rule.';
        await renderRules();
    });

    $rulesClear.addEventListener('click', async () => {
        const selectors = await getSiteSelectors();
        if (!selectors.length) return;

        const response = await chrome.runtime.sendMessage({ action: 'clearBlockedElements', site: host });
        if (!response?.ok) $notice.textContent = response?.error || 'Could not clear the rules.';
        await renderRules();
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

        try {
            const response = await chrome.runtime.sendMessage({ action: 'importRules', data });
            if (!response?.ok) throw new Error(response?.error || 'Could not import rules.');
        } catch (error) {
            $notice.textContent = error.message;
            $file.value = '';
            return;
        }
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

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.popupBlockingEnabled) $popupToggle.checked = changes.popupBlockingEnabled.newValue !== false;
        if (changes.disabledSites) apply((changes.disabledSites.newValue || []).includes(host));
        if (changes.blockedSelectors) {
            renderRules().catch(console.error);
        }
    });
})();
