// 用 CDP 驱动一个无头 Chrome，打开真实的 DSH WebUI，给几条真实对话打上标记并截图。
// 用法：node tools/real-ui-check.mjs <token>
import { writeFileSync } from 'node:fs';

const token = process.argv[2];
if (!token) { console.error('usage: node real-ui-check.mjs <token>'); process.exit(2); }

const PORT = 9223;
const base = `http://127.0.0.1:${PORT}`;

async function targets() {
  const res = await fetch(`${base}/json/list`);
  return res.json();
}

async function waitForPage(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await targets();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (err) { /* chrome 还没起来 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('devtools page not found');
}

const page = await waitForPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => (msg.error ? reject(new Error(method + ': ' + JSON.stringify(msg.error))) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Runtime.enable');
await send('Page.enable');

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result.value;
};

// 等 SPA 把侧边栏渲染出来
let ready = false;
for (let i = 0; i < 60; i += 1) {
  ready = await evaluate(`document.querySelectorAll('[data-row-key^="session:"]').length > 0`);
  if (ready) break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('session rows visible:', ready);

const probe = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('[data-row-key^="session:"]')];
  return {
    rows: rows.length,
    plugin: typeof window.__dshSidebarMarks,
    style: !!document.querySelector('style[data-plugin-css="dsh-sidebar-marks/style"]'),
    ids: rows.slice(0, 8).map(r => [r.getAttribute('data-row-key'), (r.children[1] || {}).textContent || ''])
  };
})()`);
console.log('probe:', JSON.stringify(probe, null, 2));

const ids = probe.ids.filter(([key]) => key).slice(0, 6);
const palette = ['blue', 'green', 'amber', 'red', 'violet', 'slate'];
if (probe.plugin === 'object' && ids.length) {
  const written = await evaluate(`(() => {
    const ids = ${JSON.stringify(ids.map(([k]) => k.slice('session:'.length)))};
    const colors = ${JSON.stringify(palette)};
    const api = window.__dshSidebarMarks;
    ids.forEach((id, i) => {
      const color = colors[i % colors.length];
      if (i === 5) api.set(id, { size: 'xl', fill: 0, dots: 'none', color: null });          // 只改字号
      else if (i === 3) api.set(id, { color: '#e11d48', fill: 16, dots: 'both' });           // 自定义色号
      else if (i === 4) api.set(id, { color, fill: 0, dots: 'right' });                      // 只有行尾圆点
      else api.set(id, { color, fill: 10, dots: 'right' });                                  // 默认形状
    });
    api.rescan();
    return {
      inMemory: Object.keys(api.marks).length,
      persisted: JSON.parse(localStorage.getItem('dsh.sidebar-marks.v1') || '{}').marks ? Object.keys(JSON.parse(localStorage.getItem('dsh.sidebar-marks.v1')).marks).length : 0,
      annotated: document.querySelectorAll('[data-row-key^="session:"][data-dshmk]').length,
      leftDots: document.querySelectorAll('[data-row-key^="session:"] .dshmk-dot').length
    };
  })()`);
  console.log('marks written:', JSON.stringify(written));
}

await new Promise((r) => setTimeout(r, 800));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(process.argv[3] || 'real-ui.png', Buffer.from(shot.data, 'base64'));
console.log('screenshot saved');

// ---------------------------------------------------------------- 菜单与插槽验证
const menu = await evaluate(`(async () => {
  const rows = [...document.querySelectorAll('[data-row-key^="session:"][data-dshmk]')];
  const row = rows.find(r => r.querySelector('button'));
  if (!row) return { error: 'no marked row with a hover button', rows: rows.length };
  const leading = row.children[0] ? row.children[0].innerHTML : '';
  const btn = row.querySelector('button');
  btn.click();
  await new Promise(r => setTimeout(r, 350));
  const items = [...document.querySelectorAll('[role="menuitem"]')].map(e => e.textContent.trim());
  return { leading, items, dots: document.querySelectorAll('.dshmk-dot').length };
})()`);
console.log('menu probe:', JSON.stringify(menu, null, 2));

const shot2 = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync((process.argv[3] || 'real-ui.png').replace(/\.png$/, '-menu.png'), Buffer.from(shot2.data, 'base64'));
console.log('menu screenshot saved');

// ---------------------------------------------------------------- 面板验证
const panel = await evaluate(`(async () => {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(e => e.textContent.includes('标记'));
  if (!item) return { error: 'no 标记 menu item' };
  item.click();
  await new Promise(r => setTimeout(r, 400));
  const card = document.querySelector('.dshmk-panel');
  return {
    opened: !!card,
    title: card ? card.querySelector('h3').textContent : '',
    fields: card ? [...card.querySelectorAll('label')].map(l => l.textContent) : [],
    previewRow: !!document.querySelector('.dshmk-preview-row[data-dshmk]')
  };
})()`);
console.log('panel probe:', JSON.stringify(panel, null, 2));

const shot3 = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync((process.argv[3] || 'real-ui.png').replace(/\.png$/, '-panel.png'), Buffer.from(shot3.data, 'base64'));
console.log('panel screenshot saved');
ws.close();
