import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let browser, profile, session, sequence = 0, buffer = '';
const pending = new Map();
function command(method, params = {}, sessionId = session) {
    return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 10000);
        pending.set(id, { resolve, reject, timeout });
        browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
}
async function evaluate(expression) {
    const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: false });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
}
async function inject(file) { return evaluate(await readFile(new URL('../' + file, import.meta.url), 'utf8')); }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function click(x, y) {
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function key(key, code = key) {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
}
async function setup(markup = '') {
    await command('Page.navigate', { url: 'about:blank' });
    await delay(40);
    await evaluate(`document.body.innerHTML = ${JSON.stringify(markup)};
        window.store = { blockedSelectors: {}, disabledSites: [] };
        window.storageListeners = [];
        window.messages = [];
        window.failSave = false;
        window.chrome = { storage: {
            local: {
                get: async () => structuredClone(window.store),
                set: async updates => {
                    const changes = {};
                    for (const [key, value] of Object.entries(updates)) {
                        changes[key] = { oldValue: store[key], newValue: value }; store[key] = value;
                    }
                    for (const listener of storageListeners) listener(changes, 'local');
                }
            }, onChanged: { addListener: listener => storageListeners.push(listener) }
        }, runtime: { sendMessage: async message => {
            messages.push(message);
            if (failSave) return { ok: false, error: 'Test storage failure' };
            const map = structuredClone(store.blockedSelectors);
            const list = map[location.hostname] || [];
            const added = !list.includes(message.selector);
            map[location.hostname] = message.action === 'removeBlockedElement'
                ? list.filter(rule => rule !== message.selector) : [...new Set([...list, message.selector])];
            await chrome.storage.local.set({ blockedSelectors: map });
            return { ok: true, added };
        } } };
        // Test-only instrumentation: preserve access to the closed picker root.
        window.originalAttachShadow = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function(options) {
            const root = originalAttachShadow.call(this, options);
            if (options.mode === 'closed') window.pickerRoot = root;
            return root;
        };
    `);
    await inject('element-rules.js');
}
async function panelAction(name) {
    const rect = await evaluate(`(() => { const r = pickerRoot.querySelector('[data-action="${name}"]').getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`);
    await click(rect.x, rect.y);
    await delay(30);
}

before(async () => {
    profile = await mkdtemp(join(tmpdir(), 'adzooka-browser-'));
    browser = spawn(process.env.CHROME_PATH || '/usr/bin/google-chrome', [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-extensions', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
    ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    let errors = '';
    browser.stderr.on('data', data => { errors += data; });
    browser.stdio[4].on('data', data => {
        buffer += data.toString();
        let boundary;
        while ((boundary = buffer.indexOf('\0')) !== -1) {
            const message = JSON.parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1);
            const waiter = pending.get(message.id);
            if (!waiter) continue;
            clearTimeout(waiter.timeout); pending.delete(message.id);
            if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
        }
    });
    browser.on('exit', () => {
        for (const waiter of pending.values()) { clearTimeout(waiter.timeout); waiter.reject(new Error(errors)); }
        pending.clear();
    });
    const { targetId } = await command('Target.createTarget', { url: 'about:blank' }, null);
    ({ sessionId: session } = await command('Target.attachToTarget', { targetId, flatten: true }, null));
    await command('Page.enable');
    await command('Emulation.setDeviceMetricsOverride', { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
});
after(async () => {
    if (browser && browser.exitCode === null) {
        const exited = new Promise(resolve => browser.once('exit', resolve));
        browser.kill(); await exited;
    }
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('exact selectors handle duplicate classes, escaped IDs, lazy images and iframe containers', async () => {
    await setup('<div class="card">A</div><div class="card">B</div><div id="123:a.b">C</div><img data-lazy-src="/a.png"><section id="container"><iframe></iframe></section>');
    assert.equal(await evaluate(`Array.from(document.body.children).every(el => {
        const rule = __adzookaUserRules.selectorFor(el);
        const resolved = __adzookaUserRules.resolve(rule);
        const matches = resolved.root.querySelectorAll(resolved.selector);
        return matches.length === 1 && matches[0] === el;
    })`), true);
    assert.equal(await evaluate(`__adzookaUserRules.selectorFor(document.querySelector('#container'))`), '#container');
});

test('native hit testing respects stacking contexts, blocks clicks, and saves only after confirmation', async () => {
    await setup('<a id="lower" href="https://example.com" style="position:absolute;left:20px;top:20px;width:150px;height:100px;z-index:1">lower</a><div style="position:absolute;left:20px;top:20px;z-index:2"><div id="upper" style="width:150px;height:100px;background:red">upper</div></div>');
    await evaluate('window.pageClicks=0; document.addEventListener("click",()=>pageClicks++); window.rectReads=0; const rect=Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect=function(){rectReads++;return rect.call(this)};');
    await inject('content-picker.js');
    await click(50, 50);
    assert.equal(await evaluate('pickerRoot.querySelector(".selector").textContent'), '#upper');
    assert.equal(await evaluate('messages.length'), 0);
    assert.equal(await evaluate('pageClicks'), 0);
    assert.ok(await evaluate('rectReads') < 20);
    await panelAction('block');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#upper")).display'), 'none');
    assert.equal(await evaluate('document.querySelector("#upper").isConnected'), true);
    assert.notEqual(await evaluate('getComputedStyle(document.querySelector("#lower")).display'), 'none');
    await panelAction('undo');
    assert.notEqual(await evaluate('getComputedStyle(document.querySelector("#upper")).display'), 'none');
    assert.equal(await evaluate('pageClicks'), 0);
});

test('parent/child selection, failure recovery, keyboard blocking, and repeat-session cleanup', async () => {
    await setup('<div id="parent" style="position:absolute;left:20px;top:20px;padding:20px"><span id="child" style="display:block;width:100px;height:60px">pick</span></div>');
    await inject('content-picker.js');
    await click(60,60);
    await key('ArrowUp');
    assert.equal(await evaluate('pickerRoot.querySelector(".selector").textContent'), '#parent');
    await key('ArrowDown');
    assert.equal(await evaluate('pickerRoot.querySelector(".selector").textContent'), '#child');
    await evaluate('failSave=true');
    await panelAction('block');
    assert.match(await evaluate('pickerRoot.querySelector(".status").textContent'), /failure/);
    assert.notEqual(await evaluate('getComputedStyle(document.querySelector("#child")).display'), 'none');
    await evaluate('failSave=false');
    await key('Enter');
    await delay(30);
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#child")).display'), 'none');
    await panelAction('undo');
    for (let i=0;i<5;i++) {
        await panelAction('close');
        assert.equal(await evaluate('window.__adzookaPickerActive'), false);
        assert.equal(await evaluate('document.querySelectorAll("[popover]").length'), 0);
        await inject('content-picker.js');
    }
    await panelAction('close');
    assert.equal(await evaluate('storageListeners.length'), 1);
    assert.equal(await evaluate('document.querySelectorAll("[data-adzooka-rules]").length'), 0);
});

test('nested shadow rules survive host replacement and restore on pause or removal', async () => {
    await setup('<div id="host"></div>');
    await evaluate(`window.makeShadow = () => {
        const outer = document.querySelector('#host').attachShadow({mode:'open'});
        outer.innerHTML = '<div id="nested"></div>';
        const inner = outer.querySelector('#nested').attachShadow({mode:'open'});
        inner.innerHTML = '<span id="ad">ad</span><span id="keep">keep</span>';
        return inner;
    }; window.inner = makeShadow(); window.rule = __adzookaUserRules.selectorFor(inner.querySelector('#ad'));
    chrome.storage.local.set({ blockedSelectors: { [location.hostname]: [rule] } });`);
    assert.equal(await evaluate('getComputedStyle(inner.querySelector("#ad")).display'), 'none');
    assert.notEqual(await evaluate('getComputedStyle(inner.querySelector("#keep")).display'), 'none');
    await evaluate('document.querySelector("#host").replaceWith(Object.assign(document.createElement("div"),{id:"host"})); inner=makeShadow();');
    await delay(160);
    assert.equal(await evaluate('getComputedStyle(inner.querySelector("#ad")).display'), 'none');
    await evaluate('chrome.storage.local.set({disabledSites:[location.hostname]})');
    assert.notEqual(await evaluate('getComputedStyle(inner.querySelector("#ad")).display'), 'none');
    await evaluate('chrome.storage.local.set({disabledSites:[]})');
    assert.equal(await evaluate('getComputedStyle(inner.querySelector("#ad")).display'), 'none');
    await evaluate('chrome.storage.local.set({blockedSelectors:{}})');
    assert.notEqual(await evaluate('getComputedStyle(inner.querySelector("#ad")).display'), 'none');
    assert.equal(await evaluate('inner.querySelectorAll("style").length'), 0);
});

test('picker targets nested shadow content and an iframe itself', async () => {
    await setup('<div id="host" style="position:absolute;left:20px;top:20px"></div><iframe id="frame" style="position:absolute;left:300px;top:20px;width:150px;height:100px"></iframe>');
    await evaluate(`document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<div id="ad" style="width:100px;height:100px;background:red">ad</div>';`);
    await inject('content-picker.js');
    await click(50,50);
    assert.match(await evaluate('pickerRoot.querySelector(".selector").textContent'), /#host → #ad/);
    await panelAction('block');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#host").shadowRoot.querySelector("#ad")).display'), 'none');
    await click(350,50);
    assert.equal(await evaluate('pickerRoot.querySelector(".selector").textContent'), '#frame');
    await panelAction('block');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#frame")).display'), 'none');
});

test('malformed imports do not prevent valid rules or corrupt page styles', async () => {
    await setup('<div id="ad">ad</div><div id="safe">safe</div>');
    await evaluate(`chrome.storage.local.set({blockedSelectors:{[location.hostname]:['[invalid','adzooka-shadow:bad','#ad','body { color: red; }']}})`);
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#ad")).display'), 'none');
    assert.notEqual(await evaluate('getComputedStyle(document.querySelector("#safe")).display'), 'none');
});

test('popup toggle updates live, respects site pause, and preserves same-window navigation', async () => {
    await setup();
    await evaluate('window.openCalls=[]; window.open=function(...args){openCalls.push(args); return "native-result";}');
    await inject('popup-guard.js');
    await inject('popup-settings.js');
    assert.equal(await evaluate('window.open("https://example.com")'), null);
    assert.equal(await evaluate('window.open("/login", "oauth")'), null);
    assert.equal(await evaluate('window.open("/next", "_self")'), 'native-result');
    await evaluate('chrome.storage.local.set({popupBlockingEnabled:false})');
    assert.equal(await evaluate('window.open("/login")'), 'native-result');
    await evaluate('chrome.storage.local.set({popupBlockingEnabled:true, disabledSites:[location.hostname]})');
    assert.equal(await evaluate('window.open("/login")'), 'native-result');
    await evaluate('chrome.storage.local.set({disabledSites:[]})');
    assert.equal(await evaluate('window.open("/login")'), null);
});

test('important inline display is blocked and restored without overwriting other inline styles', async () => {
    await setup('<div id="ad" style="display:flex!important;color:red">ad</div>');
    await evaluate('chrome.storage.local.set({blockedSelectors:{[location.hostname]:["#ad"]}})');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#ad")).display'), 'none');
    await evaluate('document.querySelector("#ad").style.color="blue"');
    await delay(120);
    await evaluate('chrome.storage.local.set({blockedSelectors:{}})');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#ad")).display'), 'flex');
    assert.equal(await evaluate('document.querySelector("#ad").style.getPropertyPriority("display")'), 'important');
    assert.equal(await evaluate('document.querySelector("#ad").style.color'), 'blue');
});

test('hover on a large page uses bounded geometry reads', async () => {
    await setup('<div id="target" style="position:fixed;left:20px;top:20px;width:150px;height:100px;z-index:100;background:red"></div>');
    await evaluate(`const fragment=document.createDocumentFragment();
        for(let i=0;i<10000;i++) fragment.appendChild(document.createElement('span'));
        document.body.appendChild(fragment);
        window.rectReads=0; const original=Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect=function(){rectReads++;return original.call(this)};`);
    await inject('content-picker.js');
    await command('Input.dispatchMouseEvent', {type:'mouseMoved',x:50,y:50});
    await delay(40);
    assert.equal(await evaluate('pickerRoot.querySelector(".selector").textContent'), 'div#target');
    assert.ok(await evaluate('rectReads') < 10);
    await panelAction('close');
});

test('popup controls persist settings, reflect site pause and report picker startup errors', async () => {
    await setup();
    const html = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
    await evaluate(`document.body.innerHTML=${JSON.stringify(html.match(/<body>([\s\S]*?)<\/body>/)[1])};
        chrome.tabs={ query:async()=>[{id:1,url:'https://example.com/page'}] };
        chrome.runtime.sendMessage=async()=>({ok:false,error:'Cannot access this page'});
        window.close=()=>{window.didClose=true};`);
    await inject('popup.js');
    await evaluate('document.querySelector("#popup-toggle").click()');
    assert.equal(await evaluate('store.popupBlockingEnabled'), false);
    await evaluate('chrome.storage.local.set({popupBlockingEnabled:true, disabledSites:["example.com"]})');
    assert.equal(await evaluate('document.querySelector("#popup-toggle").checked'), true);
    assert.equal(await evaluate('document.querySelector("#picker-btn").disabled'), true);
    await evaluate('chrome.storage.local.set({disabledSites:[]})');
    await evaluate('document.querySelector("#picker-btn").click()');
    assert.match(await evaluate('document.querySelector("#notice").textContent'), /Cannot access/);
    assert.equal(await evaluate('!!window.didClose'), false);
});

test('popup settings cross the isolated-world boundary regardless of injection order', async () => {
    await setup();
    await evaluate('window.open=function(){return "native-result"}');
    const { frameTree } = await command('Page.getFrameTree');
    const { executionContextId } = await command('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'adzooka-test' });
    const isolated = async expression => {
        const response = await command('Runtime.evaluate', {expression,contextId:executionContextId,awaitPromise:true,returnByValue:true});
        if(response.exceptionDetails) throw new Error(response.exceptionDetails.text);
        return response.result.value;
    };
    await isolated(`window.changeSetting=null;window.chrome={storage:{local:{get:async()=>({popupBlockingEnabled:true})},onChanged:{addListener:fn=>window.changeSetting=fn}}}`);
    await isolated(await readFile(new URL('../popup-settings.js', import.meta.url), 'utf8'));
    await inject('popup-guard.js');
    assert.equal(await evaluate('window.open("/test")'), null);
    await isolated('changeSetting({popupBlockingEnabled:{newValue:false}},"local")');
    assert.equal(await evaluate('window.open("/test")'), 'native-result');
});
