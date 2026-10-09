# Spec：大文件拆分（C3 子 spec）

> 版本 1.0 ｜ 创建 2026-10-09 ｜ 状态：**S1 已实施；S2+ 待实施**
> **来源**：`dev_docs/20261009/任务计划.md` §3-C3（O6）· 主 spec `.trae/specs/execution-lifecycle-ownership.md`（§8）
> **关联规则**：GR15 · CS01（拆分只搬位置、不改语义）· CS03（最小化）· CS06（证据驱动）· `project_rules.md` · R04-001（文件行数）· R05-011（Message 规范路径）· R03-002（模块出口单一）

---

## 1. 证据订正（CS06，先于实施）

计划 §3-C3 的表述**已过时**，实测如下：

| 计划表述 | 实测 | 证据 |
|---|---|---|
| 「按 `project_rules §1.13`（单文件 ≤1000 行）」 | §1.13 现为**路径与依赖管理规范**（非尺寸）；尺寸门禁是 **R04-001**，上限 **2000 行**（2026-10-05 由 1000 上调） | `scripts/lint-architecture.ts:92`（`ARCH_MAX_LINES \|\| 2000`）；`scripts/lint-file-size.ts:18` |
| 「`lint:size` 归零」 | **已满足**：`lint:size` = **0 错误**（472 警告 + 8 例外豁免） | `bun run lint:size` 实测 |
| 点名 4 文件的规模 | `session/types/message.ts`(1265) · `messageRouter.ts`(1067) · `ToolFactory.ts`(1069) **均在 2000 之下**（**警告**级，非错误级）；唯 `CoreAPIImpl.ts`(2522) 超限且**已豁免** | `scripts/layer-exceptions.json` 的 `fileSizeExceptions`（8 项） |

**真实尺寸债 = 8 个豁免巨头**（>`2000`，`expiresAt 2026-11-30`，均需按文件单独立项）：
`chat/ChatManager.ts`(5246) · `runtime/api/CoreAPIImpl.ts`(2522) · `tasks/LongRunningTaskOrchestrator.ts`(2715) ·
`tools/AgentTool/AgentTool.ts`(2678) · `chat/orchestrator/streamMessageFlow.ts`(2771) · `chat/ReActToolLoop.ts`(2573) ·
`client/src/i18n/locales/{zh,en}.ts`(5911/5988)。

⇒ **C3 不是"合规缺陷修复"，而是可维护性增量治理**（警告级不阻塞合并）。

---

## 2. 范围决策

- **做**：按**内聚**拆分，逐文件推进；每片**只搬位置、不改语义**，并以 `typecheck`（引用解析）+ 全量测试作为正确性验证。
- **拆分的硬约束**：
  1. **对外 API 不变**：被拆文件保留为 **barrel**（`export *`），既有 import 零改动；
  2. **规范路径不迁移**：如 `Message` 必须仍定义在 `session/types/message.ts`（R05-011 口径）⇒ 只把**外围**分组移出；
  3. **不做行为变更**：不合并/不改写逻辑。
- **不做**：8 个巨头的一次性拆分（各自体量与风险差异极大，须**逐文件子 spec**）。

---

## 3. S1：`session/types/message.ts`（1265 → 379 行，已完成）

| 拆分后 | 内容 |
|---|---|
| `message/enums.ts` | `MessageRole/Type/Status/Priority` · `AttachmentType` · `MessageAttachment` · `MessageCategory` · `User/Assistant/SystemMessage` 别名 |
| `message/blocks.ts` | `ContentBlockType` · `ContentBlock` · `CompactBoundaryType` · `CompactBoundaryMessage` · `ToolUseSummary` · `ToolUseSummaryMessage` · `AttachmentMessage` |
| `message/options.ts` | `SendMessageOptions` · `StreamMessageOptions` · `CreateMessageParams` |
| `message/factories.ts` | `generateId/generateMessageId/generateAttachmentId` · `createMessage/User/Assistant/Tool/System` · `normalizeMessage(s)` · `reorderMessages` · `createCompactBoundaryMessage/createToolUseSummaryMessage/createAttachmentMessage/createToolUseSummary` |
| **`message.ts`（barrel + 核心）** | 保留 `Message`（**规范路径**）· `NormalizedMessage` · `UsageInfo` · `ToolCallEventDetail` · `ChatResponse` · `StreamChunk`，并 `export *` 重导出上述 4 模块 |

**依赖方向（无运行时循环）**：`factories` 只对 `Message`/`NormalizedMessage`/`CreateMessageParams` 用 `import type`（擦除），
对枚举用**值导入**（`./enums`/`./blocks`）⇒ barrel ⇄ factories 之间**无运行时环**。

---

## 4. 待实施 backlog（按风险递增；每项独立评审）

| 序 | 目标 | 规模 | 风险 | 备注 |
|---|---|---|---|---|
| S2 | `tools/**/ToolFactory.ts` | 1069（警告） | 中 | runtime；工厂注册表，按工具族拆 |
| S3 | `channels/routing/messageRouter.ts` | 1067（警告） | 中高 | **渠道入站唯一入口**（R03-004 门禁依赖其路径/函数名）⇒ 拆分须保留 `routeChannelMessage` 于原文件 |
| S4 | `runtime/api/CoreAPIImpl.ts` | ~~2522~~ → **1898**（**已达标，豁免 FSZ-007 已移除**） | — | ✅ 2026-10-09：S1 外迁 `sessionAgentOps.ts` + S3 外迁 `llmChatOps.ts`；子 spec `.trae/specs/core-api-impl-split.md`（S2 `chatStream` 仅余**可维护性**性质） |
| S5 | `chat/ChatManager.ts` | 5246（**豁免**） | 高 | 最大；已有多次薄转发拆分（`ChatOrchestrator`/`eventLogStore`/`recovery`）可循 |
| S6 | `chat/orchestrator/streamMessageFlow.ts` · `chat/ReActToolLoop.ts` | 2771 / 2573（豁免） | 高 | 会话主干 |
| S7 | `tasks/LongRunningTaskOrchestrator.ts` · `tools/AgentTool/AgentTool.ts` | 2715 / 2678（豁免） | 高 | — |
| S8 | `client/src/i18n/locales/{zh,en}.ts` | 5911 / 5988（豁免） | **中低** | 纯数据；按命名空间拆 + barrel（**性价比最高**） |

---

## 5. 规则合规 Checklist

| 规则 | 落点 |
|---|---|
| CS01/CS03 | 拆分**只搬位置**、公共 API 不变（barrel 重导出）；无逻辑改动 |
| CS06 | 门禁阈值/豁免清单/警告计数**均实测取证**（§1） |
| GR15 | 本 spec 先于实施 |
| R04-001 | 拆后各文件 <500 行（不再计入警告）；豁免清单**不新增** |
| R05-011 | `Message` 仍定义在 `session/types/message.ts`（`lint:arch` 实测 "0 个文件自定 Message 类型"） |
| R03-002 | 对外仅 `@modules/session/types/message`；子模块为**模块内相对引用**（`lint:arch` 实测子目录违规 0） |

---

## 6. 实施记录

### S1（2026-10-09，已实施并验证）

| 交付 | 落点 |
|---|---|
| 4 个子模块 + barrel | `app/src/session/types/message/{enums,blocks,options,factories}.ts` · `app/src/session/types/message.ts` |

**验证**：`typecheck` ✅ · `lint:arch` ✅（0 错；Barrel 0 · 子目录违规 0 · Message 模型 0）· `lint:doc-code` ✅ ·
`lint:size` **471 警告**（较改前 472 → **`session/types/message.ts` 警告清除**，且 4 个新文件均 <500）·
`tests/{session,chat,core,execution,channels}` **1028 pass / 0 fail**（137 文件）。

### S2+（待实施）

按 §4 backlog 逐项推进；每项完成后回填本表并更新 `typecheck`/测试证据。

---

## 7. 候选评估（2026-10-09；为何暂缓部分 backlog 项）

对 §4 前两项做了取证评估，结论：**风险/收益比差，暂缓**（CS03 最小化；警告级不阻塞合并）：

| 候选 | 实测形态 | 结论 |
|---|---|---|
| `tools/ToolFactory.ts`(1069) | **扁平同质**：单个 `ToolFactory` 类 + ~50 个**一行式** `create*Tool()` 委托方法（`return new XTool()`），仅 4 个方法内联 def | 拆分近乎**纯 churn**：无混杂职责可分离；拆出去的方法仍需挂在同一 API 面 ⇒ **暂缓** |
| `client/src/i18n/locales/{zh,en}.ts`(5911/5988) | **纯数据**（`export default { … }` 命名空间对象） | 拆分可行但需**搬移 ~12,000 行**数据；收益仅"警告消除" ⇒ **优先级让位于**价值更高的遗留/巨头治理 |

⇒ **建议顺序**：先做**价值型**收尾（如 PR4 遗留-⑨ 已闭环、PR2 遗留-2 准入），
再按 §4 逐项处理巨头（`CoreAPIImpl`/`ChatManager`/`streamMessageFlow`/`ReActToolLoop`）——它们**超门禁且已豁免**，才是真实尺寸债。
