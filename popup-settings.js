(() => {
    let enabled = true;
    let disabledSites = [];
    let ready = false;
    let revision = 0;
    let site;
    try { site = new URL(window.top.location.href).hostname; }
    catch (_) {
        site = location.ancestorOrigins?.length ? new URL(location.ancestorOrigins[location.ancestorOrigins.length - 1]).hostname : location.hostname;
    }
    function publish() {
        if (ready) document.dispatchEvent(new CustomEvent('__adzooka_popup_config', {
            detail: enabled && !disabledSites.includes(site),
        }));
    }
    document.addEventListener('__adzooka_popup_ready', publish);
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (!changes.popupBlockingEnabled && !changes.disabledSites) return;
        revision++;
        if (changes.popupBlockingEnabled) enabled = changes.popupBlockingEnabled.newValue !== false;
        if (changes.disabledSites) disabledSites = changes.disabledSites.newValue || [];
        publish();
    });
    async function initialize() {
        const before = revision;
        const data = await chrome.storage.local.get(['popupBlockingEnabled', 'disabledSites']);
        if (before !== revision) return initialize();
        enabled = data.popupBlockingEnabled !== false;
        disabledSites = data.disabledSites || [];
        ready = true;
        publish();
    }
    initialize().catch(console.error);
})();
