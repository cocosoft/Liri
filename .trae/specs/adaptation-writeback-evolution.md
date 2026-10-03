# 经验自动演化写回（Adaptation Write-back Evolution）— Spec

- **来源**：`dev_docs/20261001/pending-tasks-consolidated-20261001.md` **T-②06**（原始出处 `dev_docs/20260928/architecture-benchmark-20260928.md` §6.4 #9）
- **状态**：🚧 **阶段 1 已实施**（写回面 + 回灌面，2026-10-03）· **阶段 2 待实施**（LLM 生成 + 触发 + 事件）
- **裁定**（用户，2026-10-03）：**完整自动演化**；写回形态 **两者都做**（受管提示覆盖层 + 技能侧车）
- **一句话**：把"失败/评审经验"自动演化成**可回滚的提示/技能增量**，并**自动回灌**到后续请求。

---

## 1. 取证（2026-10-03）

| 事实 | 坐标 |
|---|---|
| `SkillCurator.patch()` 只写 `patchedAt` + 一条历史字符串，**不改技能内容**；且全仓**零调用者** | `skills/SkillCurator.ts:252-259` |
| `startScheduler()` **零调用者**，其 interval 体**只更新 `lastCuratedAt`**（`autoConsolidate` 默认 false）⇒ 空转 | 同文件 `:369-388` |
| 消费者**存在**（订正 benchmark 原文）：`SkillLifecycleManager` 已接线 | `skills/persistence/SkillLifecycleManager.ts:86-91` |
| `selfImprove`/`promptEvolution`/`rewritePrompt`/`strategyFeedback` **全仓 0 命中** | Grep |
| **但**「经验 → 持久化 → 自动回灌」闭环**已存在**：写回 `_persistMemoryFromAudit` → 精炼 `MemoryDreamService` → 注入 `memoryContext` 分段（`getMemorySummaries(10)` + 内容哈希缓存）/`sessionMemory` 分段 | `tasks/LongRunningTaskOrchestrator.ts`、`memory/consolidation/MemoryDreamService.ts`、`context/promptSections/builtinSections.ts:242-286`、`chat/services/MessageContextPipeline.ts:919-961` |

⇒ 真缺口收窄为「**改写技能/提示产物本身**」（而非"无反馈"）。

---

## 2. 裁定（2026-10-03）

1. **完整自动演化**（非"仅接线"、非"不实施"）。
2. 写回产物形态：**两者都做** —— 受管**提示覆盖层** + 技能**侧车**。

---

## 3. 设计

### 3.1 两种形态（为什么不是"改写原文"）

| 形态 | 落点 | 回灌方式 |
|---|---|---|
| 提示覆盖层 | `<data>/prompt-evolution/overlay.md`（+ `versions/`） | 新增系统提示词分段 `promptEvolution` |
| 技能侧车 | `<userSkillsDir>/<name>/.evolution.md` | `FileSkillLoader` 加载 `SKILL.md` 时**追加合并** |

**共同原则**：**只追加、不改写**用户/内置文件 ⇒ 可回滚（覆盖层有版本目录）、不侵入用户资产（技能来源隔离 `project_rules §1.15`）。

### 3.2 阶段 1（✅ 已实施，2026-10-03）：写回面 + 回灌面

| 文件 | 变更 |
|---|---|
| `core/paths.ts` | ➕ `resolvePromptEvolutionDir()` |
| `utils/promptEvolution.ts` 🆕 | 覆盖层 读/写/归档/**回滚**/版本裁剪 + 技能侧车 读/写/目录读；**唯一读写实现**（CS01）；上限（覆盖层与侧车各 4000 字符）；技能名**越界拒绝** |
| `constants/systemPromptSections.ts` | ➕ `SECTION_NAMES` 增 `'promptEvolution'` |
| `services/prompt/promptSectionLayers.ts` | ➕ `SECTION_META.promptEvolution = { layer: 'L3' }` |
| `context/promptSections/builtinSections.ts` | ➕ `promptEvolution` 段落（**空 ⇒ null 不注入**；uncached） |
| `skills/loaders/sources/FileSkillLoader.ts` | 🔧 目录形态追加同目录 `.evolution.md` 侧车 |
| `tests/utils/promptEvolution.test.ts` 🆕 | 10 用例（往返/归档回滚/上限/裁剪/侧车/越界/不碰 SKILL.md） |

**分层**：读写实现放 `utils`(infra) —— `context`(app) 与 `tasks`(app) 都要用；落任一侧会造成同层强耦合。

### 3.3 阶段 2（⏳ 待实施）：生成 + 触发 + 可观测

1. **经验提取**：`GoalMetricsService.queryReviewSamples({pdcaTaskId})`（**首个生产消费方**）+ 失败 pitfall（`tasks/pitfalls`）。
2. **生成**：LLM 生成"覆盖层增补 / 技能修订"，经 **core SPI**（`resolveAiAccess`，同 `MemoryDreamService`，避免 `infra → app` 倒挂）调用。
3. **写回 + 防抖**：最小样本数 + 最小间隔 + 内容哈希去重；写入即归档旧版（阶段 1 已具备）。
4. **触发**：复用**既有**收口点（PDCA 终态，与 T-②02 同处）或梦境 cron —— **不新建调度器**（CS01）。
5. **可观测**：结构化日志（`tasks:evolution`，INFO）+ 新事件 `evolution/applied`（三端同步 + 穷尽断言）。
   - §1.6 红线：覆盖层正文经 `context/model-input` 的 sections 快照落盘（"模型看到什么"可重建）；`evolution/applied` 补**决策**审计。

---

## 4. 非目标

- ❌ 不改写任何用户/内置文件（`SKILL.md`、内置提示词）——只写覆盖层/侧车。
- ❌ 不新建调度器 / 不新建演化专用 DB 表（复用现有收口点与文件版本目录）。
- ❌ 不做前端面板（本阶段只保证"自动生效 + 可回滚 + 可审计"）。

---

## 5. 验收

| # | 判据 | 状态 |
|---|---|---|
| 1 | 覆盖层/侧车 读写往返、归档、回滚、上限拒绝、版本裁剪 | ✅ 阶段 1（10 用例） |
| 2 | 无产物时**零影响**（段落返回 null ⇒ 不进提示词） | ✅ 阶段 1（`readPromptEvolutionOverlay` 空/缺/超长 ⇒ null） |
| 3 | 技能侧车**不改写** `SKILL.md`；名称越界拒绝 | ✅ 阶段 1 |
| 4 | `typecheck` 0 · `lint:arch` 违规 0 · 测试 0 fail | ✅ 阶段 1（见实施记录） |
| 5 | 经验 → 生成 → 写回 → 生效 全链路 + 防抖 + 事件可审计 | ⏳ 阶段 2 |

---

## 6. 合规对照（阶段 1）

| 规则 | 检查点 | 状态 |
|---|---|---|
| `CS01` | 读写**唯一实现**（`utils/promptEvolution`）；复用既有 `SECTION_NAMES`/`BUILTIN_SECTIONS`/`SECTION_META` 门禁与 `FileSkillLoader`，**未**新建加载器 | ✅ |
| `CS03` | 无推测性重试/沙箱；失败即返回 `null`（调用方留痕），不加缓冲 | ✅ |
| `CS04` | 无 Mock 数据；无产物即不注入 | ✅ |
| `project_rules §1.13` | 路径全部经 `core/paths.ts`（新增 `resolvePromptEvolutionDir`） | ✅ |
| `project_rules §1.15` | 技能三来源隔离：**不写 vendor/内置**；侧车只落用户技能目录；越界名拒绝 | ✅ |
| `project_rules §1.6` | 覆盖层为模型可见输入 ⇒ 经 `context/model-input` sections 快照落盘（阶段 2 复核） | ⏳ 阶段 2 核 |
| `R00-001` | 新增边 `context→utils`、`skills→utils`、`utils→core`，均合法 | ✅ `lint:arch` 违规 0 |
| `R11-001` | 无直接 `new Logger`（阶段 1 无日志点） | ✅ |

---

## 7. 遗留（如实）

- **阶段 2 未做**：LLM 生成、触发接线、`evolution/applied` 事件、端到端验收（≥5 条判据）。
- **直接文件形态不合并侧车**：`<dir>/<name>.md` 形态**不合并** `.evolution.md`（侧车语义是"与 `SKILL.md` 同目录"；该形态下同目录属**共享目录**，合并会串味）——如实登记。
- **`SkillCurator` 空转/不可达**（`startScheduler` 零调用者且空转、`patch` 零调用者）：本 spec **未处置**，另行登记。
