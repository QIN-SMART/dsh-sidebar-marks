# Changelog

## 0.1.0

首个可用版本。

- 左侧边栏对话标记：整行淡色底（颜色 + 浓度自选，深色主题自动 +4 个点）、行尾/标题左侧彩色圆点、每条对话独立标题字号。
- 颜色支持 6 个预设色与任意自定义色号（色盘或 `#rrggbb`，深色下自动提亮）。
- 三个入口：对话行「…」菜单 → 标记…、`⌘⇧M` / `Ctrl+Shift+M`、右键任意对话行。
- 标记存 `localStorage['dsh.sidebar-marks.v1']`，多标签页用 `storage` 事件同步。
- 未标记的对话与原生界面完全一致；对话正在跑或已归档时自动降级。
- 面板文案跟随 DSH 界面语言（中文 / English）。
- Windows 加固：面板与遮罩声明 `-webkit-app-region: no-drag`；输入法组字期间不抢快捷键。
- 24 个自测用例（原 22 个）（`node --test test/verify.mjs`），零运行时依赖；CI 覆盖 ubuntu / windows / macos × Node 22 / 24。
