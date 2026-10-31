<!-- 由 `bun run gen:status` 生成，请勿手改；校验见 `bun run lint:status` -->
# 仓库状态（STATUS）

> README 中「多少个工具 / 多少条通道 / 多少个模块 / 多少篇文档语料」这类**易漂移数字**只在本文件出现，
> 由脚本从事实源现算，避免文档与代码脱节。
> 更新：`cd app && bun run gen:status` ｜ 校验：`bun run lint:status`（CI 门禁，内容不一致即阻断）。

| 指标 | 数值 | 事实源 | 口径 |
|---|---:|---|---|
| 内建工具 | **69** | `app/src/constants/toolNames.generated.ts` | 全量 ∧ 可实例化（flag-gated 且默认关闭者不计） |
| 消息通道 | **27** | `app/src/channels/ChannelCatalog.ts` | `CHANNEL_CATALOG` 登记的通道（含编译期可裁剪者） |
| 模块定义 | **71** | `app/src/modules/ModuleDefinitions.ts` | `MODULE_DEFINITIONS` 顶层条目 |
| 文档语料 | **145** | `app/docs/**/*.md` | 与 `docs/FileDocsProvider` 同口径（递归 `.md`，跳过隐藏目录与 `raw/`） |

## 说明

- 数值**随代码自动重算**：本文件不含时间戳，内容只随事实源变化 ⇒ 可直接逐字节比对。
- 新增指标请同批更新 `app/scripts/gen-status.ts` 的 `collect()` 与本文表头口径。
