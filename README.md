# agy-quota-rings

一款为 **Antigravity Desktop** 设计的极简独立小插件：在左侧边栏左下角显示类似 Codex 风格的 **双圆环 Token 额度指示器**（上方大环为 **5 小时额度**，下方小环为 **本周额度**），视觉遵循 **Google Material Design 3** 与 **Google Sans** 规范。

## 特性

- **完全独立、零依赖**：不依赖 `AGY Claude Style` 或任何第三方 npm 包（Node.js 22+ 原生 `WebSocket` 驱动）；如果你同时安装了 `AGY Claude Style`，会自动复用其配额缓存并无冲突共存。
- **Codex 风格双圆环**：
  - 上方大环（`32px`）：5 小时滚动额度剩余百分比
  - 下方小环（`22px`）：本周额度剩余百分比
  - 联动防误导：当周额度耗尽（`0%`）时，5 小时环同步标红警示
- **Google Material 3 设计语言**：
  - 实时自动适配深色 / 浅色及各类主题背景（`color-mix()` Tonal Surface + 实时亮度检测）
  - Google 官方语义色板（Google Blue / Green / Amber / Red）+ `Google Sans` 字体
  - 多模型池分段胶囊带丝滑滑动高亮指示器（Sliding Pill），支持点击刷新与上下拖动调位置
- **托管启动（Managed Mode）**：关闭 Antigravity 后监听进程自动退出，0 后台常驻。

## 快速安装（macOS）

要求：**Node.js 22+**、**Antigravity Desktop**。

```bash
git clone https://github.com/suseirin-lab/agy-quota-rings.git
cd agy-quota-rings
chmod +x scripts/install-macos.sh scripts/uninstall-macos.sh
./scripts/install-macos.sh
```

安装完成后，打开 `~/Applications/Antigravity (Quota Rings).app`（可拖到程序坞 Dock 固定），即可自动以 CDP 模式启动 Antigravity 并挂载双圆环插件。

## 手动命令行运行

如果 Antigravity 已经通过 `--remote-debugging-port=0` 启动：

```bash
# 单次注入
npm run once

# 持续监听并支持热更新
npm start

# 自动带 CDP 重启 Antigravity，并在关闭时自动退出
npm run launch

# 从当前窗口移除插件
npm run remove
```

## 卸载（macOS）

```bash
./scripts/uninstall-macos.sh
```

## 说明

- 本插件不会修改 `/Applications/Antigravity.app` 本体文件，仅通过本机 `127.0.0.1` CDP 端口动态注入界面组件。
- 代理或外网 IP 切换不会影响本插件工作（已显式隔离代理环境变量并仅连接 `127.0.0.1`）。

## License

MIT
