# agy-quota-rings

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey.svg)](https://github.com/suseirin-lab/agy-quota-rings/releases)
[![Release](https://img.shields.io/github/v/release/suseirin-lab/agy-quota-rings?color=1a73e8)](https://github.com/suseirin-lab/agy-quota-rings/releases/latest)

在 **Antigravity Desktop** 左下角常驻一个极简双圆环插件，一眼查看 **5 小时额度（上方大环）** 与 **本周额度（下方小环）** 及重置倒计时。

- 视觉对齐 **Google Material Design 3** + **Google Sans**，自动适配深色 / 浅色与各类主题背景；
- **实时跟随当前对话模型**：自动监测当前对话的模型选择（如 `Gemini 4 Argon`、`Gemini 4 Neon`、`Claude`、`GPT` 等），同对话切模型或切换对话时立即同步对应额度池；
- 点击展开极简额度卡片，顶部全名模型胶囊支持悬浮二级菜单与快捷切换、一键刷新、上下拖动调位置；
- **开源热更新推送（符合 GPL-3.0）**：监听程序启动后自动检查 GitHub Releases 最新版本，拉取开源明文 `quota-rings.js` 并原地热注入，无需重启 Antigravity；支持 `--no-auto-update` / `AGY_QR_NO_AUTO_UPDATE=1` 一键关闭，也支持通过 `AGY_QR_UPDATE_REPO=owner/repo` 指向任意开源 Fork；
- **独立安装包、无需 Node.js**，支持在图形安装器内一键选择：
  - **随 Antigravity 启动（推荐）**：关掉主程序即自动退出，不常驻后台；
  - **后台常驻监听**：开机自启，直接打开原版 Antigravity 即可自动注入生效。

---

## 一键安装（推荐 · 无需 Node.js）

前往 [**GitHub Releases**](https://github.com/suseirin-lab/agy-quota-rings/releases/latest) 下载对应平台的独立安装包：

- **Windows (x64)**：下载并双击 `AGY-Quota-Rings-v1.2.0-Windows-x64.exe` → 选择运行模式 → 点击 **一键安装**。
- **macOS (Apple Silicon / Intel 通用)**：下载并打开 `AGY-Quota-Rings-v1.2.0-macOS-universal.dmg` → 运行 `AGY Quota Rings.app` → 选择运行模式 → 点击 **一键安装**。

> 卸载同样只需再次打开安装器点击 **卸载**，自动清理快捷方式 / 启动项与配置。

---

## 从源码运行 / 自行构建

如需开发者热更新或自行打包（需 Node.js 22+）：

```bash
git clone https://github.com/suseirin-lab/agy-quota-rings.git
cd agy-quota-rings

npm run launch      # 托管模式运行（自动以 CDP 启动 Antigravity，关闭即退出）
npm run start       # 附加到已开启 CDP 的 Antigravity 并支持热更新
npm run build:win   # 构建 Windows 独立安装包 (.exe)
npm run build:mac   # 构建 macOS 通用安装包 (.dmg，需在 macOS 上运行)
```

> 如 Antigravity 安装在非默认路径，可设置环境变量 `ANTIGRAVITY_PATH` 指向 `Antigravity.exe`（Windows）或 `Antigravity.app`（macOS）。

---

## 隐私、热更新与安全说明

- 不修改 Antigravity 安装包文件，仅通过本机回环地址 `127.0.0.1` 的 CDP 端口动态注入 UI。
- 不收集、不上传任何用户数据或 Token 信息，详情见 [SECURITY.md](SECURITY.md)。
- **开源热更新透明性**：仅在启用自动更新时访问公开的 GitHub Releases 接口拉取明文开源的 `quota-rings.js`，不包含闭源二进制，也不上报任何遥测数据；可通过 `--no-auto-update` 或环境变量 `AGY_QR_NO_AUTO_UPDATE=1` 关闭，或通过 `AGY_QR_UPDATE_REPO` 自定义更新源。
- 与 `AGY Claude Style` 等插件兼容，可独立使用也可无冲突共存。

## Contributors

- **[@suseirin-lab](https://github.com/suseirin-lab)** — Creator & Maintainer
- **Antigravity (Google DeepMind)** — AI Co-author & Contributor

## 开源协议

本项目基于 [GNU General Public License v3.0 (GPL-3.0)](LICENSE) 开源。欢迎通过 [Issues](https://github.com/suseirin-lab/agy-quota-rings/issues) 和 [Pull Requests](CONTRIBUTING.md) 参与贡献。
