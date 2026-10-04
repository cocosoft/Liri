# Spec：`R03-002` 模块根单一事实源（`moduleRoots` 由 `modules-to-layers.json` 派生）

> 版本 1.0 ｜ 创建 2026-10-04 ｜ 状态：📝 **立项待评审（未动码）**
> 来源：台账 **D-3-c**（2026-10-01 D-219 执行 `workspaces` 组时发现）· `dev_docs/任务计划-20261004.md` §2.1 **P0-6（方案 C1）**
> 关联规则：GR01（归一化）/ GR02（实现唯一性）/ GR03（证据驱动）/ R06-008（分层）/ R03-002（模块出口单一）

## 1. Problem Statement

`scripts/lint-architecture.ts` 的 `checkModuleSingleExport()`（`R03-002` 模块出口单一）用一份**独立硬编码的 `moduleRoots` Set**（`scripts/lint-architecture.ts:2043` 起，约 39 项）判定"模块子目录直连 import"是否违规。

而分层映射的**唯一事实源**是 `scripts/modules-to-layers.json`（**86 模块**）。两者**已漂移**：`moduleRoots` 缺 `workspaces` / `compaction` / `workspace` / `docs` / `knowledge` / `governance` / `evals` / `project` / `models` / `flows` / `wizard` / `tool` / `testing` / `plugin-sdk` / `context-engine` / `analytics` / `common` / `constants` / `media` / `i18n` / `lsp` / `security` / `system` / `trace-recording` / `daemon` / `modules` / `appState` 等。

**影响（如实）**：上述模块的**子路径直连**不计入 `R03-002` ⇒ 该门禁对它们**形同未检**（实例：`@modules/workspaces/WorkspaceScanner` 长期"零违规"，直到本轮改直连才被读出）。
**性质**：这是**门禁口径的盲区**（同一语义两份名单，CS01/GR02 违背），**不是**运行期缺陷。

## 2. 目标

- **G1**：`moduleRoots` 改为**从 `modules-to-layers.json` 派生**（单一事实源），消除漂移。
- **G2**：派生后**判定语义不变**——仍以"目标模块**有 `index.ts`** 才要求单一出口"为准（无 index 的模块其子路径导入**非违规**，`lint-architecture.ts:2180-2185`）；R03-002 的"规范子入口白名单（`canonicalEntryKeys` / `types` 段）"应保留。

## 3. 决策点（需用户裁定）

| 点 | 选项 | 说明 |
|---|---|---|
| D1 | (a) 直接派生并**一次性暴露存量** / (b) 派生 + 存量登记例外分批收口 | 派生会暴露一批此前"看不见"的违规 ⇒ 需配套收口/续期策略 |
| D2 | 是否**本次即改门禁口径** | 依 T-③01 口径：**门禁判定变更须用户裁定**（D-3-c 原文已明示"须另立专项裁定"） |

## 4. 非目标（明确不做）

- **不**改 `R03-002` 的判定语义（仍"有 index 才要求出口"）。
- **不**收口业务代码里的存量直连（属另一批任务；本 spec 只负责"口径单一化 + 暴露"）。
- **不**改 `modules-to-layers.json` 的层归属。

## 5. 影响面（预计）

- `scripts/lint-architecture.ts`：`checkModuleSingleExport()` 的 `moduleRoots` 构造改为读 `modules-to-layers.json`（+ 保留既有白名单）。
- 派生后**首次运行**预计暴露一批 `R03-002` 违规（数量未量化 ⇒ 属 D1(a) 的代价）；须先在**本地**跑一次量化。

## 6. 验收判据

1. `moduleRoots` 不再有内联名单（`grep` 派生自 `modules-to-layers.json`）；
2. 同时**完整覆盖** 86 模块（可断言"派生集合 ⊇ 已知关键模块"，含 `workspaces`/`compaction`/`knowledge` 等缺项）；
3. `bun run typecheck` 0；`lint:arch` **0 错**（存量若超预期则按 D1(b) 分批登记，不得静默放宽）；
4. 提供**可证伪**证据：注入一处"已知模块的子路径直连"⇒ `R03-002` 报红；还原后归零。

## 7. 合规检查清单（GR 对照）

| 规则 | 落点 |
|---|---|
| GR01 归一化 | `moduleRoots` 改为派生，消除第二份名单 |
| GR02 实现唯一性 | 模块清单事实源唯一（`modules-to-layers.json`） |
| GR03 证据驱动 | 缺项清单与"暴露量"须 grep/实跑取证，不臆断 |
| R06-008 分层 | 不改层表，只消费既有事实源 |
| T-③01 | 门禁判定变更 ⇒ D2 须用户裁定后方可实施 |
