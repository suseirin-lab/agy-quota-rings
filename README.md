# agy-quota-rings

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey.svg)](#安装)
[![Node](https://img.shields.io/badge/Node.js-22%2B-339933.svg)](https://nodejs.org/)

在 **Antigravity Desktop** 左下角常驻一个极简双圆环插件，一眼查看 **5 小时额度（上方大环）** 与 **本周额度（下方小环）** 及重置倒计时。

- 视觉对齐 **Google Material Design 3** + **Google Sans**，自动适配深色 / 浅色与各类主题背景；
- 点击展开极简额度卡片，支持多模型池滑动胶囊切换、一键刷新、上下拖动调位置；
- **完全独立、零第三方依赖**，macOS 与 Windows 双平台共用同一套前端样式，外观与交互完全一致；
- **托管模式（Managed Mode）**：关闭 Antigravity 后监听进程自动退出，不留后台常驻。

---

## 环境要求

- **Antigravity Desktop**（macOS 或 Windows）
- **Node.js 22+**（使用内置 `WebSocket`，无需 `npm install`）

---

## 安装

### macOS

```bash
git clone https://github.com/suseirin-lab/agy-quota-rings.git
cd agy-quota-rings
chmod +x scripts/install-macos.sh scripts/uninstall-macos.sh
./scripts/install-macos.sh
```

安装后在 `~/Applications` 中打开 **`Antigravity (Quota Rings).app`**（可拖到程序坞 Dock 固定）。

### Windows (PowerShell)

```powershell
git clone https://github.com/suseirin-lab/agy-quota-rings.git
cd agy-quota-rings
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

安装后从 **桌面** 或 **开始菜单** 打开 **`Antigravity (Quota Rings)`**（静默启动，无黑框，可固定到任务栏）。

> 如果你的 Antigravity 安装在非默认目录，可设置环境变量 `ANTIGRAVITY_PATH` 指向 `Antigravity.exe`（Windows）或 `Antigravity.app`（macOS）。

---

## 命令行手动运行

```bash
npm run launch   # 自动带 CDP 启动/重启 Antigravity，并在关闭时自动退出
npm run start    # 附加到已开启 CDP 的 Antigravity 并支持热更新
npm run once     # 仅单次注入
npm run remove   # 从当前窗口移除插件
```

---

## 卸载

- **macOS**：`./scripts/uninstall-macos.sh`
- **Windows**：`powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-windows.ps1`

---

## 隐私与安全说明

- 不修改 Antigravity 安装包文件，仅通过本机回环地址 `127.0.0.1` 的 CDP 端口动态注入 UI。
- 不收集、不上传任何用户数据或 Token 信息，详情见 [SECURITY.md](SECURITY.md)。
- 与 `AGY Claude Style` 等插件兼容，可独立使用也可无冲突共存。

## 开源协议

基于 [MIT License](LICENSE) 开源。欢迎通过 [Issues](https://github.com/suseirin-lab/agy-quota-rings/issues) 和 [Pull Requests](CONTRIBUTING.md) 参与贡献。
