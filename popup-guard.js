// Runs in the page world; isolated content scripts cannot intercept page window.open.
(() => {
    const nativeOpen = window.open;
    let enabled = false;
    const CONFIG_EVENT = '__adzooka_popup_config';
    document.addEventListener(CONFIG_EVENT, event => {
        if (typeof event.detail === 'boolean') enabled = event.detail;
    });
    window.open = function (...args) {
        const target = typeof args[1] === 'string' ? args[1].toLowerCase() : '_blank';
        if (enabled && !['_self', '_parent', '_top'].includes(target)) return null;
        return Reflect.apply(nativeOpen, this, args);
    };
    // A handshake handles either ordering of the MAIN and ISOLATED scripts.
    document.dispatchEvent(new Event('__adzooka_popup_ready'));
})();
