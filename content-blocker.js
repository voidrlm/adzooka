(function () {
    const STYLE_ID = '__adzooka-cosmetic-user';
    const site = window.location.hostname;

    function applySelectors(selectors) {
        let el = document.getElementById(STYLE_ID);
        if (!selectors || selectors.length === 0) {
            if (el) el.remove();
            return;
        }
        if (!el) {
            el = document.createElement('style');
            el.id = STYLE_ID;
            (document.head || document.documentElement).appendChild(el);
        }
        el.textContent = selectors.map(s => `${s}{display:none!important}`).join('\n');
    }

    chrome.storage.local.get('blockedSelectors', ({ blockedSelectors = {} }) => {
        applySelectors(blockedSelectors[site] || []);
    });

    chrome.storage.onChanged.addListener((changes) => {
        if (changes.blockedSelectors) {
            applySelectors((changes.blockedSelectors.newValue || {})[site] || []);
        }
    });
})();
