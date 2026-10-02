# dsh-sidebar-marks — agent 约定

**DSH 侧边栏对话标记插件**：给侧边栏对话加整行淡色底、行尾/标题左侧彩色圆点、可选独立标题字号。
没被标记的对话与原生界面**完全一致**。仓库根就是 npm 包根（`package.json` 在第一层）。

给任何编码 agent（Codex / Claude Code / Cursor / DSH 自身）读；动手前先扫下面的硬约束。

## 结构

| 文件 | 作用 |
|---|---|
| `package.json` | 清单：`dsh.bundle.patch`、`dsh.client.platform`、`exports["./client"]`、`icon`、`exports["./locale/*.json"]`、`files` 白名单 |
| `cordis.patch.yml` | 一行 `insert`，让本包成为 enabled 的 Loader entry |
| `index.mjs` | 宿主半边，故意惰性（只为让浏览器半边被加载） |
| `lib/client.js` | **全部行为**：`window.__ModuleLoader__.load({ id: 'dsh-sidebar-marks', factory })` |
| `lib/client.js` → `exports.__internals` | 自测用的内部视图（运行时不用） |
| `locale/{en,zh}.json` | 插件列表里的标题/描述（en 是解析锚点） |
| `test/verify.mjs` | 24 项自测：mock DOM 上加载**真实产物**，零依赖 |
| `tools/publish-to-github.mjs` | 走 GitHub REST API 发布（空仓库自动引导；`--release` 打 tag + 建 Release） |
| `tools/real-ui-check.mjs` | CDP 驱动真实 DSH WebUI 冒烟检查 + 截图 |
| `demo/*.html`、`docs/*.png` | 合成数据的交互样例与截图（**不含真实会话名**） |

## 关键标识（改名/重构时必须一起改）

| 项 | 值 |
|---|---|
| `ModuleLoader.load({ id })` | `dsh-sidebar-marks`（**必须等于 package.json 的 name**，否则浏览器侧永不 materialize） |
| 调试全局 | `window.__dshSidebarMarks` |
| 持久化 | `localStorage['dsh.sidebar-marks.v1']`，形如 `{version:2, marks:{<sessionId>:{color,fill,dots,size,weight}}}` |
| 快捷键 | `Mod+Shift+M`（macOS `⌘⇧M` / Windows·Linux `Ctrl+Shift+M`） |
| 样式表标记 | `data-plugin="dsh-sidebar-marks"` + `data-plugin-css="dsh-sidebar-marks/style"` |
| 行钩子 | `[data-row-key^="session:"]`；行属性 `data-dshmk-*`；CSS 变量 `--dshmk-*` |
| 用到的插槽 | `sidebar.session.row.leading`（圆点，order 100）、`sidebar.workspaces.session.menu.item`（菜单项，order 350） |

## 硬约束（踩过的，逐条有现场）

1. 客户端模块**平铺导出** `exports.apply` / `exports.inject`，**绝不 `export default`**（loader 的 `unwrapExports` 会让 `inject` 静默丢失，挂载即报 `without inject`）。
2. 凡读 `ctx.<service>` 必须先写进 `inject`；可选依赖用 `ctx.get(...)` 或 `ctx.inject([...], cb)`。
3. **不要用 CSS-module 哈希类名**（`YDXeBa_sessionRow` 每次构建都变）：只用 `[data-row-key^="session:"]`、插槽名、`aria-selected`、`body[data-ds-dark-theme]`、`<html lang>`；行内**第 2 个 `span`** 才是标题（第 1 个是插槽格）。
4. 叠加在行上的底色用 `background-image: linear-gradient(...) !important` —— DSH 的 hover/选中用 `background` 简写，会重置 `background-image`。
5. 自己注入的 `<style>` 必须打 `data-plugin` / `data-plugin-css`（否则可能被别的插件认领并在其卸载时删掉）。
6. 插槽会「让位」：`sidebar.session.row.leading` 在 archived / blank / 有状态点时**不渲染** → 关键信息走行级标记兜底。
7. 桌面版浮层（面板与遮罩）必须 `-webkit-app-region: no-drag`，否则 Windows/macOS 标题栏拖拽区会吞掉点击。
8. 快捷键要躲开输入法组字：`event.isComposing || event.keyCode === 229` 直接返回，并跳过可编辑元素。
9. `ctx.effect` 的 dispose 要清干净：observer、定时器、样式表、keydown/storage 监听、浮层、调试全局。
10. 对外元数据三件套缺一不可：`icon` + `exports["./locale/*.json"]` + `locale/{en,zh}.json`。改了 `exports` 表要**重启 dsh web** 才生效（Node 缓存了 package.json）。

## 常用命令

```sh
node --test test/verify.mjs                          # 自测（24 项，零依赖）
node tools/real-ui-check.mjs --port 3080             # 真实 GUI 冒烟 + 截图（会写 docs/real-ui*.png，已 gitignore）
GH_TOKEN=<PAT> npm run publish:github -- --release   # 推 GitHub + 打 tag + 建 Release（PAT 需 repo + workflow scope）
npm publish                                          # 发 npm（已配 bypass-2FA 令牌，无需 OTP）
```

## 隐私红线

`docs/` 里只放**合成数据**的截图；真实界面截图（会拍到真实会话标题）一律不入库，`.gitignore` 已挡 `docs/real-ui*.png`。
提交前扫一遍：`grep -rn "/Users/\|/home/" --exclude-dir=.git .`

更完整的契约、踩坑库与验收清单见 DSH 的 `dsh-plugin-authoring` skill（本机 `/Users/qin/Documents/test/dsh-plugin-kit/dsh-plugin-authoring/`）。
