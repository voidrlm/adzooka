(async () => {
    let blockedUrls      = [];  // string[]
    let blockedSelectors = {};  // { [site]: string[] }
    let query            = '';  // search string
    let siteFilter       = '';  // '' = all sites

    // ── DOM refs ──────────────────────────────────────────────────────────────
    const $urlList    = document.getElementById('url-list');
    const $selList    = document.getElementById('sel-list');
    const $urlBadge   = document.getElementById('url-badge');
    const $selBadge   = document.getElementById('sel-badge');
    const $statUrls   = document.getElementById('stat-urls');
    const $statSites  = document.getElementById('stat-sites');
    const $statSels   = document.getElementById('stat-sels');
    const $urlInput   = document.getElementById('url-input');
    const $urlAdd     = document.getElementById('url-add');
    const $search     = document.getElementById('search');
    const $searchClr  = document.getElementById('search-clear');
    const $siteChips  = document.getElementById('site-chips');

    // ── Load / Save ───────────────────────────────────────────────────────────
    async function load() {
        const d = await chrome.storage.local.get(['blockedUrls', 'blockedSelectors']);
        blockedUrls      = d.blockedUrls      || [];
        blockedSelectors = d.blockedSelectors || {};
        render();
    }

    async function save() {
        await chrome.storage.local.set({ blockedUrls, blockedSelectors });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function esc(str) {
        return String(str).replace(/[&<>"']/g, c =>
            ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
        );
    }

    function highlight(str, q) {
        if (!q) return esc(str);
        const idx = str.toLowerCase().indexOf(q.toLowerCase());
        if (idx === -1) return esc(str);
        return esc(str.slice(0, idx)) +
               `<mark>${esc(str.slice(idx, idx + q.length))}</mark>` +
               esc(str.slice(idx + q.length));
    }

    function selectorType(sel) {
        if (sel.startsWith('#'))           return ['id',   'ID'];
        if (/^\w+\[/.test(sel))            return ['attr', 'Attr'];
        if (sel.includes('.'))             return ['cls',  'Class'];
        return ['tag', 'Tag'];
    }

    // ── Stats ─────────────────────────────────────────────────────────────────
    function updateStats() {
        const sites    = Object.keys(blockedSelectors);
        const totalSel = Object.values(blockedSelectors).reduce((n, a) => n + a.length, 0);
        $statUrls.textContent  = blockedUrls.length;
        $statSites.textContent = sites.length;
        $statSels.textContent  = totalSel;
    }

    // ── Render site filter chips ──────────────────────────────────────────────
    function renderChips() {
        const sites = Object.keys(blockedSelectors).sort();
        $siteChips.innerHTML = '';

        const all = document.createElement('button');
        all.className = 'chip' + (siteFilter === '' ? ' active' : '');
        all.textContent = 'All sites';
        all.dataset.site = '';
        $siteChips.appendChild(all);

        for (const site of sites) {
            const chip = document.createElement('button');
            chip.className = 'chip' + (siteFilter === site ? ' active' : '');
            chip.textContent = site;
            chip.dataset.site = site;
            $siteChips.appendChild(chip);
        }
    }

    // ── Render hostnames ──────────────────────────────────────────────────────
    function renderUrls() {
        const q = query.toLowerCase();
        const filtered = blockedUrls.filter(h => !q || h.includes(q));

        $urlBadge.textContent = blockedUrls.length;
        $urlBadge.className   = 'badge' + (q && filtered.length < blockedUrls.length ? ' match' : '');

        if (!blockedUrls.length) {
            $urlList.innerHTML = `<div class="empty">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                <div>No blocked hostnames yet</div></div>`;
            return;
        }
        if (q && !filtered.length) {
            $urlList.innerHTML = `<div class="empty"><div>No matches for "<strong>${esc(query)}</strong>"</div></div>`;
            return;
        }

        $urlList.innerHTML = '';
        blockedUrls.forEach((hostname, i) => {
            const matches = !q || hostname.toLowerCase().includes(q);
            const row = document.createElement('div');
            row.className = 'host-row' + (matches ? '' : ' hidden');
            row.innerHTML = `
                <span class="host-name">${highlight(hostname, query)}</span>
                <button class="del-btn" data-i="${i}" title="Remove">✕</button>`;
            $urlList.appendChild(row);
        });
    }

    // ── Render selectors ──────────────────────────────────────────────────────
    function renderSelectors() {
        const q     = query.toLowerCase();
        const sites = Object.keys(blockedSelectors).sort();
        const totalSel = Object.values(blockedSelectors).reduce((n, a) => n + a.length, 0);

        $selBadge.textContent = totalSel;
        $selBadge.className   = 'badge' + (q || siteFilter ? ' match' : '');

        if (!sites.length) {
            $selList.innerHTML = `<div class="empty">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                <div>No selectors yet<br>Use the element picker on a page</div></div>`;
            return;
        }

        $selList.innerHTML = '';
        for (const site of sites) {
            if (siteFilter && site !== siteFilter) continue;

            const sels = blockedSelectors[site];
            const visibleSels = sels.filter(s => !q || s.toLowerCase().includes(q) || site.toLowerCase().includes(q));
            if (!visibleSels.length && !(!q && !siteFilter)) continue;

            const group = document.createElement('div');
            group.className = 'site-group';
            group.dataset.site = site;

            const label = document.createElement('div');
            label.className = 'site-label';
            label.innerHTML = `
                <span class="site-name">
                    ${highlight(site, query)}
                    <span class="site-badge">${visibleSels.length}${visibleSels.length < sels.length ? ` / ${sels.length}` : ''}</span>
                </span>
                <div class="site-actions">
                    <button class="clear-site-btn" data-site="${esc(site)}">Clear all</button>
                </div>`;
            group.appendChild(label);

            sels.forEach((sel, j) => {
                const matches = !q || sel.toLowerCase().includes(q) || site.toLowerCase().includes(q);
                const [typeKey, typeLabel] = selectorType(sel);
                const row = document.createElement('div');
                row.className = 'sel-row' + (matches ? '' : ' hidden');
                row.innerHTML = `
                    <span class="sel-type ${typeKey}">${typeLabel}</span>
                    <span class="sel-text" title="${esc(sel)}">${highlight(sel, query)}</span>
                    <button class="del-btn" data-site="${esc(site)}" data-j="${j}" title="Remove">✕</button>`;
                group.appendChild(row);
            });

            $selList.appendChild(group);
        }

        if (!$selList.children.length) {
            $selList.innerHTML = `<div class="empty"><div>No matches for "<strong>${esc(query)}</strong>"</div></div>`;
        }
    }

    function render() {
        updateStats();
        renderChips();
        renderUrls();
        renderSelectors();
    }

    // ── Search ────────────────────────────────────────────────────────────────
    $search.addEventListener('input', () => {
        query = $search.value;
        $searchClr.classList.toggle('visible', !!query);
        render();
    });

    $searchClr.addEventListener('click', () => {
        $search.value = '';
        query = '';
        $searchClr.classList.remove('visible');
        render();
        $search.focus();
    });

    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            $search.focus();
            $search.select();
        }
        if (e.key === 'Escape' && document.activeElement === $search) {
            $searchClr.click();
        }
    });

    // ── Site filter chips ─────────────────────────────────────────────────────
    $siteChips.addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        siteFilter = chip.dataset.site;
        render();
    });

    // ── Add hostname ──────────────────────────────────────────────────────────
    async function addHostname() {
        let val = $urlInput.value.trim().toLowerCase();
        if (!val) return;
        try { val = new URL(val.includes('://') ? val : 'https://' + val).hostname; } catch (_) {}
        if (!val || blockedUrls.includes(val)) { $urlInput.value = ''; return; }
        blockedUrls.push(val);
        blockedUrls.sort();
        await save();
        render();
        $urlInput.value = '';
        $urlInput.focus();
    }

    $urlAdd.addEventListener('click', addHostname);
    $urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') addHostname(); });

    // ── Delete hostname ───────────────────────────────────────────────────────
    $urlList.addEventListener('click', async e => {
        const btn = e.target.closest('.del-btn');
        if (!btn) return;
        blockedUrls.splice(parseInt(btn.dataset.i, 10), 1);
        await save();
        render();
    });

    // ── Delete selector / clear site ─────────────────────────────────────────
    $selList.addEventListener('click', async e => {
        const clearBtn = e.target.closest('.clear-site-btn');
        if (clearBtn) {
            delete blockedSelectors[clearBtn.dataset.site];
            if (siteFilter === clearBtn.dataset.site) siteFilter = '';
            await save();
            render();
            return;
        }
        const delBtn = e.target.closest('.del-btn');
        if (!delBtn) return;
        const { site } = delBtn.dataset;
        const j = parseInt(delBtn.dataset.j, 10);
        blockedSelectors[site].splice(j, 1);
        if (!blockedSelectors[site].length) {
            delete blockedSelectors[site];
            if (siteFilter === site) siteFilter = '';
        }
        await save();
        render();
    });

    // ── Live storage updates ──────────────────────────────────────────────────
    chrome.storage.onChanged.addListener(changes => {
        if (changes.blockedUrls)      blockedUrls      = changes.blockedUrls.newValue      || [];
        if (changes.blockedSelectors) blockedSelectors = changes.blockedSelectors.newValue || {};
        render();
    });

    load();
})();
