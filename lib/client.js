// dsh-sidebar-marks — browser half.
//
// 给 DSH 左侧边栏的每个对话打标记：**整行背景的淡色底** 与 **左侧或最右侧的彩色圆点**，
// 另可选每条对话独立的标题字号。未标记的对话与原生界面完全一致。
//
// 约束与做法（全部来自 DSH 0.2.0-rc.1 的真实契约，见 README「落地依据」）：
//  1. 本文件按 dsh-client-modules 的 lazy-CJS 模型编写：顶层只允许注册 factory，
//     任何副作用都必须留在 factory 闭包内、由 apply() 在 materialization 时触发。
//  2. `id` 必须等于 package.json 的 name，否则浏览器侧永远 materialize 不出来。
//  3. 模块对象用平铺导出（exports.apply / exports.inject），不要 export default：
//     loader 的 unwrapExports 会用 default 整个替换命名空间，写在一起的 inject 会静默丢失。
//  4. 左侧圆点走官方插槽 `sidebar.session.row.leading`（标题左侧 16×20 的格子，与 DSH
//     状态点共用；状态点在 / 已归档 / blank 行时该格子不渲染 → 该圆点自动消失，其余标记不受影响）。
//  5. 淡色底与圆点作用于整行，插槽表达不了，因此直接给行元素打属性：
//     行的稳定钩子 `div[role="treeitem"][data-row-key="session:<id>"]`；选择器里不出现
//     任何会随构建变化的 CSS-module 哈希类名。
//  6. 注入样式表必须自己打 `data-plugin` / `data-plugin-css`，否则可能被后一个
//     materialize 的插件「认领」，并在它卸载时被删掉。

window.__ModuleLoader__.load({
  id: 'dsh-sidebar-marks',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');

    // ======================================================================
    // 一、常量
    // ======================================================================

    var STORAGE_KEY = 'dsh.sidebar-marks.v1';
    var STYLE_TAG_ID = 'dsh-sidebar-marks/style';
    var GLOBAL_KEY = '__dshSidebarMarks';
    var ROW_PREFIX = 'session:';
    /** 打开「当前对话标记面板」的快捷键：⌘/Ctrl + Shift + M。 */
    var HOTKEY = { key: 'm', mod: true, shift: true };

    /** 6 个预设色；每个都带浅色/深色两套值。自定义色号则在运行时算出深色变体。 */
    var COLORS = {
      blue: { label: '蓝 · 主线', light: '#4176e6', dark: '#7aaaff' },
      green: { label: '绿 · 完成', light: '#22c55e', dark: '#4ed17e' },
      amber: { label: '琥珀 · 待跟进', light: '#f59e0b', dark: '#f7ad31' },
      red: { label: '红 · 紧急', light: '#ef4444', dark: '#f25a5a' },
      violet: { label: '紫 · 个人', light: '#8b5cf6', dark: '#a78bfa' },
      slate: { label: '灰蓝 · 归档', light: '#61666b', dark: '#adb2b8' }
    };

    /** 整行淡色底的浓度：浅色主题下的百分比。深色主题自动 +DARK_BOOST 个点（同一个数字在深色下更淡）。 */
    var FILLS = [
      { value: 8, label: '8%' },
      { value: 10, label: '10%' },
      { value: 12, label: '12%' },
      { value: 16, label: '16%' },
      { value: 22, label: '22%' },
      { value: 0, label: '不要' }
    ];
    /** 深色主题下自动补的浓度差值（百分点）。 */
    var DARK_BOOST = 4;

    /** 圆点位置：最右侧 / 标题左侧 / 两侧 / 不要。 */
    var DOTS = [
      { value: 'right', label: '最右侧' },
      { value: 'left', label: '标题左侧' },
      { value: 'both', label: '两侧' },
      { value: 'none', label: '不要' }
    ];

    /** 标题字号；inherit = 保持 DSH 原样（14px）。 */
    var SIZES = [
      { value: 'inherit', label: '原样' },
      { value: 'xs', px: 12, label: '12' },
      { value: 's', px: 13, label: '13' },
      { value: 'm', px: 14, label: '14' },
      { value: 'l', px: 15, label: '15' },
      { value: 'xl', px: 16, label: '16' }
    ];

    /** 一条新标记的初始形状：整行 10% 淡色底 + 最右侧圆点，颜色蓝。 */
    var DEFAULT_MARK = { color: 'blue', fill: 10, dots: 'right', size: 'inherit', weight: 400 };

    // ----------------------------------------------------------------------
    // 文案：跟随 DSH 自己的界面语言
    //   dsh-client-locale 会把当前语言写到 <html lang>，所以这里读它即可，
    //   不必依赖 locale 服务（插件保持零硬依赖）；读不到就退回 navigator.language。
    // ----------------------------------------------------------------------

    var STRINGS = {
      zh: {
        mark: '标记…',
        editMark: '编辑标记…',
        panelTitle: '对话标记',
        previewTitle: '这条对话会变成这样',
        previewTime: '刚刚',
        color: '颜色',
        picker: '自定义颜色',
        hex: '自定义色号',
        fill: '整行淡色底浓度',
        fillDark: '（深色主题自动 +4 个点）',
        dots: '圆点',
        size: '标题字号',
        hint: '快捷键 {key} 打开当前对话的标记面板；也可以直接右键任意对话行。',
        clear: '清除标记',
        close: '关闭',
        done: '完成',
        none: '无',
        sizeKeep: '原样',
        fillOff: '不要',
        dotRight: '最右侧',
        dotLeft: '标题左侧',
        dotBoth: '两侧',
        dotNone: '不要',
        colorNames: {
          blue: '蓝 · 主线', green: '绿 · 完成', amber: '琥珀 · 待跟进',
          red: '红 · 紧急', violet: '紫 · 个人', slate: '灰蓝 · 归档'
        }
      },
      en: {
        mark: 'Mark…',
        editMark: 'Edit mark…',
        panelTitle: 'Conversation mark',
        previewTitle: 'This row will look like this',
        previewTime: 'now',
        color: 'Color',
        picker: 'Custom color',
        hex: 'Hex code',
        fill: 'Row tint strength',
        fillDark: ' (+4 pts in dark theme)',
        dots: 'Dot',
        size: 'Title size',
        hint: 'Press {key} to mark the conversation you are viewing, or right-click any row.',
        clear: 'Clear mark',
        close: 'Close',
        done: 'Done',
        none: 'None',
        sizeKeep: 'Keep as is',
        fillOff: 'Off',
        dotRight: 'Right end',
        dotLeft: 'Left of title',
        dotBoth: 'Both',
        dotNone: 'Off',
        colorNames: {
          blue: 'Blue · main', green: 'Green · done', amber: 'Amber · follow up',
          red: 'Red · urgent', violet: 'Violet · personal', slate: 'Slate · archived'
        }
      }
    };

    /** 当前界面语言：'zh' 或 'en'。 */
    function currentLang() {
      var lang = '';
      try {
        lang = (document.documentElement && document.documentElement.lang) || '';
        if (!lang) lang = (typeof navigator !== 'undefined' && navigator.language) || '';
      } catch (err) {
        lang = '';
      }
      return String(lang).toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
    }

    /** 取一条界面文案；缺键回退英文，再缺就原样返回 key。 */
    function t(key, params) {
      var table = STRINGS[currentLang()] || STRINGS.en;
      var text = table[key];
      if (text === undefined) text = STRINGS.en[key];
      if (text === undefined) return key;
      if (params) {
        Object.keys(params).forEach(function (name) {
          text = text.split('{' + name + '}').join(String(params[name]));
        });
      }
      return text;
    }

    /** 颜色的可读名字（跟随界面语言）。 */
    function colorName(color) {
      var table = (STRINGS[currentLang()] || STRINGS.en).colorNames || {};
      return table[color] || (STRINGS.en.colorNames[color] || color);
    }

    // ----------------------------------------------------------------------
    // 颜色：预设色号之外还接受任意 #rgb / #rrggbb 自定义色
    // ----------------------------------------------------------------------

    var HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

    function isHexColor(value) {
      return typeof value === 'string' && HEX_RE.test(value.trim());
    }

    /** `#abc` -> `#aabbcc`，统一小写。 */
    function normalizeHex(value) {
      var hex = String(value).trim().toLowerCase();
      if (hex.length === 4) hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
      return hex;
    }

    function hexToRgb(hex) {
      var h = normalizeHex(hex).slice(1);
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }

    function toHex2(n) {
      var v = Math.max(0, Math.min(255, Math.round(n))).toString(16);
      return v.length === 1 ? '0' + v : v;
    }

    /** 把颜色朝某个目标色混 `ratio`（0–1）。 */
    function mixHex(hex, targetHex, ratio) {
      var a = hexToRgb(hex);
      var b = hexToRgb(targetHex);
      return '#' + [0, 1, 2].map(function (i) {
        return toHex2(a[i] + (b[i] - a[i]) * ratio);
      }).join('');
    }

    /** 相对亮度（0–1，sRGB 加权，够用就行）。 */
    function luminance(hex) {
      var rgb = hexToRgb(hex);
      return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    }

    /** 自定义色在深色主题下的变体：本来就够亮就原样用，否则朝白色提亮 28%（与预设色的明暗差大致相当）。 */
    function darkVariant(hex) {
      var base = normalizeHex(hex);
      return luminance(base) > 0.55 ? base : mixHex(base, '#ffffff', 0.28);
    }

    /** 某个颜色值在指定主题下的实际色值；`theme` 取 'light' | 'dark'。 */
    function colorFor(color, theme) {
      if (typeof color !== 'string') return null;
      var preset = COLORS[color];
      if (preset) return theme === 'dark' ? preset.dark : preset.light;
      if (!isHexColor(color)) return null;
      return theme === 'dark' ? darkVariant(color) : normalizeHex(color);
    }

    /** 颜色的可读名字（面板 / 调试用）。 */
    function colorLabel(color) {
      if (COLORS[color]) return colorName(color);
      if (isHexColor(color)) return '自定义 ' + normalizeHex(color);
      return '无颜色';
    }

    /** 颜色在浅色主题下的色值（预设色取其浅色值）；没有颜色时返回 null。 */
    function hexOf(color) {
      if (COLORS[color]) return COLORS[color].light;
      if (isHexColor(color)) return normalizeHex(color);
      return null;
    }

    /** 给任意元素写标记用的自定义属性（行、圆点、菜单图标、面板预览共用）。 */
    function applyDescriptor(node, descriptor) {
      ROW_ATTRS.forEach(function (name) { node.removeAttribute(name); });
      ROW_STYLE_PROPS.forEach(function (name) { node.style.removeProperty(name); });
      if (!descriptor) return;
      Object.keys(descriptor.attrs).forEach(function (name) { node.setAttribute(name, descriptor.attrs[name]); });
      Object.keys(descriptor.style).forEach(function (name) { node.style.setProperty(name, descriptor.style[name]); });
    }

    /** 只写颜色相关的自定义属性（给插槽里的小圆点用）。 */
    function applyColorVars(node, color) {
      var light = colorFor(color, 'light');
      if (!light) return;
      node.style.setProperty('--dshmk-color-light', light);
      node.style.setProperty('--dshmk-color-dark', colorFor(color, 'dark'));
    }

    // ======================================================================
    // 二、注入的样式表
    //     —— 只依赖 DSH 的稳定钩子：行上的 data-row-key、插槽里的 .dshmk-dot、
    //        以及 body[data-ds-dark-theme] 这个官方深色主题开关。
    // ======================================================================

    var CSS = [
      /* ---- 颜色：不再按预设名写死规则，改成读取元素上的两道自定义属性。
              标记色既可能是预设名（蓝/绿/…），也可能是用户自定义的 #rrggbb，
              所以由 JS 同时算出「浅色值 / 深色值」写进去，主题切换纯 CSS 完成。 ---- */
      '[data-dshmk-color]{--dshmk-color:var(--dshmk-color-light,#4176e6)}',
      'body[data-ds-dark-theme] [data-dshmk-color]{--dshmk-color:var(--dshmk-color-dark,var(--dshmk-color-light,#7aaaff))}',

      /* ---- 只碰被标记的行；未标记的行一个字节都不动，保持原生观感 ---- */
      '[data-row-key^="session:"][data-dshmk]{position:relative}',

      /* ---- 整行淡色底：颜色 + 浓度混出一层半透明色，铺在行背景之上。
              DSH 的 hover / 选中态写的是 `background` **简写**（会把 background-image 重置掉），
              所以这里必须 !important；而 background-color 不受影响，hover 依然可见、颜色自然深一档。
              浓度由 JS 写成两个自定义属性：浅色用 --dshmk-mix，深色用 --dshmk-mix-dark（自动 +4 个点）。 ---- */
      '[data-row-key^="session:"][data-dshmk-fill="1"]{' +
        '--dshmk-fill:color-mix(in srgb, var(--dshmk-color) var(--dshmk-mix,10%), transparent);' +
        'background-image:linear-gradient(var(--dshmk-fill),var(--dshmk-fill))!important}',
      'body[data-ds-dark-theme] [data-row-key^="session:"][data-dshmk-fill="1"]{' +
        '--dshmk-fill:color-mix(in srgb, var(--dshmk-color) var(--dshmk-mix-dark,14%), transparent)}',

      /* ---- 最右侧圆点：用背景绘制，不参与布局、不干扰 React，也不会被 hover 吃掉。
              右侧预留 20px 内边距，时间文字自动左移，圆点落在距右边缘 14px 处。 ---- */
      '[data-row-key^="session:"][data-dshmk-dots="right"],' +
        '[data-row-key^="session:"][data-dshmk-dots="both"]{' +
        'padding-right:20px!important;' +
        'background-image:radial-gradient(circle 4px at calc(100% - 14px) 50%, var(--dshmk-color) 3.5px, transparent 4px)!important}',
      /* 淡色底 + 圆点同时存在时，两层背景叠在一起（圆点在上，淡色底在下） */
      '[data-row-key^="session:"][data-dshmk-fill="1"][data-dshmk-dots="right"],' +
        '[data-row-key^="session:"][data-dshmk-fill="1"][data-dshmk-dots="both"]{' +
        'background-image:radial-gradient(circle 4px at calc(100% - 14px) 50%, var(--dshmk-color) 3.5px, transparent 4px),' +
        'linear-gradient(var(--dshmk-fill),var(--dshmk-fill))!important}',

      /* ---- 标题字号 / 字重：只在显式选过时才覆盖（inherit 时一个字节都不写） ---- */
      '[data-dshmk-size="xs"]{--dshmk-fs:12px}',
      '[data-dshmk-size="s"]{--dshmk-fs:13px}',
      '[data-dshmk-size="m"]{--dshmk-fs:14px}',
      '[data-dshmk-size="l"]{--dshmk-fs:15px}',
      '[data-dshmk-size="xl"]{--dshmk-fs:16px}',
      '[data-dshmk-weight="500"]{--dshmk-fw:500}',
      '[data-dshmk-weight="600"]{--dshmk-fw:600}',
      '[data-row-key^="session:"][data-dshmk]:not([data-dshmk-size="inherit"]) > span:nth-child(2){font-size:var(--dshmk-fs,14px)}',
      '[data-row-key^="session:"][data-dshmk][data-dshmk-weight="500"] > span:nth-child(2),' +
        '[data-row-key^="session:"][data-dshmk][data-dshmk-weight="600"] > span:nth-child(2){font-weight:var(--dshmk-fw)}',

      /* ---- 左侧圆点：由 React 插槽渲染在标题前的 16×20 格子里 ---- */
      '.dshmk-dot{display:inline-flex;align-items:center;justify-content:center;flex:none;width:8px;height:8px;' +
        'border-radius:50%;background:var(--dshmk-color);box-sizing:content-box}',

      /* ---- 标记面板 ---- */
      '.dshmk-scrim{position:fixed;inset:0;z-index:2147483000;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24));' +
        '-webkit-app-region:no-drag}',
      '.dshmk-panel{position:fixed;z-index:2147483001;left:50%;top:50%;transform:translate(-50%,-50%);width:344px;' +
        '-webkit-app-region:no-drag;' +
        'box-sizing:border-box;padding:16px 16px 12px;border-radius:var(--dsw-radius-lg,16px);' +
        'border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-1,#fff);' +
        'color:var(--dsw-alias-label-primary,#0f1115);box-shadow:0 18px 48px rgba(0,0,0,.24);font-size:13px;line-height:20px}',
      'body[data-ds-dark-theme] .dshmk-panel{background:var(--dsw-static-neutral-bluish-875,#232324);' +
        'color:var(--dsw-static-neutral-bluish-50,#f9fafb)}',
      '.dshmk-panel h3{margin:0 0 2px;font-size:14px;font-weight:600;line-height:22px}',
      '.dshmk-sub{color:var(--dsw-alias-label-tertiary,#81858c);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshmk-field{margin-top:12px}',
      '.dshmk-field > label{display:block;margin-bottom:6px;color:var(--dsw-alias-label-secondary,#61666b);font-size:12px}',
      '.dshmk-chips{display:flex;flex-wrap:wrap;gap:6px}',
      '.dshmk-chip{cursor:pointer;padding:4px 9px;border-radius:8px;font:inherit;font-size:12px;line-height:18px;color:inherit;' +
        'border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));background:transparent}',
      '.dshmk-chip[aria-pressed="true"]{border-color:var(--dsw-alias-state-business-primary,#4176e6);' +
        'background:var(--dsw-alias-interactive-bg-hover-accent,rgba(38,49,72,.14))}',
      '.dshmk-swatches{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.dshmk-sw{width:24px;height:24px;padding:0;border-radius:50%;cursor:pointer;border:2px solid transparent;background:var(--dshmk-color)}',
      '.dshmk-sw[aria-pressed="true"]{border-color:var(--dsw-alias-label-primary,#0f1115)}',
      '.dshmk-sw[data-color="none"]{background:transparent;border-color:var(--dsw-alias-border-l3,rgba(0,0,0,.12));' +
        'color:var(--dsw-alias-label-tertiary,#81858c);font-size:10px}',
      /* 自定义颜色：系统色盘 + 色号输入 */
      '.dshmk-custom-row{display:flex;align-items:center;gap:8px;margin-top:8px}',
      '.dshmk-picker{width:24px;height:24px;padding:0;border:2px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));' +
        'border-radius:50%;background:transparent;cursor:pointer;appearance:none;-webkit-appearance:none;overflow:hidden}',
      '.dshmk-picker[data-active="1"]{border-color:var(--dsw-alias-label-primary,#0f1115)}',
      '.dshmk-picker::-webkit-color-swatch-wrapper{padding:0}',
      '.dshmk-picker::-webkit-color-swatch{border:none;border-radius:50%}',
      '.dshmk-picker::-moz-color-swatch{border:none;border-radius:50%}',
      '.dshmk-hex{box-sizing:border-box;width:92px;padding:4px 8px;border-radius:8px;font:inherit;font-size:12px;color:inherit;' +
        'background:transparent;border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
      '.dshmk-hex::placeholder{color:var(--dsw-alias-label-caption,#adb2b8);font-family:inherit}',
      '.dshmk-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:14px}',
      '.dshmk-btn{cursor:pointer;padding:6px 12px;border-radius:8px;font:inherit;font-size:12px;' +
        'border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));background:transparent;color:inherit}',
      '.dshmk-btn[data-variant="primary"]{border-color:transparent;background:var(--dsw-alias-state-business-primary,#4176e6);color:#fff}',
      '.dshmk-hint{margin-top:10px;color:var(--dsw-alias-label-tertiary,#81858c);font-size:11.5px;line-height:17px}',

      /* ---- 面板里的实时预览行：结构与真实行一致，复用同一套标记规则 ---- */
      '.dshmk-preview{margin-top:10px;padding:4px 4px 2px;border-radius:12px;' +
        'background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
      '.dshmk-preview-row{display:flex;align-items:center;gap:0;height:32px;padding:0 8px;border-radius:12px;' +
        'color:var(--dsw-alias-label-primary,#0f1115);font-size:14px;line-height:20px}',
      '.dshmk-preview-cell{width:16px;height:20px;flex:none;display:inline-flex;align-items:center;justify-content:center}',
      '.dshmk-preview-title{flex:1;min-width:0;margin:0 6px 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshmk-preview-time{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary,#81858c)}'
    ].join('\n');

    // ======================================================================
    // 三、状态与持久化
    // ======================================================================

    /** sessionId -> mark。内存里的唯一真相，DOM 只是它的投影。 */
    var marks = Object.create(null);
    var listeners = new Set();
    var version = 0;
    var saveTimer = null;
    var deferred = [];

    function bump() {
      version += 1;
      listeners.forEach(function (fn) {
        try {
          fn(version);
        } catch (err) {
          /* 单个订阅者出错不影响其它 */
        }
      });
    }

    function subscribe(fn) {
      listeners.add(fn);
      return function () {
        listeners.delete(fn);
      };
    }

    /** 把任意输入收敛成合法 mark；没有任何可见效果时返回 null（= 没有标记）。 */
    function normalizeMark(input) {
      if (!input || typeof input !== 'object') return null;
      var out = {};
      if (typeof input.color === 'string') {
        if (COLORS[input.color]) out.color = input.color;
        else if (isHexColor(input.color)) out.color = normalizeHex(input.color);
      }
      if (input.fill !== undefined && input.fill !== null && input.fill !== '') {
        var f = Number(input.fill);
        if (isFinite(f)) out.fill = Math.max(0, Math.min(30, Math.round(f)));
      }
      if (input.dots && DOTS.some(function (d) { return d.value === input.dots; })) out.dots = input.dots;
      if (input.size && SIZES.some(function (s) { return s.value === input.size; })) out.size = input.size;
      else if (input.size && SIZES.some(function (s) { return s.px === Number(input.size); })) {
        out.size = SIZES.filter(function (s) { return s.px === Number(input.size); })[0].value;
      }
      if (Number(input.weight) === 500 || Number(input.weight) === 600) out.weight = Number(input.weight);
      var paints = out.color && ((out.fill && out.fill > 0) || (out.dots && out.dots !== 'none'));
      var resizes = out.size && out.size !== 'inherit';
      return paints || resizes ? out : null;
    }

    function markOf(sessionId) {
      return marks[sessionId] || null;
    }

    /** 该对话生效的完整形状（未标记时返回一份默认形状，供面板预览）。 */
    function markOrDefault(sessionId) {
      var seed = {};
      var k;
      for (k in DEFAULT_MARK) seed[k] = DEFAULT_MARK[k];
      var own = marks[sessionId];
      if (own) for (k in own) seed[k] = own[k];
      return seed;
    }

    function setMark(sessionId, patch, options) {
      var next = normalizeMark(Object.assign({}, markOrDefault(sessionId), patch || {}));
      if (next === null) delete marks[sessionId];
      else marks[sessionId] = next;
      if (!options || options.persist !== false) scheduleSave();
      annotateRows();
      bump();
      return marks[sessionId] || null;
    }

    function clearMark(sessionId) {
      delete marks[sessionId];
      scheduleSave();
      annotateRows();
      bump();
    }

    function serialize() {
      return JSON.stringify({ version: 2, marks: marks });
    }

    function parse(raw) {
      if (!raw) return Object.create(null);
      var data;
      try {
        data = JSON.parse(raw);
      } catch (err) {
        return Object.create(null);
      }
      var src = data && data.marks ? data.marks : {};
      var out = Object.create(null);
      Object.keys(src).forEach(function (id) {
        var m = normalizeMark(src[id]);
        if (m !== null) out[id] = m;
      });
      return out;
    }

    function storage() {
      try {
        return window.localStorage || null;
      } catch (err) {
        return null;
      }
    }

    function loadMarks() {
      var ls = storage();
      marks = parse(ls ? ls.getItem(STORAGE_KEY) : null);
      return marks;
    }

    function saveMarks() {
      var ls = storage();
      if (!ls) return false;
      try {
        ls.setItem(STORAGE_KEY, serialize());
        return true;
      } catch (err) {
        return false;
      }
    }

    /** 面板里每点一下都会改状态；写盘去抖，避免连续操作时狂写 localStorage。 */
    function scheduleSave() {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        saveTimer = null;
        saveMarks();
      }, 200);
    }

    // ======================================================================
    // 四、行标注引擎：把 marks 投影到 DOM 上
    // ======================================================================

    /** mark -> 行元素上应有的属性与自定义属性；无可见标记时返回 null。 */
    function rowAttributes(mark) {
      if (!mark) return null;
      var hasColor = !!mark.color;
      var fill = hasColor && Number(mark.fill) > 0 ? Math.round(Number(mark.fill)) : 0;
      var dots = hasColor ? (mark.dots || 'none') : 'none';
      var size = mark.size || 'inherit';
      var weight = Number(mark.weight) === 500 || Number(mark.weight) === 600 ? Number(mark.weight) : 400;
      if (fill === 0 && dots === 'none' && size === 'inherit') return null;
      var attrs = { 'data-dshmk': '1' };
      if (hasColor) attrs['data-dshmk-color'] = mark.color;
      attrs['data-dshmk-fill'] = fill > 0 ? '1' : '0';
      attrs['data-dshmk-dots'] = dots;
      attrs['data-dshmk-size'] = size;
      attrs['data-dshmk-weight'] = String(weight);
      var style = {};
      if (hasColor) {
        style['--dshmk-color-light'] = colorFor(mark.color, 'light');
        style['--dshmk-color-dark'] = colorFor(mark.color, 'dark');
      }
      if (fill > 0) {
        style['--dshmk-mix'] = fill + '%';
        style['--dshmk-mix-dark'] = Math.min(30, fill + DARK_BOOST) + '%';
      }
      return { attrs: attrs, style: style };
    }

    var ROW_ATTRS = ['data-dshmk', 'data-dshmk-color', 'data-dshmk-fill', 'data-dshmk-dots', 'data-dshmk-size', 'data-dshmk-weight'];
    var ROW_STYLE_PROPS = ['--dshmk-mix', '--dshmk-mix-dark', '--dshmk-color-light', '--dshmk-color-dark'];

    /** 行上的 session id（去掉 `session:` 前缀）；不是对话行则返回 null。 */
    function sessionIdOfRow(row) {
      if (!row || typeof row.getAttribute !== 'function') return null;
      var key = row.getAttribute('data-row-key') || '';
      if (key.indexOf(ROW_PREFIX) !== 0) return null;
      return key.slice(ROW_PREFIX.length);
    }

    function writeRow(row, descriptor) {
      applyDescriptor(row, descriptor);
    }

    /**
     * 扫描（并重新标注）所有对话行。全量 + 幂等，所以「标记被清除」也能被纠正回来。
     * @param root 默认 document。
     * @returns 被标注的行数。
     */
    function annotateRows(root) {
      var host = root || (typeof document !== 'undefined' ? document : null);
      if (!host || typeof host.querySelectorAll !== 'function') return 0;
      var rows = host.querySelectorAll('[data-row-key^="' + ROW_PREFIX + '"]');
      var marked = 0;
      for (var i = 0; i < rows.length; i += 1) {
        var id = sessionIdOfRow(rows[i]);
        var descriptor = rowAttributes(marks[id]);
        if (descriptor) marked += 1;
        writeRow(rows[i], descriptor);
      }
      return marked;
    }

    // ======================================================================
    // 五、插槽组件
    // ======================================================================

    function useVersion() {
      var pair = React.useState(version);
      var setV = pair[1];
      React.useEffect(function () {
        return subscribe(function (v) { setV(v); });
      }, []);
      return pair[0];
    }

    /** 该对话是否要在标题左侧那格画圆点。 */
    function leftDotVisible(mark) {
      return !!(mark && mark.color && (mark.dots === 'left' || mark.dots === 'both'));
    }

    /** 延迟取 ui-primitives：宿主没装它时退化成原生 button，插件不至于整个挂掉。 */
    var primitives;
    function menuItemComponent() {
      if (primitives === undefined) {
        try {
          primitives = require('@deepseek-ai/dsh-client-ui-primitives');
        } catch (err) {
          primitives = null;
        }
      }
      if (primitives && primitives.MenuItemButton) return primitives.MenuItemButton;
      return function FallbackMenuItem(props) {
        return React.createElement('button', { type: 'button', role: 'menuitem', onClick: props.onSelect }, props.children);
      };
    }

    /** 左侧圆点：标题前 16×20 的格子。DSH 的状态点在场时本组件不会被挂载。 */
    function LeadingDot(props) {
      useVersion();
      var mark = marks[props.sessionId];
      if (!leftDotVisible(mark)) return null;
      var light = colorFor(mark.color, 'light');
      if (!light) return null;
      return React.createElement('span', {
        className: 'dshmk-dot',
        'data-dshmk-color': mark.color,
        style: { '--dshmk-color-light': light, '--dshmk-color-dark': colorFor(mark.color, 'dark') },
        'aria-hidden': 'true',
        title: '对话标记'
      });
    }

    /** 「…」菜单里的那一行文案。 */
    function menuLabel(mark) {
      return mark ? t('editMark') : t('mark');
    }

    function MarkMenuItem(props) {
      useVersion();
      var pair = props.useMenuOpenState();
      var setMenuOpen = pair[1];
      var mark = marks[props.sessionId];
      var menuLight = mark && mark.color ? colorFor(mark.color, 'light') : null;
      var icon = React.createElement('span', {
        className: 'dshmk-dot',
        'data-dshmk-color': mark && mark.color ? mark.color : undefined,
        style: menuLight
          ? { '--dshmk-color-light': menuLight, '--dshmk-color-dark': colorFor(mark.color, 'dark') }
          : { background: 'transparent' }
      });
      return React.createElement(
        menuItemComponent(),
        {
          icon: icon,
          separatorBefore: true,
          onSelect: function () {
            setMenuOpen(false);
            openPanel(props.sessionId, props.displayTitle);
          }
        },
        menuLabel(mark)
      );
    }

    // ======================================================================
    // 六、标记面板（纯 DOM，避免额外插槽契约）
    // ======================================================================

    var panel = null;
    var panelState = null;

    function el(tag, className, text) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = String(text);
      return node;
    }

    function chip(labelText, pressed, onSelect) {
      var b = el('button', 'dshmk-chip', labelText);
      b.setAttribute('type', 'button');
      b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      b.addEventListener('click', onSelect);
      return b;
    }

    function field(labelText) {
      var wrap = el('div', 'dshmk-field');
      wrap.appendChild(el('label', null, labelText));
      return wrap;
    }

    function closePanel() {
      if (panel && panel.root && panel.root.remove) panel.root.remove();
      if (panel && panel.onKey) document.removeEventListener('keydown', panel.onKey);
      panel = null;
      panelState = null;
    }

    function openPanel(sessionId, displayTitle) {
      if (!sessionId) return null;
      closePanel();
      panelState = { sessionId: sessionId, title: displayTitle || displayTitleOf(sessionId) || '（未命名对话）' };
      var root = el('div', 'dshmk-scrim');
      root.setAttribute('data-dshmk-panel', '1');
      var card = el('div', 'dshmk-panel');
      root.appendChild(card);
      root.addEventListener('click', function () { closePanel(); });
      card.addEventListener('click', function (event) {
        if (event && event.stopPropagation) event.stopPropagation();
      });
      var onKey = function (event) {
        if (event && (event.key === 'Escape' || event.key === 'Esc')) closePanel();
      };
      document.addEventListener('keydown', onKey);
      panel = { root: root, card: card, onKey: onKey };
      (document.body || document.documentElement).appendChild(root);
      renderPanel();
      return panel;
    }

    /** 从侧边栏行里读标题（行内第 2 个 span 就是标题，DSH 结构稳定）。 */
    function displayTitleOf(sessionId) {
      var row = findRow(sessionId);
      if (!row || !row.children || row.children.length < 2) return '';
      return String(row.children[1].textContent || '').trim();
    }

    function findRow(sessionId) {
      if (typeof document === 'undefined' || !document.querySelector) return null;
      return document.querySelector('[data-row-key="' + ROW_PREFIX + sessionId + '"]');
    }

    /** 预览行里的左侧圆点：颜色跟着标记走。 */
    function fillPreviewCell(cell, mark) {
      cell.textContent = '';
      if (!leftDotVisible(mark)) return;
      var dot = el('span', 'dshmk-dot');
      dot.setAttribute('data-dshmk-color', mark.color);
      applyColorVars(dot, mark.color);
      cell.appendChild(dot);
    }

    /** 面板里的实时预览行：结构与真实行一致，因此复用同一套标记 CSS。 */
    function previewRow(mark) {
      var wrap = el('div', 'dshmk-preview');
      var row = el('div', 'dshmk-preview-row');
      row.setAttribute('data-row-key', ROW_PREFIX + '__preview');
      applyDescriptor(row, rowAttributes(mark));
      var cell = el('span', 'dshmk-preview-cell');
      fillPreviewCell(cell, mark);
      row.appendChild(cell);
      row.appendChild(el('span', 'dshmk-preview-title', t('previewTitle')));
      row.appendChild(el('span', 'dshmk-preview-time', t('previewTime')));
      wrap.appendChild(row);
      if (panel) { panel.previewRow = row; panel.previewCell = cell; }
      return wrap;
    }

    /** 拖动系统色盘时的高频更新：只改预览行与色板选中态，不重建面板（重建会打断取色）。 */
    function syncPanelLive() {
      if (!panel || !panelState) return;
      var mark = markOrDefault(panelState.sessionId);
      if (panel.previewRow) applyDescriptor(panel.previewRow, rowAttributes(mark));
      if (panel.previewCell) fillPreviewCell(panel.previewCell, mark);
      var swatches = panel.card.querySelectorAll('[data-preset]');
      for (var i = 0; i < swatches.length; i += 1) {
        swatches[i].setAttribute('aria-pressed', swatches[i].getAttribute('data-preset') === mark.color ? 'true' : 'false');
      }
      var picker = panel.card.querySelector('.dshmk-picker');
      if (picker && isHexColor(mark.color)) picker.value = normalizeHex(mark.color);
      var hexInput = panel.card.querySelector('.dshmk-hex');
      if (hexInput && isHexColor(mark.color) && document.activeElement !== hexInput) hexInput.value = normalizeHex(mark.color);
    }

    function renderPanel() {
      if (!panel || !panelState) return;
      var card = panel.card;
      card.textContent = '';
      var sessionId = panelState.sessionId;
      var mark = markOrDefault(sessionId);
      var committed = !!marks[sessionId];

      card.appendChild(el('h3', null, t('panelTitle')));
      card.appendChild(el('div', 'dshmk-sub', panelState.title + ' · ' + sessionId));
      card.appendChild(previewRow(mark));

      // 颜色
      var colorField = field(t('color'));
      var swatches = el('div', 'dshmk-swatches');
      Object.keys(COLORS).forEach(function (key) {
        var b = el('button', 'dshmk-sw');
        b.setAttribute('type', 'button');
        b.setAttribute('data-dshmk-color', key);
        b.setAttribute('data-preset', key);
        b.style.setProperty('--dshmk-color-light', COLORS[key].light);
        b.style.setProperty('--dshmk-color-dark', COLORS[key].dark);
        b.setAttribute('aria-pressed', mark.color === key ? 'true' : 'false');
        b.title = colorName(key);
        b.addEventListener('click', function () { setMark(sessionId, { color: key }); renderPanel(); });
        swatches.appendChild(b);
      });
      var none = el('button', 'dshmk-sw', t('none'));
      none.setAttribute('type', 'button');
      none.setAttribute('data-color', 'none');
      none.setAttribute('aria-pressed', mark.color ? 'false' : 'true');
      none.addEventListener('click', function () { setMark(sessionId, { color: null }); renderPanel(); });
      swatches.appendChild(none);
      colorField.appendChild(swatches);

      // 自定义颜色：色盘 + 色号
      var customRow = el('div', 'dshmk-custom-row');
      var customColor = hexOf(mark.color) || '#4176e6';
      var picker = el('input', 'dshmk-picker');
      picker.setAttribute('type', 'color');
      picker.setAttribute('aria-label', t('picker'));
      picker.value = customColor;
      picker.title = t('picker');
      if (isHexColor(mark.color)) picker.setAttribute('data-active', '1');
      // 'input' 在系统色盘拖动时连续触发：只更新标记与预览，不重建面板（重建会打断取色）
      picker.addEventListener('input', function () {
        setMark(sessionId, { color: picker.value });
        if (panel) syncPanelLive();
      });
      picker.addEventListener('change', function () {
        setMark(sessionId, { color: picker.value });
        renderPanel();
      });
      var hexInput = el('input', 'dshmk-hex');
      hexInput.setAttribute('type', 'text');
      hexInput.setAttribute('maxlength', '7');
      hexInput.setAttribute('spellcheck', 'false');
      hexInput.setAttribute('placeholder', '#8b5cf6');
      hexInput.setAttribute('aria-label', t('hex'));
      hexInput.value = isHexColor(mark.color) ? normalizeHex(mark.color) : '';
      var applyHex = function () {
        var raw = String(hexInput.value || '').trim();
        if (raw && raw[0] !== '#') raw = '#' + raw;
        if (isHexColor(raw)) {
          setMark(sessionId, { color: normalizeHex(raw) });
          renderPanel();
          return true;
        }
        hexInput.value = isHexColor(mark.color) ? normalizeHex(mark.color) : '';
        return false;
      };
      hexInput.addEventListener('change', applyHex);
      hexInput.addEventListener('keydown', function (event) {
        if (event && event.key === 'Enter') { event.preventDefault(); applyHex(); }
      });
      customRow.appendChild(picker);
      customRow.appendChild(hexInput);
      colorField.appendChild(customRow);
      card.appendChild(colorField);

      // 浓度（整行淡色底）
      var fillField = field(t('fill') + (Number(mark.fill) > 0 ? t('fillDark') : ''));
      var fillChips = el('div', 'dshmk-chips');
      FILLS.forEach(function (f) {
        fillChips.appendChild(chip(f.value === 0 ? t('fillOff') : f.label, Number(mark.fill || 0) === f.value, function () {
          setMark(sessionId, { fill: f.value });
          renderPanel();
        }));
      });
      fillField.appendChild(fillChips);
      card.appendChild(fillField);

      // 圆点
      var dotField = field(t('dots'));
      var dotChips = el('div', 'dshmk-chips');
      var DOT_LABELS = { right: 'dotRight', left: 'dotLeft', both: 'dotBoth', none: 'dotNone' };
      DOTS.forEach(function (d) {
        dotChips.appendChild(chip(t(DOT_LABELS[d.value] || 'dotNone'), (mark.dots || 'none') === d.value, function () {
          setMark(sessionId, { dots: d.value });
          renderPanel();
        }));
      });
      dotField.appendChild(dotChips);
      card.appendChild(dotField);

      // 字号
      var sizeField = field(t('size'));
      var sizeChips = el('div', 'dshmk-chips');
      SIZES.forEach(function (s) {
        sizeChips.appendChild(chip(s.value === 'inherit' ? t('sizeKeep') : s.label, (mark.size || 'inherit') === s.value, function () {
          setMark(sessionId, { size: s.value });
          renderPanel();
        }));
      });
      sizeField.appendChild(sizeChips);
      card.appendChild(sizeField);

      card.appendChild(el('div', 'dshmk-hint', t('hint', { key: isMac() ? '⌘⇧M' : 'Ctrl+Shift+M' })));

      // 底部动作
      var foot = el('div', 'dshmk-foot');
      var left = el('div', 'dshmk-chips');
      left.appendChild(chip(committed ? t('clear') : t('close'), false, function () {
        if (committed) {
          clearMark(sessionId);
          renderPanel();
        } else {
          closePanel();
        }
      }));
      var done = el('button', 'dshmk-btn', t('done'));
      done.setAttribute('type', 'button');
      done.setAttribute('data-variant', 'primary');
      done.addEventListener('click', function () { closePanel(); });
      foot.appendChild(left);
      foot.appendChild(done);
      card.appendChild(foot);
    }

    function isMac() {
      try {
        var ua = (typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || '';
        return /Mac|iPhone|iPad/.test(ua);
      } catch (err) {
        return false;
      }
    }

    // ======================================================================
    // 七、快捷键与右键
    // ======================================================================

    function isEditable(target) {
      if (!target || !target.tagName) return false;
      var tag = String(target.tagName).toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      return !!target.isContentEditable;
    }

    /** 当前打开的对话 = 侧边栏里 aria-selected="true" 的那一行。 */
    function currentSessionId() {
      if (typeof document === 'undefined' || !document.querySelector) return null;
      var row = document.querySelector('[data-row-key^="' + ROW_PREFIX + '"][aria-selected="true"]');
      return sessionIdOfRow(row);
    }

    function onKeydown(event) {
      if (!event || event.defaultPrevented) return;
      // 输入法组字期间不抢键（Windows 中文输入法下 keydown 的 key 会是 "Process"、keyCode 229，
      // 与 DSH 自己的 observeComposition 守卫保持一致）
      if (event.isComposing || event.keyCode === 229) return;
      if (String(event.key || '').toLowerCase() !== HOTKEY.key) return;
      if (HOTKEY.mod && !(event.metaKey || event.ctrlKey)) return;
      if (HOTKEY.shift && !event.shiftKey) return;
      if (isEditable(event.target)) return;
      if (event.preventDefault) event.preventDefault();
      var id = currentSessionId();
      if (id) openPanel(id);
    }

    function onContextMenu(event) {
      var target = event && event.target;
      var row = target && target.closest ? target.closest('[data-row-key^="' + ROW_PREFIX + '"]') : null;
      var id = sessionIdOfRow(row);
      if (!id) return;
      if (event.preventDefault) event.preventDefault();
      openPanel(id);
    }

    // ======================================================================
    // 八、装载 / 卸载
    // ======================================================================

    function injectStyle() {
      if (document.querySelector('style[data-plugin-css="' + STYLE_TAG_ID + '"]')) return null;
      var tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-sidebar-marks';
      tag.dataset.pluginCss = STYLE_TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return tag;
    }

    var scanTimer = null;
    var observer = null;
    var lang = null;

    function scheduleScan() {
      if (scanTimer !== null) return;
      scanTimer = setTimeout(function () {
        scanTimer = null;
        annotateRows();
      }, 80);
    }

    function startObserver() {
      if (typeof MutationObserver === 'undefined') return null;
      var target = document.body || document.documentElement;
      if (!target) return null;
      observer = new MutationObserver(function (records) {
        var langChanged = false;
        for (var i = 0; i < records.length; i += 1) {
          if (records[i].type === 'attributes' && records[i].attributeName === 'lang') langChanged = true;
        }
        // 界面语言变了：菜单项与面板文案跟着换（locale 服务会改写 <html lang>）
        if (langChanged && lang !== currentLang()) {
          lang = currentLang();
          if (panel) renderPanel();
          bump();
        }
        scheduleScan();
      });
      observer.observe(target, { childList: true, subtree: true });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
      return observer;
    }

    function onStorage(event) {
      if (!event || event.key !== STORAGE_KEY) return;
      loadMarks();
      annotateRows();
      bump();
    }

    function install() {
      lang = currentLang();
      injectStyle();
      loadMarks();
      annotateRows();
      startObserver();
      document.addEventListener('keydown', onKeydown);
      document.addEventListener('contextmenu', onContextMenu);
      if (typeof window.addEventListener === 'function') window.addEventListener('storage', onStorage);
      // 首帧之后再补扫几次：React 挂载 / 会话切换后行节点会被重建。
      [120, 600, 2000].forEach(function (delay) {
        var t = setTimeout(function () { annotateRows(); }, delay);
        deferred.push(function () { clearTimeout(t); });
      });
      window[GLOBAL_KEY] = {
        get version() { return version; },
        get marks() { return JSON.parse(JSON.stringify(marks)); },
        set: setMark,
        clear: clearMark,
        rescan: annotateRows,
        open: openPanel,
        close: closePanel,
        current: currentSessionId,
        storageKey: STORAGE_KEY,
        colors: Object.keys(COLORS),
        hotkey: isMac() ? '⌘⇧M' : 'Ctrl+Shift+M'
      };
    }

    function dispose() {
      deferred.forEach(function (fn) { fn(); });
      deferred = [];
      if (scanTimer !== null) { clearTimeout(scanTimer); scanTimer = null; }
      if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
      if (observer) { observer.disconnect(); observer = null; }
      closePanel();
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('contextmenu', onContextMenu);
      if (typeof window.removeEventListener === 'function') window.removeEventListener('storage', onStorage);
      var tag = document.querySelector('style[data-plugin-css="' + STYLE_TAG_ID + '"]');
      if (tag && tag.remove) tag.remove();
      if (window[GLOBAL_KEY]) delete window[GLOBAL_KEY];
      listeners.clear();
    }

    /**
     * 装载浏览器侧行为：注入样式、读标记、标注行、注册插槽、装快捷键。
     * @param ctx 客户端 root context（`inject: ['slots']` 保证 ctx.slots 存在）。
     */
    function apply(ctx) {
      install();
      ctx.effect(function () { return dispose; }, 'sidebar-marks: styles, row annotations, panel, hotkey');

      ctx.slots.inject('sidebar.session.row.leading', function () {
        return ctx.slots.register(
          { name: 'sidebar.session.row.leading', id: 'dsh-sidebar-marks:dot', order: 100 },
          LeadingDot
        );
      });

      ctx.slots.inject('sidebar.workspaces.session.menu.item', function () {
        return ctx.slots.register(
          { name: 'sidebar.workspaces.session.menu.item', id: 'dsh-sidebar-marks:mark-item', order: 350 },
          MarkMenuItem
        );
      });
    }

    exports.apply = apply;
    exports.inject = ['slots'];

    // 测试与调试用的内部视图（运行时不会用到）。
    exports.__internals = {
      STORAGE_KEY: STORAGE_KEY,
      STYLE_TAG_ID: STYLE_TAG_ID,
      GLOBAL_KEY: GLOBAL_KEY,
      HOTKEY: HOTKEY,
      CSS: CSS,
      COLORS: COLORS,
      STRINGS: STRINGS,
      t: t,
      currentLang: currentLang,
      colorName: colorName,
      FILLS: FILLS,
      DARK_BOOST: DARK_BOOST,
      isHexColor: isHexColor,
      normalizeHex: normalizeHex,
      colorFor: colorFor,
      colorLabel: colorLabel,
      hexOf: hexOf,
      darkVariant: darkVariant,
      mixHex: mixHex,
      applyColorVars: applyColorVars,
      syncPanelLive: syncPanelLive,
      DOTS: DOTS,
      SIZES: SIZES,
      DEFAULT_MARK: DEFAULT_MARK,
      normalizeMark: normalizeMark,
      markOf: markOf,
      markOrDefault: markOrDefault,
      setMark: setMark,
      clearMark: clearMark,
      rowAttributes: rowAttributes,
      sessionIdOfRow: sessionIdOfRow,
      writeRow: writeRow,
      annotateRows: annotateRows,
      leftDotVisible: leftDotVisible,
      menuLabel: menuLabel,
      serialize: serialize,
      parse: parse,
      loadMarks: loadMarks,
      saveMarks: saveMarks,
      getMarks: function () { return marks; },
      setMarks: function (next) { marks = next; },
      openPanel: openPanel,
      closePanel: closePanel,
      renderPanel: renderPanel,
      getPanel: function () { return panel; },
      currentSessionId: currentSessionId,
      isEditable: isEditable,
      onKeydown: onKeydown,
      onContextMenu: onContextMenu,
      install: install,
      dispose: dispose,
      getVersion: function () { return version; }
    };

    return module.exports;
  }
});
