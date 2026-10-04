# 经验自动演化写回（Adaptation Write-back Evolution）— Spec

- **来源**：`dev_docs/20261001/pending-tasks-consolidated-20261001.md` **T-②06**（原始出处 `dev_docs/20260928/architecture-benchmark-20260928.md` §6.4 #9）
- **状态**：✅ **已完成**（阶段 1 写回/回灌面 + 阶段 2 生成/触发/事件，2026-10-03 结案）；**真实 LLM 端到端已验证（2026-10-04，服务层）**
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

### 3.3 阶段 2（✅ 已实施，2026-10-03）：生成 + 触发 + 可观测

| 环节 | 落点 | 实现 |
|---|---|---|
| 经验提取 | `tasks/evolution/AdaptationEvolutionService.ts` | `GoalMetricsService.queryReviewSamples()`（**首个生产消费方**）；失败判定 = `converged === 0`（**不引入阈值**，`null` 未决不算失败） |
| 生成 | 同上 | 经 **core SPI**（`resolveAiAccess` + `router.resolveAsync('quick')` + `createToolAwareClient.sendMessage`，同 `MemoryDreamService`）；严格 JSON 输出并做形状校验 |
| 写回 | 同上 + `utils/promptEvolution` | 覆盖层必写；技能侧车**仅在候选清单内**才写（禁止臆造技能名） |
| 防抖 | `decideEvolution`（纯函数） | ① 失败样本 ≥ `MIN_FAILURE_SAMPLES`(2) ② 样本签名变化 ③ 距上次 ≥ `EVOLUTION_MIN_INTERVAL_MS`(6h)；**仅在确有落盘后**推进状态 |
| 触发 | `LongRunningTaskOrchestrator._runAdaptationEvolution()` | 复用**既有** PDCA 终态收口点（completed / aborted）—— **不新建调度器**（CS01）；聚合式（读全量历史样本），故与 `_persistReviewSample` 无严格顺序依赖 |
| 可观测 | `tasks/evolution/EvolutionAudit.ts` | 新事件 `evolution/applied`（三端同步 + 穷尽断言；log-only）+ INFO 日志（`tasks:evolution`）；sink 由 `ChatManager` 注入（同 `SelfWakeAudit` 手法） |

**§1.6 红线**：覆盖层正文作为模型可见输入，经 `context/model-input` 的 sections 快照落盘（"模型看到什么"可重建）；`evolution/applied` 补**决策/产物**审计。

**安全**：产物**只追加**（覆盖层带版本目录可回滚；技能侧车不改写 `SKILL.md`）；正文有界（各 ≤4000 字符）；LLM 不可用 / 输出不可解析 / 落盘失败 ⇒ **只留痕不抛**且**不推进状态**（经验不被吞）。

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
| 5 | 经验 → 生成 → 写回 → 生效 全链路 + 防抖 + 事件可审计 | ✅ 阶段 2（**16 用例**：筛选 2 / 签名与防抖 5 / 提示词与解析 2 / 编排 7） |
| 6 | `typecheck` 0 · `lint:arch` 违规 0 · 测试 0 fail | ✅ 阶段 2（app + client `tsc` 0；`lint:arch` 错误 0；全量套件 0 fail） |
| 7 | **真实 LLM 端到端**（真 Provider + 真失败样本 → 覆盖层落盘 + 审计 emit） | ✅ **2026-10-04**（服务层 e2e：3 样本 → `glm-5.2` → `overlay.md` **706 B** + `state.json` + emit；见 §7） |

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

- ✅ **真实 LLM 端到端已验证（2026-10-04）**：以**生产依赖**（真实样本 / 提示词构造 / 解析 / 写回 / 状态推进 / 审计 emit）跑通一次 —— `review_samples` 中 `converged=0` **3 条**（≥ `MIN_FAILURE_SAMPLES`=2）⇒ 真实 LLM（`glm-5.2`）产出严格 JSON ⇒ **提示覆盖层写入 706 B**（7 条可移植要点）+ `state.json` 推进 + 审计 emit `{scope:'prompt',sampleCount:3,bytes:706}`。
  - **边界**：`generateWithModel` 的 **router→provider 解析链**在独立进程**未走通**（`resolveAsync('quick')` 返回空，需启动期任务路由自动发现，属运行环境差异）⇒ 本次为**服务层** real-LLM e2e（编排 + 样本 + 写回 + 审计全真），**非**经 app 启动的 router 路径。
  - **留待**：`evolution/applied` 落进真实 `events.jsonl`（sink 由 `ChatManager` 注入）待 app 内真实 PDCA 终态触发复核。
  - **产物回收（如实）**：覆盖层是**模型可见输入**且运行中的 app 会自动注入 ⇒ 为避免未经请求地改变用户运行时提示，验证后整目录删除（验证前不存在）恢复原状；技能侧车未产生。详见台账 R-4。
- **未做前端展示**：产物落盘/审计事件已可读，UI 呈现另项。
- **直接文件形态不合并侧车**：`<dir>/<name>.md` 形态**不合并** `.evolution.md`（侧车语义是"与 `SKILL.md` 同目录"；该形态下同目录属**共享目录**，合并会串味）——如实登记。
- **`SkillCurator` 空转/不可达**（`startScheduler` 零调用者且空转、`patch` 零调用者）：本 spec **未处置**，另行登记。

---

## 8. 实施记录（2026-10-03）

**阶段 1**（提交 `c1dba67b9`）：`core/paths.ts`、`utils/promptEvolution.ts`🆕、`constants/systemPromptSections.ts`、`services/prompt/promptSectionLayers.ts`、`context/promptSections/builtinSections.ts`、`skills/loaders/sources/FileSkillLoader.ts`、`tests/utils/promptEvolution.test.ts`🆕。

**阶段 2**：

| 文件 | 变更 |
|---|---|
| `tasks/evolution/AdaptationEvolutionService.ts` 🆕 | 纯函数（筛选/签名/防抖/提示词/解析）+ `runAdaptationEvolution` + `createEvolutionDeps` |
| `tasks/evolution/EvolutionAudit.ts` 🆕 | `setEvolutionAuditSink` + `recordEvolutionApplied`（注入式，同 `SelfWakeAudit`） |
| `shared/events/eventNames.ts` · `app/src/session/types/eventPayloads.ts` · `app/src/session/types/knownEventTypes.ts` · `client/src/types/events.ts` | ➕ 事件 `evolution/applied`（三端同步 + 穷尽断言） |
| `utils/promptEvolution.ts` | ➕ 演化状态（`state.json`）读写 + `EVOLUTION_MIN_INTERVAL_MS` |
| `tasks/LongRunningTaskOrchestrator.ts` | ➕ `_runAdaptationEvolution()`；两终态点触发 |
| `tasks/index.ts` | ➕ barrel 出 `setEvolutionAuditSink` / `runAdaptationEvolution` / `createEvolutionDeps` |
| `chat/ChatManager.ts` | ➕ 注入演化审计 sink |
| `tests/tasks/evolution/AdaptationEvolutionService.test.ts` 🆕 | 16 用例 |

**验证（阶段 2）**：app + client `tsc --noEmit` **0** · `lint:arch` **错误 0**（分层 3854 文件 / 违规 0）· `bun test tests/` **3872 pass / 0 fail / 9 skip**。
