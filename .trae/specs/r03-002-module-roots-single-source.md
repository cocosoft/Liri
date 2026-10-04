# Spec：`R03-002` 模块根单一事实源（`moduleRoots` 由 `modules-to-layers.json` 派生）

> 版本 1.2 ｜ 创建 2026-10-04 ｜ 状态：✅ **G1/G2 已实施**（派生单一事实源 + 存量显式登记）；存量**收口**（分批走桶 / 为 barrel 增补导出）待做
> 来源：台账 **D-3-c**（2026-10-01 D-219 执行 `workspaces` 组时发现）· `dev_docs/任务计划-20261004.md` §2.1 **P0-6（方案 C1）**
> 关联规则：GR01（归一化）/ GR02（实现唯一性）/ GR03（证据驱动）/ R06-008（分层）/ R03-002（模块出口单一）

## 0. 实施记录（2026-10-04）

- **G1 达成**：`checkModuleSingleExport()` 的 `moduleRoots` 由 45 项硬编码 Set → **从 `scripts/modules-to-layers.json` 直接读取派生**（规避 §5 的时序陷阱）。
- **G2 达成**：判定语义不变（仍"有 `index.ts` 才要求出口"；`canonicalEntryKeys`/`types` 段白名单保留）。
- **存量按 D1(b) 显式登记**：派生后首次计入的 **42 个子入口**（原 99 处导入）登记入 `canonicalEntryKeys`，**逐条附理由 + 收口批次**（① barrel 已导出最易 → ② ③）。**非静默放宽**：这些模块此前**不在** `moduleRoots` 内、同为零检查；本批把「隐式盲区」变为「显式债」。
- **可证伪（§6 判据 4）**：注入 `import { IntelligentAnalysisService } from '@modules/analytics/IntelligentAnalysisService'`（`analytics` 派生后才计入、且未登记）⇒ `R03-002` 报 **1 处违规**、`错误: 1`；删除后归零。
- **验证**：`lint:arch` **0 错误 / 4 警告**（白名单 `786 → 909`）；`typecheck` **0**。
- **✅ 收口批次① 已完成**（2026-10-04）：`tokenBudget{BudgetPolicy,PriceManager,CacheAwareBudget}` · `streaming/scrubbers` · `constants{common,systemPromptSections}` · `security/injection` · `skills/SkillRegistry` —— 共 **41 处**导入改走模块 barrel（含 4 处相对路径子目录、6 文件重复 import 合并），并从 `canonicalEntryKeys` **移除对应 8 个登记键**（R03-002 白名单 `909 → 873`）。**未收口**：`security/policy`（barrel 未导出 `channelPermissions` / `imageSanitizationPolicy` 残留符号）⇒ 键**保留**，归批次②（先为 barrel 增补导出）。
- **✅ 收口批次② 已完成（安全子集 A/B/C）**（2026-10-04）：`security/policy`（为 `security` barrel **增补** `channelPermissions` / `imageSanitizationPolicy` 值导出后收口 4 处）· `workspaces/WorkspaceScanner`（barrel 已 `export *` ⇒ 收口 2 处）· `workspaces/commands`（`workspaces` barrel **增补** `export * from './commands/session'` 后收口 2 处）；移除 3 个登记键（白名单 `873 → 864`）。
- **保留为「唯一入口」（非债，附原因）**：`workspace/CouncilOrchestrator`（barrel 未聚合该子路径，且 Council 系为动态导入打破环）· `components/{TaskListV2,ui}`（`components` 桶当前近乎空壳）· `skills/{loaders,services,cli}`（无聚合出口）。
- **✅ 收口批次③ 已完成（收尾）**（2026-10-04）：`docs/*`(4 键) · `analytics/*`(3) · `knowledge/{KnowledgeDigestInjector,KnowledgeBaseWriter,graph}` · `bootstrap/*`(3) · `common/utils` · `modules/ModuleDefinitions` —— 共 **15 个键**收口（白名单 `864 → 843`）；barrel 增补 `knowledgeDocsProvider` / `FileDocEntry` / `IKnowledgeSearch` / `PerformanceMonitorService` 等轻量导出。
- **保留为「唯一入口」（非债，环证据）**：`knowledge/frontmatter`（改走 `@modules/knowledge` 桶 → 经 `tools/KnowledgeWriteTool` 回指 `docs/FileDocsProvider`，构成**模块自环**）· `governance/managers`（改走 `@modules/governance` 桶 → 经 `GovernanceManager` 回指 `@modules/tools` 桶，构成 **tools ↔ governance 双向环**）；精确文件导入正是破环入口。
- **收口收官**：批次①②③ 共**移除 26 个登记键**（白名单引用 `909 → 843`），其余约 16 键经证据判定为「唯一入口」（barrel 未导出 / 命名不一致 / 环安全）**永久保留**。附带修复：`knowledge/__tests__/benchmark-baseline.ts` 因 Windows 路径分隔符致 `TEST_FILE_EXCLUSIONS` 失配、测试文件被误判为生产文件（已连同 2 处导入改走 barrel 消除，并登记台账）。

## 1. Problem Statement

`scripts/lint-architecture.ts` 的 `checkModuleSingleExport()`（`R03-002` 模块出口单一）用一份**独立硬编码的 `moduleRoots` Set**（`scripts/lint-architecture.ts:2041-2087`，**实测 45 项**）判定"模块子目录直连 import"是否违规。

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

**推荐（2026-10-04 量化后）**：
- **D1 = (b)（派生的存量与门禁切换必须同批）**：先**逐点判定** 99 处 —— 确属"循环安全子入口 / 唯一入口"者**补入 `canonicalEntryKeys`（逐条附理由）**；其余**改走桶**（`@modules/<mod>`）。**禁止**整批白名单化（＝静默放宽，违背本 spec §4 非目标）。
- **D2 = 是（须用户裁定）**：单一事实源本身是 GR01/GR02 的正确收敛；但 `R03-002` 自 2026-10-03 起为 **error 级阻断** ⇒ 必须"派生 + 存量处置"**同一批**落地，使切入口径那一刻 `lint:arch` 仍为 **0 错**。

## 4. 非目标（明确不做）

- **不**改 `R03-002` 的判定语义（仍"有 index 才要求出口"）。
- **不**收口业务代码里的存量直连（属另一批任务；本 spec 只负责"口径单一化 + 暴露"）。
- **不**改 `modules-to-layers.json` 的层归属。

## 5. 影响面（**已量化**，2026-10-04 本地实跑）

- `scripts/lint-architecture.ts`：`checkModuleSingleExport()` 的 `moduleRoots` 构造改为读 `modules-to-layers.json`（+ 保留既有白名单）。
- **实测量化**（试派生后跑 `lint:arch`，随后**已回滚**）：
  - 硬编码 Set = **45 项**（`lint-architecture.ts:2041-2087`）vs 映射 `modules-to-layers.json` = **86 模块**；
  - 派生后 `[R03-002]` 违规 **0 → 99 处**、门禁 **`错误: 0 → 1`**（白名单 `786 → 810`）⇒ **一次性放出 99 处存量**（确认 D1(a) 代价「大」）。
  - **违规按目标子入口聚合（top）**：`streaming/scrubbers` 8 · `security/*`（policy/injection/patterns/validators/scanners/redact/bash/files）≈17 · `constants/*`（systemPromptSections/common）≈15 · `tokenBudget/*`（UnifiedTokenTracker/BudgetPolicy/TokenBudgetController/PriceManager/CacheAwareBudget）≈14 · `skills/*`（loaders/services/cli/SkillRegistry）≈11 · `docs/*`（FileDocsProvider/knowledge-types/TemplateService/DocumentVersionService）≈10 · `components/*`（ui/TaskListV2）4 · `knowledge/*` 4 · `workspaces/*` 3 · `bootstrap/*` 3 · `analytics/*` 3 · 其余零散。
  - **性质**：多数为"该模块**已有 barrel** 但消费方直连子路径"，其中**一部分是良性的循环安全 / 唯一入口**（如 `constants/systemPromptSections`），另一部分应按 GR02 改走桶 ⇒ **须逐点判定**，不可机械放宽。

- ⚠️ **实现约束（重要 · 2026-10-04 新发现）**：`loadLayerMapping()`（填充 `this.moduleToLayer`）在 **R 检查之后**执行 ⇒ 派生**禁止**依赖 `this.moduleToLayer`（会得**空集**、**静默关闭 R03-002**；实测白名单 `786 → 0` 的**假绿**）；**必须直接读 `modules-to-layers.json`**（或先调整加载时序）。

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
