# 种子数据模板（seed/pyapp）

此目录是 Liri 首次分发的**默认种子数据**（git 跟踪），打包时复制到
`<pkg>/app/data/pyapp/` 或 Tauri 资源目录 `app/data/pyapp/`，应用首次运行时
再由 `core/seedSync.ts` 幂等同步到用户数据目录 `~/.pyapp/`。

## 内容约定

- `SOUL.md` / `USER.md` — 默认人格与身份（用户可自行修改覆盖）
- `knowledge/` / `skills/` — 空骨架，保持目录结构就位，内容由用户导入
- `data/memory/memory-index.json` — 记忆索引骨架

## 禁止事项

- ❌ 不得放入用户私有数据（个人文档、项目分析报告、密钥等）
- ❌ 不得放入运行时产物（db、logs、cache、attachments 等）
- ❌ 不得放入 credentials/ 凭证文件
