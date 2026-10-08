(() => {
    if (window.__adzookaPickerActive) return;
    const engine = globalThis.__adzookaUserRules;
    if (!engine || !document.documentElement) throw new Error('The picker cannot run on this page.');
    window.__adzookaPickerActive = true;
    const controller = new AbortController();
    const options = { capture: true, signal: controller.signal };
    const previousFocus = document.activeElement;
    const host = document.createElement('div');
    host.setAttribute('popover', 'manual');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;z-index:2147483647!important;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
        <style>
        :host{color-scheme:dark}*{box-sizing:border-box}
        .shield{position:fixed;inset:0;cursor:crosshair}
        .highlight{position:fixed;pointer-events:none;border:2px solid #ff426e;background:#ff426e25;box-shadow:0 0 0 1px #fff8;display:none}
        .panel{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);width:min(540px,calc(100vw - 24px));padding:14px;background:#111821;color:#e8edf5;border:1px solid #465368;border-radius:12px;box-shadow:0 8px 40px #0008;font:13px/1.5 system-ui,sans-serif;cursor:default}
        .heading{display:flex;justify-content:space-between;align-items:center;font-weight:700;margin-bottom:8px}
        .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
        button{font:inherit;color:inherit;background:#263244;border:1px solid #52617a;border-radius:6px;padding:6px 12px;cursor:pointer}
        button:focus-visible{outline:2px solid #fff;outline-offset:2px}button:disabled{opacity:.4;cursor:default}
        .block{background:#bd294b;border-color:#f24a72}.selector{display:block;overflow-wrap:anywhere;max-height:64px;overflow:auto;font:12px/1.5 monospace;color:#b7c8e0;margin-top:6px}
        .hint{font-size:11px;color:#a6b4c9;margin-top:8px}.status{min-height:20px}
        </style>
        <div class="shield"></div><div class="highlight"></div>
        <section class="panel" role="dialog" aria-label="Adzooka element picker">
          <div class="heading">Adzooka · Element picker<span><button data-action="move" aria-label="Move picker panel to the other edge">Move panel</button> <button data-action="close" aria-label="Close picker">Done</button></span></div>
          <div class="status" role="status" aria-live="polite">Click an element to preview it.</div>
          <code class="selector"></code>
          <div class="actions">
            <button data-action="parent" disabled>Parent ↑</button><button data-action="child" disabled>Child ↓</button>
            <button data-action="pick" disabled>Pick another</button><button data-action="block" class="block" disabled>Block element</button>
            <button data-action="undo" disabled>Undo</button>
          </div>
          <div class="hint">Enter: block · ↑/↓: adjust selection · Esc: cancel / close<br>Rules apply to this site. Scroll to reach more elements.</div>
        </section>`;
    document.documentElement.appendChild(host);
    try { host.showPopover(); } catch (_) { /* Fixed overlay fallback. */ }
    const panel = root.querySelector('.panel');
    const highlight = root.querySelector('.highlight');
    const status = root.querySelector('.status');
    const selectorLabel = root.querySelector('.selector');
    const buttons = Object.fromEntries(Array.from(root.querySelectorAll('[data-action]'), button => [button.dataset.action, button]));
    let hovered = null;
    let selected = null;
    let selector = '';
    let point = null;
    let raf = 0;
    let busy = false;
    let closed = false;
    const children = [];
    const history = []; // Rule strings only; never retain removed page subtrees.
    const sizeObserver = new ResizeObserver(schedule);

    function pickable(element) {
        return element && element !== host && element !== document.body && element !== document.documentElement &&
            !['head', 'script', 'style', 'link', 'meta'].includes(element.localName);
    }

    function elementAt(x, y) {
        host.style.setProperty('visibility', 'hidden', 'important');
        try {
            let element = document.elementFromPoint(x, y);
            for (let depth = 0; element?.shadowRoot && depth < 32; depth++) {
                const inner = element.shadowRoot.elementFromPoint?.(x, y);
                if (!inner || inner === element) break;
                element = inner;
            }
            return pickable(element) ? element : null;
        } finally { host.style.removeProperty('visibility'); }
    }

    function parentOf(element) {
        const parent = element?.parentElement || element?.getRootNode()?.host;
        return pickable(parent) ? parent : null;
    }

    function updateButtons() {
        buttons.block.disabled = busy || !selected || !selector;
        buttons.parent.disabled = busy || !parentOf(selected);
        buttons.child.disabled = busy || children.length === 0;
        buttons.pick.disabled = busy || !selected;
        buttons.undo.disabled = busy || history.length === 0;
    }

    function draw() {
        raf = 0;
        if (closed) return;
        if (!selected && point) hovered = elementAt(point.x, point.y);
        const element = selected || hovered;
        if (!element?.isConnected) {
            highlight.style.display = 'none';
            if (selected) reset('The selected element was removed. Pick another.');
            hovered = null;
            return;
        }
        const rect = element.getBoundingClientRect();
        Object.assign(highlight.style, { display: 'block', top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        if (!selected) selectorLabel.textContent = element.localName + (element.id ? `#${element.id}` : '');
    }

    function schedule() { if (!closed && !raf) raf = requestAnimationFrame(draw); }

    function reset(message = 'Click an element to preview it.') {
        selected = hovered = null;
        selector = '';
        children.length = 0;
        sizeObserver.disconnect();
        selectorLabel.textContent = '';
        highlight.style.display = 'none';
        status.textContent = message;
        updateButtons();
    }

    function select(element) {
        if (!element?.isConnected || !pickable(element)) return;
        selected = element;
        sizeObserver.disconnect();
        sizeObserver.observe(element);
        try {
            selector = engine.selectorFor(element);
            selectorLabel.textContent = selector.startsWith(engine.SHADOW_PREFIX)
                ? JSON.parse(selector.slice(engine.SHADOW_PREFIX.length)).join(' → ') : selector;
            status.textContent = '1 element selected. Review, then block.';
        } catch (error) { selector = ''; status.textContent = error.message; }
        updateButtons();
        buttons.block.focus({ preventScroll: true });
        schedule();
    }

    async function block() {
        if (busy || !selected?.isConnected || !selector) return;
        // Regenerate after page mutations; preview and saved rule must identify this node.
        try { selector = engine.selectorFor(selected); } catch (error) { status.textContent = error.message; return; }
        const rule = selector;
        busy = true;
        updateButtons();
        status.textContent = 'Saving…';
        try {
            const response = await chrome.runtime.sendMessage({ action: 'blockElement', selector: rule, site: location.hostname });
            if (!response?.ok) throw new Error(response?.error || 'Could not save the rule. Try again.');
            if (response.added) {
                history.push(rule);
                if (history.length > 50) history.shift();
            }
            if (!closed) reset('Blocked on this site. Pick another element or undo.');
        } catch (error) { if (!closed) status.textContent = error.message; }
        finally { busy = false; if (!closed) updateButtons(); }
    }

    async function undo() {
        if (busy || !history.length) return;
        busy = true;
        updateButtons();
        try {
            const response = await chrome.runtime.sendMessage({ action: 'removeBlockedElement', selector: history[history.length - 1], site: location.hostname });
            if (!response?.ok) throw new Error(response?.error || 'Could not undo. Try again.');
            history.pop();
            if (!closed) reset('Last rule removed.');
        } catch (error) { if (!closed) status.textContent = error.message; }
        finally { busy = false; if (!closed) updateButtons(); }
    }

    function action(name) {
        if (name === 'close') return cleanup();
        if (name === 'move') {
            const atTop = panel.style.top === '16px';
            panel.style.top = atTop ? 'auto' : '16px';
            panel.style.bottom = atTop ? '16px' : 'auto';
            return;
        }
        if (busy) return;
        if (name === 'block') block();
        if (name === 'undo') undo();
        if (name === 'pick') reset();
        if (name === 'parent') {
            const parent = parentOf(selected);
            if (parent) { children.push(selected); select(parent); }
        }
        if (name === 'child' && children.length) select(children.pop());
    }

    function intercept(event) {
        const path = event.composedPath();
        // The closed shadow root is opaque to document listeners; handle panel events inside it.
        if (path[0] === host && (root.elementFromPoint(event.clientX, event.clientY)?.closest('.panel') ||
            (event.type === 'click' && event.detail === 0 && root.activeElement?.closest('.panel')))) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === 'click' && event.button === 0 && !busy) {
            const element = elementAt(event.clientX, event.clientY);
            if (element) { children.length = 0; select(element); }
        }
    }

    function cleanup() {
        if (closed) return;
        closed = true;
        controller.abort();
        sizeObserver.disconnect();
        cancelAnimationFrame(raf);
        host.remove();
        selected = hovered = point = null;
        children.length = history.length = 0;
        window.__adzookaPickerActive = false;
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    }

    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu']) {
        window.addEventListener(type, intercept, options);
    }
    // Stop panel actions reaching page handlers while retaining native button behavior.
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu']) {
        panel.addEventListener(type, event => {
            event.stopPropagation();
            if (type === 'click') action(event.target.closest('[data-action]')?.dataset.action);
        }, { signal: controller.signal });
    }
    root.querySelector('.shield').addEventListener('pointermove', event => {
        if (selected || busy) return;
        point = { x: event.clientX, y: event.clientY };
        schedule();
    }, { passive: true, signal: controller.signal });
    window.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault(); event.stopImmediatePropagation();
            if (selected && !busy) reset(); else cleanup();
        } else if (['ArrowUp', 'ArrowDown'].includes(event.key) && selected) {
            event.preventDefault(); event.stopImmediatePropagation();
            action(event.key === 'ArrowUp' ? 'parent' : 'child');
        } else if (event.key === 'Enter' && (!root.activeElement?.matches('button') || root.activeElement.dataset.action === 'block')) {
            event.preventDefault(); event.stopImmediatePropagation(); block();
        } else if (event.key === 'Tab') {
            const focusable = Object.values(buttons).filter(button => !button.disabled);
            const index = focusable.indexOf(root.activeElement);
            event.preventDefault(); event.stopImmediatePropagation();
            focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus();
        }
    }, options);
    window.addEventListener('scroll', schedule, { ...options, passive: true });
    window.addEventListener('resize', schedule, { ...options, passive: true });
    window.addEventListener('pagehide', cleanup, { once: true, signal: controller.signal });
    buttons.close.focus({ preventScroll: true });
})();
