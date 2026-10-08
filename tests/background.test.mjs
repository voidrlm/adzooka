import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../background.js', import.meta.url), 'utf8');
const delay = () => new Promise(resolve => setTimeout(resolve, 1));
function setup() {
    let listener;
    const state = { data: { blockedSelectors: {} }, fail: false };
    const chrome = {
        runtime: { onMessage: { addListener: fn => { listener = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
        storage: { onChanged: { addListener() {} }, local: {
            get: async () => { await delay(); return structuredClone(state.data); },
            set: async updates => { await delay(); if (state.fail) { state.fail = false; throw new Error('Disk full'); } Object.assign(state.data, updates); },
        } },
        scripting: { executeScript: async () => { throw new Error('Cannot access this page'); } },
    };
    vm.runInNewContext(source, { chrome, console, URL });
    return { state, send: (message, sender = {}) => new Promise(resolve => listener(message, sender, resolve)) };
}
test('concurrent picks preserve every rule and duplicate picks do not create undo entries', async () => {
    const { state, send } = setup();
    const results = await Promise.all(Array.from({length:30}, (_, i) => send({action:'blockElement',site:'example.com',selector:`#ad${i}`})));
    assert.ok(results.every(result => result.ok && result.added));
    assert.equal(state.data.blockedSelectors['example.com'].length,30);
    assert.equal((await send({action:'blockElement',site:'example.com',selector:'#ad1'})).added,false);
    await send({action:'removeBlockedElement',site:'example.com',selector:'#ad1'});
    assert.equal(state.data.blockedSelectors['example.com'].length,29);
    assert.equal(state.data.blockedUrls, undefined);
});
test('storage failures reach the picker and do not poison future saves', async () => {
    const { state, send } = setup();
    state.fail = true;
    const failed = await send({action:'blockElement',site:'example.com',selector:'#ad'});
    assert.equal(failed.ok,false);
    assert.match(failed.error,/Disk full/);
    assert.equal((await send({action:'blockElement',site:'example.com',selector:'#ad2'})).ok,true);
    assert.deepEqual(Array.from(state.data.blockedSelectors['example.com']),['#ad2']);
});
test('site scope comes from the sender and restricted-page injection errors are returned', async () => {
    const { state, send } = setup();
    await send({action:'blockElement',site:'wrong.com',selector:'#ad'}, {tab:{id:1},url:'https://right.com/page'});
    assert.equal(state.data.blockedSelectors['wrong.com'],undefined);
    assert.deepEqual(Array.from(state.data.blockedSelectors['right.com']),['#ad']);
    assert.match((await send({action:'startPicker',tabId:1})).error,/Cannot access/);
});
test('malformed imports leave existing rules intact; legacy imports and clearing a site work', async () => {
    const { state, send } = setup();
    await send({action:'blockElement',site:'example.com',selector:'#ad'});
    assert.equal((await send({action:'importRules',data:{blockedSelectors:{'example.com':'bad'}}})).ok,false);
    assert.deepEqual(Array.from(state.data.blockedSelectors['example.com']),['#ad']);
    assert.equal((await send({action:'importRules',data:{blockedUrls:[null,{hostname:'ads.example.com'}],blockedSelectors:{'example.com':[null,{selector:'#legacy'},'#legacy']}}})).ok,true);
    assert.deepEqual(Array.from(state.data.blockedSelectors['example.com']),['#legacy']);
    await send({action:'clearBlockedElements',site:'example.com'});
    assert.equal(state.data.blockedSelectors['example.com'],undefined);
});
