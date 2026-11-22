# Contributing to agy-quota-rings

感谢你对 `agy-quota-rings` 的关注！欢迎提交 Issue、功能建议和 Pull Request。

## 开发与校验

本项目零第三方依赖，仅需 **Node.js 22+**。

```bash
git clone https://github.com/suseirin-lab/agy-quota-rings.git
cd agy-quota-rings
npm run check
```

修改 `src/quota-rings.js` 后，运行 `npm start` 即可在已开启 CDP 的 Antigravity 窗口中实时热更新。

## 提交规范

- 保持单一职责，避免引入不必要的外部依赖；
- 所有 UI 变更请同时保证 **macOS 与 Windows 视觉一致**，并兼顾深色 / 浅色主题；
- 提交前请确保 `npm run check` 及平台安装脚本语法检查通过；
- Commit 信息建议采用 Conventional Commits（如 `feat: ...`、`fix: ...`、`docs: ...`）。

## 行为准则

参与本项目即表示同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
