// dsh-sidebar-marks — 自测。
//
// 在 mock 出来的最小 DOM 上加载**真实的** lib/client.js（走真实的
// `window.__ModuleLoader__.load` 注册路径），覆盖：
//   · 模块形状（id 必须等于包名、平铺导出 apply/inject、import 期间零副作用）
//   · apply() 的世界可见副作用（样式表 data-plugin、调试全局、快捷键与右键监听、两个插槽）
//   · 行标注引擎：mark -> 行属性 + 浓度自定义属性（幂等、可清除、未标记的行一个字节都不动）
//   · 深色主题自动加强：--dshmk-mix / --dshmk-mix-dark 两个值都写进行元素
//   · 交互：⌘/Ctrl+Shift+M 打开当前对话面板、右键任意对话行打开面板、可编辑区里不抢键
//   · 持久化：序列化往返、坏数据 / 旧版字段被丢弃、storage 事件同步
//   · 标签点渲染条件、菜单项文案、面板预览行
//   · dispose() 清干净（样式表、全局、observer、四类监听器、面板）
//
// 运行：node --test test/verify.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(here, '..', 'lib', 'client.js');
const SOURCE = readFileSync(BUNDLE, 'utf8');

// ---------------------------------------------------------------------------
// 最小 DOM
// ---------------------------------------------------------------------------

function kebab(name) {
  return 'data-' + String(name).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

/** 跨 vm realm 比较用：把插件返回的对象变成当前 realm 的普通对象。 */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeStyle() {
  const props = new Map();
  return {
    props,
    setProperty(k, v) { props.set(k, String(v)); },
    removeProperty(k) { props.delete(k); },
    getPropertyValue(k) { return props.get(k) || ''; }
  };
}

class MockNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.style = makeStyle();
    this.listeners = new Map();
    this.parentNode = null;
    this.className = '';
    this.value = '';
    this.title = '';
    this.isContentEditable = false;
    this._text = '';
    const self = this;
    // dataset 如实代理到 data-* 属性（真实 DOM 就是这个行为）。
    this.dataset = new Proxy({}, {
      get: (_, key) => {
        const attr = kebab(key);
        return attr in self.attributes ? self.attributes[attr] : undefined;
      },
      set: (_, key, value) => { self.setAttribute(kebab(key), value); return true; },
      deleteProperty: (_, key) => { self.removeAttribute(kebab(key)); return true; },
      has: (_, key) => kebab(key) in self.attributes
    });
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get firstChild() { return this.children[0] || null; }
  appendChild(node) { this.children.push(node); node.parentNode = this; return node; }
  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) this.parentNode.children.splice(i, 1);
    this.parentNode = null;
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  dispatch(type, event = {}) {
    (this.listeners.get(type) || []).slice().forEach((fn) => fn(event));
  }
  querySelectorAll(selector) { return descendants(this).filter((n) => matches(n, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    let node = this;
    while (node) {
      if (matches(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
}

function descendants(root) {
  const out = [];
  const walk = (node) => { node.children.forEach((child) => { out.push(child); walk(child); }); };
  walk(root);
  return out;
}

/** 支持 `tag`、`[attr]`、`[attr="v"]`、`[attr^="v"]` 及其任意串联（用于 `[a^="x"][b="y"]`）。 */
function matches(node, selector) {
  const m = /^([a-z]*)((?:\s*\[[a-z-]+(?:\^?="[^"]*")?\])+)$/.exec(String(selector).trim());
  if (!m) return false;
  const tag = m[1];
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  const clauses = m[2].match(/\[[^\]]+\]/g) || [];
  return clauses.every((clause) => {
    const inner = clause.slice(1, -1);
    let mm = /^([a-z-]+)\^="([^"]*)"$/.exec(inner);
    if (mm) {
      const value = node.getAttribute(mm[1]);
      return typeof value === 'string' && value.startsWith(mm[2]);
    }
    mm = /^([a-z-]+)="([^"]*)"$/.exec(inner);
    if (mm) return node.getAttribute(mm[1]) === mm[2];
    mm = /^([a-z-]+)$/.exec(inner);
    if (mm) return node.getAttribute(mm[1]) !== null;
    return false;
  });
}

function makeDocument() {
  const head = new MockNode('head');
  const body = new MockNode('body');
  const documentElement = new MockNode('html');
  documentElement.lang = 'zh-CN';   // 模拟 dsh-client-locale 写入的 <html lang>
  documentElement.appendChild(head);
  documentElement.appendChild(body);
  const docListeners = new Map();
  return {
    head,
    body,
    documentElement,
    createElement: (tag) => new MockNode(tag),
    querySelector: (sel) => descendants(documentElement).find((n) => matches(n, sel)) || null,
    querySelectorAll: (sel) => descendants(documentElement).filter((n) => matches(n, sel)),
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = docListeners.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatch(type, event = {}) { (docListeners.get(type) || []).slice().forEach((fn) => fn(event)); },
    listenerCount(type) { return (docListeners.get(type) || []).length; }
  };
}

class MockMutationObserver {
  constructor(callback) { this.callback = callback; this.disconnected = false; this.observed = null; }
  observe(target, options) { this.observed = { target, options }; }
  disconnect() { this.disconnected = true; }
}

function makeLocalStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map
  };
}

/** 加载真实 bundle，返回 { plugin, window, document, storage, observers }。 */
function loadBundle(options = {}) {
  const document = makeDocument();
  const storage = makeLocalStorage(options.seed || {});
  const winListeners = new Map();
  const observers = [];
  const window = {
    document,
    localStorage: storage,
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = winListeners.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatchStorage(event) { (winListeners.get('storage') || []).slice().forEach((fn) => fn(event)); },
    windowListenerCount(type) { return (winListeners.get(type) || []).length; }
  };
  window.window = window;

  const registrations = [];
  window.__ModuleLoader__ = { load(entry) { registrations.push(entry); } };

  const sandbox = {
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    navigator: { platform: options.platform || 'MacIntel', userAgent: 'node' },
    MutationObserver: class extends MockMutationObserver {
      constructor(cb) { super(cb); observers.push(this); }
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: BUNDLE });

  assert.equal(registrations.length, 1, 'bundle 只应注册一个 ModuleLoader 条目');
  const reactStub = {
    createElement: (type, props, children) => ({ type, props, children }),
    useState: (init) => [init, () => {}],
    useEffect: () => {}
  };
  const menuItemStub = function MenuItemButton() { return null; };
  const requireStub = (name) => {
    if (name === 'react') return reactStub;
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { MenuItemButton: menuItemStub };
    throw new Error('unexpected require: ' + name);
  };
  const plugin = registrations[0].factory(requireStub);
  return { entry: registrations[0], plugin, window, document, storage, observers, reactStub, menuItemStub };
}

/** 造一行对话 DOM：结构与 DSH 一致（slot + title + time）。 */
function addRow(document, sessionId, extras = {}) {
  const row = document.createElement('div');
  row.setAttribute('data-row-key', 'session:' + sessionId);
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-selected', extras.selected ? 'true' : 'false');
  const slot = document.createElement('span');
  const title = document.createElement('span');
  title.textContent = extras.title || '会话 ' + sessionId;
  const time = document.createElement('span');
  time.textContent = '刚刚';
  row.appendChild(slot);
  row.appendChild(title);
  row.appendChild(time);
  (extras.host || document.body).appendChild(row);
  return { row, slot, title, time };
}

/** apply() 用的 ctx 桩：记录注册与 effect。 */
function makeCtx() {
  const registered = [];
  const injections = [];
  const effects = [];
  const ctx = {
    slots: {
      inject(name, callback) {
        injections.push(name);
        const disposer = callback();
        return () => { if (typeof disposer === 'function') disposer(); };
      },
      register(options, component) {
        registered.push({ options, component });
        return () => {};
      }
    },
    effect(fn, label) {
      const cleanup = fn();
      effects.push({ label, cleanup });
      return () => { if (typeof cleanup === 'function') cleanup(); };
    }
  };
  return { ctx, registered, injections, effects };
}

function keyEvent(over = {}) {
  return Object.assign({
    key: 'm', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false,
    defaultPrevented: false, target: null,
    preventDefault() { this.defaultPrevented = true; }
  }, over);
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

test('模块形状：id 等于包名、平铺导出 apply/inject、没有 default', () => {
  const { entry, plugin } = loadBundle();
  assert.equal(entry.id, 'dsh-sidebar-marks', 'ModuleLoader id 必须等于 package.json 的 name');
  assert.equal(typeof entry.factory, 'function');
  assert.equal(typeof plugin.apply, 'function');
  assert.deepEqual([...plugin.inject], ['slots']);
  assert.equal(plugin.default, undefined, '不要 export default（会丢 inject）');
});

test('import 期间零副作用：不碰 DOM、不挂全局', () => {
  const { window, document } = loadBundle();
  assert.equal(document.querySelector('style[data-plugin-css="dsh-sidebar-marks/style"]'), null);
  assert.equal(window.__dshSidebarMarks, undefined);
  assert.equal(document.listenerCount('keydown'), 0);
});

test('apply()：样式表带 data-plugin、注册两个插槽、装快捷键与右键、挂调试句柄', () => {
  const { plugin, window, document } = loadBundle();
  const { ctx, registered, injections } = makeCtx();
  plugin.apply(ctx);

  const tag = document.querySelector('style[data-plugin-css="dsh-sidebar-marks/style"]');
  assert.ok(tag, '样式表必须存在');
  assert.equal(tag.dataset.plugin, 'dsh-sidebar-marks', '必须自己打 data-plugin，否则会被别的插件认领');
  assert.match(tag.textContent, /data-row-key\^="session:"/);

  assert.deepEqual(injections, ['sidebar.session.row.leading', 'sidebar.workspaces.session.menu.item']);
  assert.equal(registered.length, 2);
  assert.equal(registered[0].options.id, 'dsh-sidebar-marks:dot');
  assert.equal(registered[1].options.id, 'dsh-sidebar-marks:mark-item');
  assert.equal(registered[1].options.order, 350);

  assert.equal(document.listenerCount('keydown'), 1);
  assert.equal(document.listenerCount('contextmenu'), 1);
  assert.ok(window.__dshSidebarMarks, '调试句柄应挂出');
  assert.equal(window.__dshSidebarMarks.storageKey, 'dsh.sidebar-marks.v1');
});

test('apply() 幂等：重复装载不会插入第二张样式表', () => {
  const { plugin, document } = loadBundle();
  plugin.apply(makeCtx().ctx);
  plugin.apply(makeCtx().ctx);
  assert.equal(document.querySelectorAll('style[data-plugin-css="dsh-sidebar-marks/style"]').length, 1);
});

test('normalizeMark：收敛非法值；没有任何可见效果时返回 null', () => {
  const { plugin } = loadBundle();
  const n = plugin.__internals.normalizeMark;
  assert.equal(n(null), null);
  assert.equal(n({}), null);
  assert.equal(n({ color: 'chartreuse', fill: 10 }), null, '未知颜色被丢弃 -> 没有可见效果');
  assert.deepEqual(plain(n({ color: 'blue', fill: 10, dots: 'right', size: 'inherit' })),
    { color: 'blue', fill: 10, dots: 'right', size: 'inherit' });
  assert.equal(n({ color: 'blue', fill: 0, dots: 'none', size: 'inherit' }), null, '不上色也不改字号 = 没有标记');
  assert.equal(n({ color: 'blue', fill: 99 }).fill, 30, '浓度夹在 0–30');
  assert.equal(n({ color: 'blue', fill: -3 }), null, '浓度夹到 0 之后就没有可见效果 = 没有标记');
  assert.deepEqual(plain(n({ color: 'blue', size: 15 })), { color: 'blue', size: 'l' }, '数字字号也接受');
  assert.deepEqual(plain(n({ size: 'xl' })), { size: 'xl' }, '只改字号也是合法标记（不带颜色）');
  assert.equal(n({ color: 'blue', fill: 10, dots: 'weird' }).dots, undefined);
  assert.equal(n({ color: 'blue', fill: 10, weight: 900 }).weight, undefined, '非法字重被丢弃');
});

test('rowAttributes：淡色底 / 圆点 / 字号 -> 行属性 + 深浅两套浓度变量', () => {
  const { plugin } = loadBundle();
  const { rowAttributes } = plugin.__internals;

  assert.equal(rowAttributes(null), null);
  assert.equal(rowAttributes({ color: 'blue', fill: 0, dots: 'none', size: 'inherit' }), null);

  const full = rowAttributes({ color: 'red', fill: 16, dots: 'both', size: 'l', weight: 500 });
  assert.equal(full.attrs['data-dshmk'], '1');
  assert.equal(full.attrs['data-dshmk-color'], 'red');
  assert.equal(full.attrs['data-dshmk-fill'], '1');
  assert.equal(full.attrs['data-dshmk-dots'], 'both');
  assert.equal(full.attrs['data-dshmk-size'], 'l');
  assert.equal(full.attrs['data-dshmk-weight'], '500');
  assert.equal(full.style['--dshmk-mix'], '16%');
  assert.equal(full.style['--dshmk-mix-dark'], '20%', '深色主题自动 +4 个点');
  assert.equal(full.style['--dshmk-color-light'], '#ef4444', '预设色的浅色值写进行元素');
  assert.equal(full.style['--dshmk-color-dark'], '#f25a5a', '预设色的深色值写进行元素');

  const dotsOnly = rowAttributes({ color: 'green', fill: 0, dots: 'right', size: 'inherit' });
  assert.equal(dotsOnly.attrs['data-dshmk-fill'], '0');
  assert.equal(Object.keys(dotsOnly.style).length, 2, '没有淡色底时就只写两个颜色变量');
  assert.equal(dotsOnly.attrs['data-dshmk-dots'], 'right');

  const sizeOnly = rowAttributes({ size: 'xl' });
  assert.equal(sizeOnly.attrs['data-dshmk-color'], undefined, '不带颜色就不写颜色属性');
  assert.equal(sizeOnly.attrs['data-dshmk-size'], 'xl');
  assert.equal(sizeOnly.attrs['data-dshmk-fill'], '0');

  assert.equal(rowAttributes({ color: 'blue', fill: 30 }).style['--dshmk-mix-dark'], '30%', '加强后不超过 30%');
});

test('行标注：标记 -> 行属性与自定义属性；清除后全部摘掉', () => {
  const { plugin, document } = loadBundle();
  const { row } = addRow(document, 's1');
  const { setMark, clearMark, annotateRows } = plugin.__internals;

  setMark('s1', { color: 'amber', fill: 12, dots: 'right', size: 'inherit' });
  annotateRows();
  assert.equal(row.getAttribute('data-dshmk'), '1');
  assert.equal(row.getAttribute('data-dshmk-color'), 'amber');
  assert.equal(row.getAttribute('data-dshmk-fill'), '1');
  assert.equal(row.getAttribute('data-dshmk-dots'), 'right');
  assert.equal(row.style.getPropertyValue('--dshmk-mix'), '12%');
  assert.equal(row.style.getPropertyValue('--dshmk-mix-dark'), '16%');

  clearMark('s1');
  annotateRows();
  ['data-dshmk', 'data-dshmk-color', 'data-dshmk-fill', 'data-dshmk-dots', 'data-dshmk-size', 'data-dshmk-weight']
    .forEach((name) => assert.equal(row.getAttribute(name), null, name + ' 应被摘掉'));
  assert.equal(row.style.getPropertyValue('--dshmk-mix'), '');
  assert.equal(row.style.getPropertyValue('--dshmk-mix-dark'), '');
});

test('默认观感：未标记的行不会被写任何属性，非对话行也不受影响', () => {
  const { plugin, document } = loadBundle();
  const a = addRow(document, 's1');
  const ws = document.createElement('div');
  ws.setAttribute('data-row-key', 'workspace:w1');
  document.body.appendChild(ws);
  plugin.__internals.setMark('s2', { color: 'red', fill: 10, dots: 'right', size: 'inherit' });
  const marked = plugin.__internals.annotateRows();
  assert.equal(marked, 0, 's2 没有对应的行');
  assert.equal(a.row.getAttribute('data-dshmk'), null, '未标记的行必须一个字节都不动');
  assert.equal(ws.getAttribute('data-dshmk'), null, '工作区行不该被标注');
});

test('行标注：已归档、运行中的行照样标注（淡色底与字号不依赖插槽）', () => {
  const { plugin, document } = loadBundle();
  const archived = addRow(document, 'a1');
  const running = addRow(document, 'r1');
  plugin.__internals.setMark('a1', { color: 'slate', fill: 10, dots: 'left', size: 'inherit' });
  plugin.__internals.setMark('r1', { color: 'amber', fill: 22, dots: 'right', size: 'inherit' });
  assert.equal(plugin.__internals.annotateRows(), 2);
  assert.equal(archived.row.getAttribute('data-dshmk-fill'), '1');
  assert.equal(running.row.getAttribute('data-dshmk-dots'), 'right');
  assert.equal(running.row.style.getPropertyValue('--dshmk-mix'), '22%');
});

test('左侧圆点只在 dots 为 left/both 且有颜色时渲染', () => {
  const { plugin } = loadBundle();
  const v = plugin.__internals.leftDotVisible;
  assert.equal(v(null), false);
  assert.equal(v({ dots: 'left' }), false, '没有颜色就没有圆点');
  assert.equal(v({ color: 'blue', dots: 'right' }), false);
  assert.equal(v({ color: 'blue', dots: 'none' }), false);
  assert.equal(v({ color: 'blue', dots: 'left' }), true);
  assert.equal(v({ color: 'blue', dots: 'both' }), true);
});

test('菜单项文案随标记状态变化', () => {
  const { plugin } = loadBundle();
  assert.equal(plugin.__internals.menuLabel(null), '标记…');
  assert.equal(plugin.__internals.menuLabel({ color: 'blue' }), '编辑标记…');
});

test('快捷键 ⌘/Ctrl+Shift+M：打开当前对话的面板，输入框里不抢键', () => {
  const { plugin, document } = loadBundle();
  plugin.apply(makeCtx().ctx);
  addRow(document, 's1', { selected: true, title: '当前对话' });
  assert.equal(plugin.__internals.currentSessionId(), 's1');

  const ev = keyEvent();
  document.dispatch('keydown', ev);
  assert.equal(ev.defaultPrevented, true, '命中快捷键时应当 preventDefault');
  const panel = plugin.__internals.getPanel();
  assert.ok(panel, '应打开面板');
  assert.equal(panel.card.children[1].textContent.includes('当前对话'), true, '面板标题取自当前行');
  plugin.__internals.closePanel();

  const input = document.createElement('textarea');
  document.body.appendChild(input);
  document.dispatch('keydown', keyEvent({ target: input }));
  assert.equal(plugin.__internals.getPanel(), null, '可编辑区里不该抢键');

  document.dispatch('keydown', keyEvent({ shiftKey: false }));
  assert.equal(plugin.__internals.getPanel(), null, '少了 shift 不触发');

  document.querySelector('[data-row-key="session:s1"]').setAttribute('aria-selected', 'false');
  document.dispatch('keydown', keyEvent());
  assert.equal(plugin.__internals.getPanel(), null, '没有选中行不触发');
});

test('右键任意对话行打开该行面板，其他区域不拦截', () => {
  const { plugin, document } = loadBundle();
  plugin.apply(makeCtx().ctx);
  const { row, title } = addRow(document, 's7', { title: '右键这条' });
  const ev = { target: title, preventDefault() { this.prevented = true; } };
  document.dispatch('contextmenu', ev);
  assert.equal(ev.prevented, true);
  const panel = plugin.__internals.getPanel();
  assert.ok(panel);
  assert.match(panel.card.children[1].textContent, /右键这条/);
  plugin.__internals.closePanel();

  const outside = { target: document.body, preventDefault() { this.prevented = true; } };
  document.dispatch('contextmenu', outside);
  assert.equal(outside.prevented, undefined, '非对话行不该被拦截');
  assert.equal(plugin.__internals.getPanel(), null);
  assert.ok(row);
});

test('面板：内容完整、预览行带标记属性与浓度变量、Esc 与遮罩都能关', () => {
  const { plugin, document } = loadBundle();
  plugin.apply(makeCtx().ctx);
  addRow(document, 's1', { selected: true, title: '被标记的对话' });
  plugin.__internals.openPanel('s1', '被标记的对话');
  const panel = plugin.__internals.getPanel();
  const texts = descendants(panel.card).map((n) => n.textContent);
  assert.ok(texts.includes('对话标记'));
  assert.ok(texts.some((t) => t.includes('整行淡色底浓度')), '浓度选项');
  assert.ok(texts.includes('最右侧'), '圆点位置选项');
  assert.ok(texts.includes('原样'), '字号原样选项');

  const preview = document.querySelector('[data-row-key="session:__preview"]');
  assert.ok(preview, '面板里应有实时预览行');
  assert.equal(preview.getAttribute('data-dshmk'), '1');
  assert.equal(preview.getAttribute('data-dshmk-fill'), '1');
  assert.equal(preview.getAttribute('data-dshmk-dots'), 'right');
  assert.equal(preview.style.getPropertyValue('--dshmk-mix'), '10%');
  assert.equal(preview.style.getPropertyValue('--dshmk-mix-dark'), '14%');

  document.dispatch('keydown', { key: 'Escape' });
  assert.equal(plugin.__internals.getPanel(), null, 'Esc 应关闭面板');
  assert.equal(document.querySelector('div[data-dshmk-panel="1"]'), null);

  plugin.__internals.openPanel('s1', 'x');
  plugin.__internals.getPanel().root.dispatch('click', {});
  assert.equal(plugin.__internals.getPanel(), null, '点遮罩应关闭面板');
});

test('持久化：写盘 -> 读回一致；坏数据与旧版字段被丢弃', () => {
  const { plugin, storage } = loadBundle();
  const { setMark, saveMarks, parse, loadMarks, getMarks, setMarks } = plugin.__internals;
  setMark('s1', { color: 'red', fill: 16, dots: 'both', size: 'l', weight: 500 });
  setMark('s2', { color: 'green', fill: 10, dots: 'right', size: 'inherit' });
  assert.equal(saveMarks(), true);
  assert.match(storage.getItem('dsh.sidebar-marks.v1'), /"version":2/);

  setMarks(Object.create(null));
  loadMarks();
  assert.deepEqual(Object.keys(getMarks()).sort(), ['s1', 's2']);
  assert.equal(getMarks().s1.fill, 16);
  assert.equal(getMarks().s1.color, 'red');

  const polluted = parse(JSON.stringify({
    version: 1,
    marks: {
      ok: { color: 'blue', fill: 10, dots: 'right' },
      legacy: { color: 'blue', block: 'tint', dot: 'ring', strength: 12 }, // 旧版字段：没有 fill/dots -> 不可见
      bad: { color: 'nope' },
      worse: 7
    }
  }));
  assert.deepEqual(Object.keys(polluted), ['ok'], '旧版形状与非法条目都应被丢弃');
  assert.equal(Object.keys(parse('{not json')).length, 0, '坏 JSON 不应抛错');
  assert.equal(Object.keys(parse(null)).length, 0, '空输入返回空表');
});

test('多标签页：storage 事件后重新读取并重绘', () => {
  const { plugin, document, window, storage } = loadBundle();
  plugin.apply(makeCtx().ctx);
  const { row } = addRow(document, 's9');
  plugin.__internals.annotateRows();
  assert.equal(row.getAttribute('data-dshmk'), null);

  storage.setItem('dsh.sidebar-marks.v1', JSON.stringify({
    version: 2,
    marks: { s9: { color: 'violet', fill: 22, dots: 'left', size: 's' } }
  }));
  window.dispatchStorage({ key: 'dsh.sidebar-marks.v1' });
  assert.equal(row.getAttribute('data-dshmk-color'), 'violet');
  assert.equal(row.getAttribute('data-dshmk-size'), 's');
  assert.equal(row.style.getPropertyValue('--dshmk-mix'), '22%');

  plugin.__internals.clearMark('s9');
  window.dispatchStorage({ key: 'something-else' });
  assert.equal(row.getAttribute('data-dshmk'), null);
});

test('dispose()：样式表、调试句柄、observer、四类监听器、面板全部清理', () => {
  const { plugin, window, document, observers } = loadBundle();
  const { ctx, effects } = makeCtx();
  plugin.apply(ctx);
  assert.equal(observers.length, 1);
  assert.equal(observers[0].disconnected, false);
  assert.equal(window.windowListenerCount('storage'), 1);

  plugin.__internals.openPanel('s1', 't');
  effects[0].cleanup();

  assert.equal(document.querySelector('style[data-plugin-css="dsh-sidebar-marks/style"]'), null);
  assert.equal(window.__dshSidebarMarks, undefined);
  assert.equal(observers[0].disconnected, true);
  assert.equal(window.windowListenerCount('storage'), 0);
  assert.equal(document.listenerCount('keydown'), 0);
  assert.equal(document.listenerCount('contextmenu'), 0);
  assert.equal(document.querySelector('div[data-dshmk-panel="1"]'), null);
});

test('自定义颜色：色号校验、归一化、深色变体、写进行元素', () => {
  const { plugin } = loadBundle();
  const I = plugin.__internals;

  // 校验与归一化
  assert.equal(I.isHexColor('#8b5cf6'), true);
  assert.equal(I.isHexColor('#ABC'), true);
  assert.equal(I.isHexColor('8b5cf6'), false, '缺 # 不算色号');
  assert.equal(I.isHexColor('#12345'), false);
  assert.equal(I.isHexColor('#gggggg'), false);
  assert.equal(I.isHexColor('blue'), false);
  assert.equal(I.normalizeHex('#AbC'), '#aabbcc', '#abc 展开成 #aabbcc');
  assert.equal(I.normalizeHex('  #8B5CF6 '), '#8b5cf6', '统一小写并去空白');

  // 主题取值
  assert.equal(I.colorFor('blue', 'light'), '#4176e6');
  assert.equal(I.colorFor('blue', 'dark'), '#7aaaff');
  assert.equal(I.colorFor('#8b5cf6', 'light'), '#8b5cf6');
  assert.equal(I.colorFor('#8b5cf6', 'dark'), I.darkVariant('#8b5cf6'), '自定义色在深色下自动提亮');
  assert.notEqual(I.darkVariant('#8b5cf6'), '#8b5cf6');
  assert.equal(I.darkVariant('#ffffff'), '#ffffff', '本来就够亮的颜色不折腾');
  assert.ok(I.mixHex('#000000', '#ffffff', 0.5) === '#808080');
  assert.equal(I.colorFor('nope', 'light'), null);
  assert.equal(I.hexOf('green'), '#22c55e');
  assert.equal(I.hexOf('#AbC'), '#aabbcc');
  assert.equal(I.hexOf(null), null);
  assert.equal(I.colorLabel('#8b5cf6'), '自定义 #8b5cf6');
  assert.equal(I.colorLabel('red'), '红 · 紧急');

  // 标记与行属性
  const n = I.normalizeMark({ color: '#8B5CF6', fill: 10 });
  assert.deepEqual(plain(n), { color: '#8b5cf6', fill: 10 });
  assert.equal(I.normalizeMark({ color: '#zzz', fill: 10 }), null, '非法色号 = 没有可见效果');

  const d = I.rowAttributes({ color: '#8b5cf6', fill: 12, dots: 'right' });
  assert.equal(d.attrs['data-dshmk-color'], '#8b5cf6');
  assert.equal(d.style['--dshmk-color-light'], '#8b5cf6');
  assert.equal(d.style['--dshmk-color-dark'], I.darkVariant('#8b5cf6'));
  assert.equal(d.style['--dshmk-mix'], '12%');
});

test('自定义颜色：写进 DOM、能被标到行上、清掉后不留痕', () => {
  const { plugin, document } = loadBundle();
  const { row } = addRow(document, 's1');
  const I = plugin.__internals;
  I.setMark('s1', { color: '#0ea5e9', fill: 10, dots: 'right' });
  I.annotateRows();
  assert.equal(row.getAttribute('data-dshmk-color'), '#0ea5e9');
  assert.equal(row.style.getPropertyValue('--dshmk-color-light'), '#0ea5e9');
  assert.equal(row.style.getPropertyValue('--dshmk-color-dark'), I.darkVariant('#0ea5e9'));

  I.clearMark('s1');
  I.annotateRows();
  assert.equal(row.style.getPropertyValue('--dshmk-color-light'), '');
  assert.equal(row.style.getPropertyValue('--dshmk-color-dark'), '');
});

test('面板：有系统色盘与色号输入；填色号回车即改色并同步预览', () => {
  const { plugin, document } = loadBundle();
  plugin.apply(makeCtx().ctx);
  addRow(document, 's1', { selected: true, title: '自定义颜色的对话' });
  plugin.__internals.openPanel('s1', '自定义颜色的对话');
  const card = plugin.__internals.getPanel().card;

  const picker = card.querySelector('input[type="color"]');
  assert.ok(picker, '应有系统色盘（input[type=color]）');
  const findHex = () => descendants(plugin.__internals.getPanel().card).filter((n) => n.className === 'dshmk-hex')[0];
  assert.ok(findHex(), '应有色号输入框');

  // 填色号 + change：改色 + 重建面板
  let hexInput = findHex();
  hexInput.value = '#0ea5e9';
  hexInput.dispatch('change', {});
  assert.equal(plugin.__internals.getMarks().s1.color, '#0ea5e9');
  const preview = document.querySelector('[data-row-key="session:__preview"]');
  assert.equal(preview.getAttribute('data-dshmk-color'), '#0ea5e9');
  assert.equal(preview.style.getPropertyValue('--dshmk-color-light'), '#0ea5e9');

  // 非法色号：不改标记，输入框回退到当前值
  hexInput = findHex();
  hexInput.value = '#zz';
  hexInput.dispatch('change', {});
  assert.equal(plugin.__internals.getMarks().s1.color, '#0ea5e9');
  assert.equal(findHex().value, '#0ea5e9');

  // 拖动色盘：只同步预览，不重建面板（重建会打断系统取色）
  const card2 = plugin.__internals.getPanel().card;
  const picker2 = card2.querySelector('input[type="color"]');
  picker2.value = '#ff8800';
  picker2.dispatch('input', {});
  assert.equal(plugin.__internals.getMarks().s1.color, '#ff8800');
  assert.equal(plugin.__internals.getPanel().card, card2, '色盘交互期间面板不应被重建');
  assert.equal(document.querySelector('[data-row-key="session:__preview"]').style.getPropertyValue('--dshmk-color-light'), '#ff8800');
});

test('界面语言：跟随 <html lang>，中文/英文两套文案，面板与菜单项一起换', () => {
  const { plugin, document } = loadBundle();
  plugin.apply(makeCtx().ctx);
  addRow(document, 's1', { selected: true, title: 'Language check' });

  assert.equal(plugin.__internals.currentLang(), 'zh');
  assert.equal(plugin.__internals.menuLabel(null), '标记…');
  assert.equal(plugin.__internals.menuLabel({ color: 'blue' }), '编辑标记…');
  assert.equal(plugin.__internals.colorLabel('red'), '红 · 紧急');

  // 切成英文（等价于用户在设置里把语言改成 English）
  document.documentElement.lang = 'en-US';
  assert.equal(plugin.__internals.currentLang(), 'en');
  assert.equal(plugin.__internals.menuLabel(null), 'Mark…');
  assert.equal(plugin.__internals.menuLabel({ color: 'blue' }), 'Edit mark…');
  assert.equal(plugin.__internals.colorLabel('red'), 'Red · urgent');
  assert.equal(plugin.__internals.colorLabel('#8b5cf6'), '自定义 #8b5cf6');

  plugin.__internals.openPanel('s1', 'Language check');
  const card = plugin.__internals.getPanel().card;
  const texts = descendants(card).map((n) => n.textContent);
  assert.ok(texts.includes('Conversation mark'), '面板标题应为英文');
  assert.ok(texts.some((x) => x.startsWith('Row tint strength')), '浓度字段应为英文');
  assert.ok(texts.includes('Done'), '完成按钮应为英文');
  assert.ok(!texts.some((x) => /[\u4e00-\u9fa5]/.test(x) && x !== 'Language check'), '英文界面下不该出现中文文案');

  // 浏览器没报语言时退回英文
  document.documentElement.lang = '';
  assert.equal(plugin.__internals.currentLang(), 'en');
});

test('Windows / Linux：Ctrl+Shift+M 同样生效，提示文案跟平台走，输入法组字不抢键', () => {
  const { plugin, window, document } = loadBundle({ platform: 'Win32' });
  plugin.apply(makeCtx().ctx);
  addRow(document, 's1', { selected: true, title: 'Windows 上的对话' });

  assert.equal(window.__dshSidebarMarks.hotkey, 'Ctrl+Shift+M', 'Windows 上提示 Ctrl 而不是 ⌘');

  // Ctrl 路径（此前只有 ⌘ 路径被测过）
  const ctrl = keyEvent({ metaKey: false, ctrlKey: true });
  document.dispatch('keydown', ctrl);
  assert.equal(ctrl.defaultPrevented, true, 'Ctrl+Shift+M 也应当命中');
  assert.ok(plugin.__internals.getPanel(), 'Ctrl 路径应打开面板');
  const hintText = descendants(plugin.__internals.getPanel().card).map((n) => n.textContent).join(' ');
  assert.match(hintText, /Ctrl\+Shift\+M/, '面板提示应为 Ctrl 版');
  plugin.__internals.closePanel();

  // 输入法组字期间不抢键（Windows 中文输入法：key 为 "Process" / keyCode 229）
  document.dispatch('keydown', keyEvent({ metaKey: false, ctrlKey: true, isComposing: true }));
  assert.equal(plugin.__internals.getPanel(), null, '组字中不该打开面板');
  document.dispatch('keydown', keyEvent({ metaKey: false, ctrlKey: true, keyCode: 229 }));
  assert.equal(plugin.__internals.getPanel(), null, 'keyCode 229 不该打开面板');
});

test('CSS：面板与遮罩声明 -webkit-app-region:no-drag（桌面版窗口拖拽区不吃点击）', () => {
  const { plugin } = loadBundle();
  const css = plugin.__internals.CSS;
  assert.ok(css.includes('.dshmk-scrim{position:fixed'), '遮罩规则应存在');
  assert.equal((css.match(/-webkit-app-region:no-drag/g) || []).length, 2,
    '面板与遮罩各要一条 no-drag，桌面版才不会被窗口拖拽区吃掉点击');
});

test('CSS：只用稳定钩子、不碰哈希类名；淡色底 + 深色加强 + 圆点两层背景', () => {
  const { plugin } = loadBundle();
  const css = plugin.__internals.CSS;
  assert.match(css, /\[data-row-key\^="session:"\]/);
  assert.match(css, /\[data-row-key\^="session:"\]\[data-dshmk-fill="1"\]\{[^}]*--dshmk-fill:color-mix\(in srgb, var\(--dshmk-color\) var\(--dshmk-mix,10%\)/);
  assert.match(css, /linear-gradient\(var\(--dshmk-fill\),var\(--dshmk-fill\)\)!important/, '淡色底必须 !important，否则被 DSH 的 background 简写清掉');
  assert.match(css, /body\[data-ds-dark-theme\] \[data-row-key\^="session:"\]\[data-dshmk-fill="1"\]\{[^}]*--dshmk-mix-dark,14%/, '深色主题用更浓的一档');
  assert.match(css, /radial-gradient\(circle 4px at calc\(100% - 14px\) 50%/);
  assert.match(css, /\[data-dshmk-fill="1"\]\[data-dshmk-dots="right"\]/, '淡色底 + 圆点要两层背景叠加');
  assert.match(css, /padding-right:20px!important/, '右侧圆点要预留位置，时间文字得左移');
  assert.match(css, /span:nth-child\(2\)/, '字号只打在标题（行内第 2 个 span）上');
  assert.match(css, /:not\(\[data-dshmk-size="inherit"\]\)/, 'inherit 时不许覆盖字号');
  assert.doesNotMatch(css, /data-dshmk-bottom/, '底部色块/细线已被整行淡色底取代');
  assert.doesNotMatch(css, /\[data-row-key\^="session:"\]\[data-dshmk-bottom/, '不该再有底部小条');
  assert.match(css, /body\[data-ds-dark-theme\] \[data-dshmk-color\]\{[^}]*--dshmk-color-dark/, '深色主题读深色值');
  assert.doesNotMatch(css, /\[data-dshmk-color="blue"\]/, '预设色不再写死成 CSS 规则，自定义色号才走得通');
  assert.doesNotMatch(css, /_[A-Za-z0-9-]{4,}_/, '不应出现打包生成的哈希类名');
});
