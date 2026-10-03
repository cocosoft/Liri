# 快速路径判据配置化（Fast Path Policy Config）— Spec

- **来源**：`dev_docs/20261001/pending-tasks-consolidated-20261001.md` **T-②05**（原始出处 `dev_docs/20260928/architecture-benchmark-20260928.md` §6.4 #6）
- **状态**：✅ **已完成**（2026-10-03）
- **一句话**：把 PlanDrivenLoop 快速路径的**长度阈值**与**危险意图正则**从硬编码改为配置驱动，默认值单一事实源下沉 core。

---

## 1. 取证（2026-10-03，改前状态）

| 事实 | 坐标 |
|---|---|
| `SIMPLE_TASK_MAX_LENGTH = 60` 硬编码，注释标「冻结基线」 | `tasks/PlanDrivenLoop.ts:167-168`（改前） |
| 「危险清单」实为 **7 条意图正则** `DANGEROUS_TOOL_PATTERNS`（非工具名） | 同文件 `:176-184`（改前） |
| 消费面：① `ChatManager._shouldUsePlanDrivenLoop`（层 1 分流）；② PDL 内部 `isSimpleTask`（**分解门**，同阈值） | `ChatManager.ts:641`、`PlanDrivenLoop.ts:332` |
| 冻结依据是「**灰度 S1-S3 期间**不得修改」，而灰度已于 2026-09-01 阶段 3 退役（开关删除、固化单一路径）⇒ **冻结条件失效** | `ChatManager.ts:624-632` |
| 阈值**有取材依据**（覆盖原正则的问候/致谢 ≤30 与关键词问答 ≤57 ⇒ 取 60）⇒ benchmark #6「不与验收标准绑定」**不准确** | `PlanDrivenLoop.ts:155-158`（改前） |
| 配置基建已存在：`GlobalConfig` 分组 + `createDefaultGlobalConfig()`；`loadConfigFromFile()` 与默认值**浅合并**（旧 config.json 缺组 ⇒ 自动补默认）；HTTP `GET /v1/config` 全量返回、`POST /v1/config/:key` 支持**点号路径** | `config/types.ts:402-470`、`ConfigManager.ts:796-800`、`http/handlers/config-handlers.ts:33-67` |
| 权限侧另有同名族 `DANGEROUS_TOOL_KEYWORDS`（工具名 Set），与本处**意图正则**不同轴，**不合并** | `permission/classifiers/dangerous-tool-keywords.ts:30` |

---

## 2. 裁定（用户，2026-10-03）

**阈值 + 危险意图正则均配置化**。

---

## 3. 设计

| 层 | 落点 | 职责 |
|---|---|---|
| 默认值/纯构造（core） | `app/src/types/fastPath.ts` | `FastPathConfig` / `FastPathPolicy`；`DEFAULT_FAST_PATH_MAX_LENGTH=60`；`DEFAULT_DANGEROUS_INTENT_PATTERNS`（7 条源码）；`compileIntentPatterns`；`buildFastPathPolicy` |
| 配置声明（infra） | `app/src/config/types.ts` | `GlobalConfig.fastPath` 字段 + `createDefaultGlobalConfig()` 默认值（引用 core 常量，单一事实源） |
| 运行时解析（app） | `app/src/tasks/fastPathPolicy.ts` | 读 `GlobalConfig.fastPath` → `buildFastPathPolicy` → 非法项告警 → **记忆化**（key=阈值+源码列表，配置变更即失效） |
| 判定（app，纯） | `app/src/tasks/PlanDrivenLoop.ts` | `classifyTaskComplexity(msg, maxLength?)` / `hasDangerousToolIntent(msg, patterns?)` / `isEligibleForFastPath(msg, policy?)`；`PlanDrivenLoop` 构造时定判据（注入优先，否则 `resolveFastPathPolicy()`） |
| 接线（app） | `app/src/chat/ChatManager.ts` | `_shouldUsePlanDrivenLoop` 取 `resolveFastPathPolicy()` 传入判定 |

**为什么默认值放 `types/`（core）**：`config`(infra) 与 `tasks`(app) **同时**需要默认值 —— 落任一侧都会造成反向依赖（`config` 不得 import `app`）。core 是共同下界（同 `types/goal.ts` 的既有做法）。

**容错口径（fail-closed，安全默认）**：

| 输入 | 行为 |
|---|---|
| 阈值 非数 / ≤0 / 非有限 | 回退 `60` |
| 阈值 小数 | 向下取整 |
| 正则清单 缺失 / 非数组 / **空数组** | 回退**默认清单**（不因留空而放开危险意图筛除） |
| 单条正则 非法 / 空串 / 超长（> 200 字符） | **只作废该条**（计入 `invalidPatterns` 并告警），其余继续生效 |
| 正则清单**全部非法** | 回退默认清单 |

**ReDoS 面**：用户自定义正则无法完全静态判定，采取「**长度上限 200 + try/catch 编译 + 记忆化（至多告警一次）**」的最小缓解；不引入正则沙箱（CS03：不为理论可能性加机制）。

---

## 4. 非目标

- ❌ **不做设置 UI**：`fastPath` 可经 `~/.pyapp/config.json` 或 `POST /v1/config/fastPath.maxSimpleTaskLength`（点号路径）修改；设置面板另项（登记为遗留）。
- ❌ 不改 `ai/router/TaskComplexityClassifier` 的阈值（另一套 3 档、上下文感知的分类器，服务于 router 选型，与本处**非同轴**）。
- ❌ 不改分流**语义**：仍是「长度门 + 危险意图门」；**默认值 = 原冻结基线**（零行为变化）。

---

## 5. 验收（2026-10-03 逐条核）

| # | 判据 | 结果 |
|---|---|---|
| 1 | 默认行为**零变化**（不配置 ⇒ 与原 60/7 条一致） | ✅ `buildFastPathPolicy(null)` 断言为默认值；原 `planDrivenLoop.test.ts` 用例全绿 |
| 2 | 配置可覆盖阈值与正则 | ✅ 显式参数/判据注入用例通过；`fastPath` 组经 `GlobalConfig` 默认值 + 浅合并生效 |
| 3 | 非法配置 **fail-closed**（不抛错、不放行） | ✅ 单测覆盖 5 类非法阈值 + 空/非数组/单条非法/全非法正则 |
| 4 | `typecheck` 0 · `lint:arch` 违规 0 · 测试 0 fail | ✅ app `tsc --noEmit` 0；`lint:arch` **错误 0**（分层 3851 文件 / 违规 0）；`bun test tests/` **0 fail** |
| 5 | 判据单一事实源（无重复定义） | ✅ 默认值仅在 `types/fastPath.ts`；`config` 与 `tasks` 均引用之 |

---

## 6. 合规对照

| 规则 | 检查点 | 状态 |
|---|---|---|
| `project_rules §1.3` | 新增配置项不破坏既有 config.json（浅合并 + 缺省回退） | ✅ |
| `PY_APP.md §2` / `CS03` | 不为理论可能性加机制：未引入正则沙箱；仅长度上限 + 容错 | ✅ |
| `CS01` 归一化 | 默认值/类型**单一定义**；复用既有 `GlobalConfig`/`getGlobalConfig`/HTTP config 面；**未**新建第二套配置体系 | ✅ |
| `CS02` | 判据仍基于**枚举/结构化**（长度 + 正则命中），未引入按文案判状态 | ✅ |
| `CS04/CS06` | 默认值有取材依据（≤30/≤57→60），非臆造 | ✅ |
| `R00-001` 分层 | 新增边：`config`(infra)→`types`(core)、`tasks`(app)→`types`(core)，均合法 | ✅ `lint:arch` 违规 0 |
| `R06-006`（GR03） | 判定（纯函数，`types/fastPath` + `PlanDrivenLoop`）与接线（`fastPathPolicy` 读配置）分离 | ✅ |
| `R11-001` | 日志用 `getLogger('tasks:fastPathPolicy')` | ✅ |

---

## 7. 实施记录（2026-10-03）

| 文件 | 变更 |
|---|---|
| `app/src/types/fastPath.ts` | 🆕 默认值 + `FastPathConfig`/`FastPathPolicy` + `compileIntentPatterns`/`buildFastPathPolicy`（纯函数） |
| `app/src/config/types.ts` | ➕ `GlobalConfig.fastPath` + 默认值 |
| `app/src/tasks/fastPathPolicy.ts` | 🆕 `resolveFastPathPolicy()`（读配置 + 记忆化 + 非法项告警） |
| `app/src/tasks/PlanDrivenLoop.ts` | 🔧 移除硬编码 `SIMPLE_TASK_MAX_LENGTH`/`DANGEROUS_TOOL_PATTERNS`；判定函数改**可选判据参数**；实例构造时解析判据 |
| `app/src/tasks/index.ts` | ➕ barrel 出 `resolveFastPathPolicy` |
| `app/src/chat/ChatManager.ts` | 🔧 `_shouldUsePlanDrivenLoop` 用配置判据 |
| `app/tests/tasks/fastPathPolicy.test.ts` | 🆕 12 用例（默认/覆盖/非法回退/编译容错/记忆化） |
| `app/tests/core/planDrivenLoop.test.ts` | 🔧 阈值常量改引 core；+2 用例（显式判据生效、判据注入） |

---

## 8. 遗留（如实）

- **设置 UI**：`fastPath` 目前无前端面板（可经 config.json / HTTP config 面修改）；如需可视化配置，另立专项。
- **附带发现**（非本 spec 引入）：`ai/router/TaskComplexityClassifier.classifyComplexity` 经 barrel 导出，但 `app`/`client`/`scripts` 全仓**未见调用点**（另属一套 3 档分类器）⇒ 疑为死导出，另行登记。
