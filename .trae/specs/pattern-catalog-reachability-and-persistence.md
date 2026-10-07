# Spec：编排模式目录 —— 可达性维度 + 双落盘（静态快照 / 会话轨迹）+ 面板导出

> 版本 1.0 ｜ 创建 2026-10-07 ｜ 状态：🟢 **已实施（2026-10-07）**
> 来源：用户 2026-10-07 现场反馈（右侧「模式」面板大量「未接线」）+ AskUserQuestion 两项裁定
> 关联：`.trae/specs/pattern-catalog-visibility.md`（PC-6，本 spec 是其**如实性收口**）· `pattern-assembly-runtime.md`（A8）· `pattern-trigger-surfaces.md`（N4）
> 关联规则：GR15（Spec-Driven，含 **API 变更 + 数据模型变更**）/ CS01 / CS02 / CS03 / CS04 / CS06 / R06-008（分层）/ R11-001（Logger 门面）

---

## 1. Problem Statement（回仓取证，2026-10-07 实测）

PC-6 已上线「模式」面板（[PatternsTab.tsx](file:///e:/PY/Documents/CODES/PY_APP/client/src/components/ChatInspector/PatternsTab.tsx) ← `GET /v1/patterns` ← [patternAssembler.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/patternAssembler.ts) `listPatternCatalog()`），但**只暴露二元 `status`**，与真实情况不符：

| 模式 | 面板现显示 | **真实状况（实测）** | 证据 |
|---|---|---|---|
| `competitive_strategy` | ✅ 已接线 `route=research` | **真可达**，但**另受功能开关门控**（`COMPETITIVE_STRATEGY` 默认 `false`）—— 面板未体现 | [ChatManager.ts:3725-3728](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L3725-L3728) · [featureFlags.ts:313](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/featureFlags.ts#L313) |
| `self_verify` | ✅ 已接线 `route=verify` | ⚠️ **接线在、触发不可达**：`selectPattern` **永不产出**它 ⇒ 配方分支**当前不可达**（代码自陈） | [PatternSelector.ts:70-82](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/patterns/PatternSelector.ts#L70-L82) · [ChatManager.ts:3704-3707](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L3704-L3707) |
| `long_task_pdl` | 🚧 未接线 | **非缺功能**：运行时（`PlanDrivenLoop`）**存在**，由 `_shouldUsePlanDrivenLoop` **独立驱动** | [patternAssembler.ts:79-82](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/patternAssembler.ts#L79-L82) |
| `iterative_refine` / `parallel_distributed` | 🚧 未接线 | 真·无运行时、无触发场景 | [patternAssembler.ts:83-84](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/patternAssembler.ts#L83-L84) |

**另两处缺口**：
1. **触发可达性无事实源**：今天只有 `selectPattern` 的命令式 `if`，**没有任何声明**能回答"哪些模式有触发面"（面板因此把 `self_verify` 谎报为可用）。
2. **零落盘**：`pattern.selected` / `pattern.none` **仅 logger**（[PatternSelector.ts:76/80](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/patterns/PatternSelector.ts#L76-L80)）；目录内容**无快照** ⇒ 会话里"这次为什么没走研究模式"**无法从持久层重建**。

---

## 2. 裁定点（用户裁定，2026-10-07）

| ID | 决策项 | 定论 |
|:--:|---|---|
| **D1** | 「未接线」三条怎么处理 | **只补「可达性」维度** —— 后端 catalog 增 `reachable` + 原因 + 功能门控；前端如实区分四态。**不新建任何运行时**（`iterative_refine` / `parallel_distributed` 维持不可达，受既有 N4「无触发场景」裁定约束；新建运行时违反 CS03/CS04） |
| **D2** | 「模式」内容如何落盘 | **三项全做**：① **静态目录快照**（`~/.pyapp/data/reports/pattern_catalog.json`）② **会话级使用轨迹**（新 session 事件）③ **面板导出按钮** |

---

## 3. 设计

### 3.1 可达性：**唯一事实源 = 声明式触发规则**（CS01）

`core/patterns/PatternSelector.ts` 引入**声明式规则表**，`selectPattern` 改为**消费**该表（不再内联 `if`）：

```ts
export const PATTERN_SELECTION_RULES = [
  { name: 'competitive_strategy', complexity: 'complex', research: true, feature: 'COMPETITIVE_STRATEGY' },
] as const;   // ← 字面量保留，供 Exclude<> 穷尽推导
```

- **可达性判定**（`isPatternReachable(name)`）= 「该 name 是否出现在规则表」—— **派生**，不另建表。
- **无触发面原因**（`PATTERN_TRIGGER_ABSENCE_REASON`）= `Readonly<Record<Exclude<PatternName, (typeof RULES)[number]['name']>, string>>`
  ⇒ **编译期穷尽**：新增 `PatternName` 时**必须**补规则或补原因，否则 `typecheck` 失败（本仓既有手法）。
- **行为零变化**：规则表当前恰一条 ⇒ `simple→null` / `complex+research→competitive_strategy` / 其余`→null` 逐字不变（既有 `PatternSelector.test.ts` 保护）。

### 3.2 功能门控：**声明同源**

门控声明进规则（`feature`），解析仍走**既有唯一入口** `@modules/core#feature(name: FeatureFlag)`（[featureFlags.ts:366](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/featureFlags.ts#L366)）。
⇒ `ChatManager` 的 `coreFeature('COMPETITIVE_STRATEGY')` 改为读**规则声明的门控**（消除第二处字符串，行为等价）。

### 3.3 catalog 字段扩展（`PatternCatalogEntry`）

| 字段 | 说明 |
|---|---|
| `reachable: boolean` | 是否有**触发面**（来自 §3.1 规则表） |
| `unreachableReason?: string` | 无触发面时的原因（仅 `reachable === false`） |
| `featureGate?: { flag: string; enabled: boolean }` | 命中规则声明了门控时给出（仅出现在可达项） |

**四态语义**（前端如实呈现，不做"更好看"的改写 —— CS06）：

| `status` | `reachable` | 语义 |
|:--:|:--:|---|
| `ready` | `true` | 已接线**且**可达（`competitive_strategy`） |
| `ready` | `false` | **已接线但当前不可达**（缺触发面，`self_verify`） |
| `unavailable` | 任意 | 未接线（`reason` 区分"运行时由别处驱动" / "无运行时"） |

### 3.4 静态目录快照落盘

- **落点**：`join(resolveDataSubDir('reports'), 'pattern_catalog.json')` —— 沿**既有** `reports/` 约定（[DependencyValidator.ts:679-680](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/DependencyValidator.ts#L679-L680)、[StartupReportService.ts:76](file:///e:/PY/Documents/CODES/PY_APP/app/src/performance/StartupReportService.ts#L76)），**不新建目录/不拼路径**（`project_rules §1.13`）。
- **内容**：`{ generatedAt, entries: PatternCatalogEntry[] }`（确定性内容，用途 = 留档 + 跨版本 diff）。
- **触发**：**按需**写入（随导出/目录接口调用触发），**不**做启动期轮询（CS03：无真实失败场景的常驻不写）。
- 写入失败**不阻断**目录读取（`handleError` 留痕；返回值仍给出目录）—— 该失败面真实存在（磁盘只读/占用）。

### 3.5 会话级使用轨迹（数据模型变更）

**新增 session 事件 `pattern/decision`**（log-only，**不入消息 surface**；与 `agent/recovery` / `session/wake` / `evolution/applied` 同口径）。

- **为什么需要**：`pattern.selected` / `pattern.none` 仅 logger ⇒ 会话结束后无法按序重建"当时选了哪个模式 / 为什么没生效"。这是**排查**（用户诉求 ②）的落点。
- **触发点**：`ChatManager._maybeLaunchPdca` 的研究分流处（**仅当研究意图命中**时落一条 —— 未命中是噪声）。
  ⇒ 记录两类事实：**命中并生效** / **命中但被拦**（门控关 / 装配 `unavailable`）。
- **载荷**：`{ site, selected: string|null, status?, route?, featureGate?, applied: boolean }`。
- **三处同步**（编译期强制，`project_rules §1.6`）：① [`shared/events/eventNames.ts`](file:///e:/PY/Documents/CODES/PY_APP/shared/events/eventNames.ts) ② [`eventPayloads.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/session/types/eventPayloads.ts) ③ [`knownEventTypes.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/session/types/knownEventTypes.ts) 的 `ALL_SESSION_EVENT_TYPES`（漏登记 ⇒ `TS2322`）。
- **边界（如实）**：pattern 选择**不直接进入模型请求** ⇒ 本事件**非** §1.6 红线所迫；立项理由纯粹是**可排查性**（不宣称红线合规贡献）。

### 3.6 前端

- `PatternsTab` 增**可达性展示**：`ready && !reachable` 显示「**已接线，当前不可达**」+ 后端 `unreachableReason`；门控项显示 `featureGate`（如 `COMPETITIVE_STRATEGY: 关`）。
- 增**「导出快照」按钮**：调用后端导出（写盘）并**回显落盘路径**；失败显示错误（不静默）。
- i18n **双语同批**（`zh` / `en`）。

---

## 4. 落点

| # | 文件 | 改动 |
|:-:|---|---|
| 1 | `app/src/core/patterns/PatternSelector.ts` | 声明式 `PATTERN_SELECTION_RULES` + `isPatternReachable` + 穷尽原因表；`selectPattern` 改为消费规则 |
| 2 | `app/src/core/patterns/types.ts` | `PatternSelectionRule`（如需） |
| 3 | `app/src/core/index.ts` | 转出新导出 |
| 4 | `app/src/query/patternAssembler.ts` | `PatternCatalogEntry` 增 3 字段；新增 `writePatternCatalogSnapshot()` |
| 5 | `app/src/runtime/api/queryOpsPorts.ts` | DTO 结构镜像同步 |
| 6 | `app/src/runtime/api/domainSnapshotOps.ts` | 端口实现（转调，不复制判定） |
| 7 | `app/src/infrastructure/http/handlers/plan-flow-handlers.ts` | `handleListPatterns` 透传新字段 + 新增导出 handler |
| 8 | `app/src/infrastructure/http/handlers/routes/plan-flow-routes.ts` | 新增导出路由 |
| 9 | `shared/events/eventNames.ts` | ➕ `pattern/decision` |
| 10 | `app/src/session/types/eventPayloads.ts` | ➕ `pattern/decision` 载荷 |
| 11 | `app/src/session/types/knownEventTypes.ts` | `ALL_SESSION_EVENT_TYPES` ➕ |
| 12 | `app/src/chat/ChatManager.ts` | 门控读规则声明 + 落 `pattern/decision` |
| 13 | `client/src/services/planService.ts` | 类型 + 导出方法 |
| 14 | `client/src/components/ChatInspector/PatternsTab.tsx` | 可达性展示 + 导出按钮 |
| 15 | `client/src/i18n/locales/{zh,en}.ts` | 新增 key（双语） |
| 16 | `.trae/docs/api-spec.md` | §3.29.1 响应字段 + 导出端点 |
| 17 | `app/tests/query/patternCatalog.test.ts` | 扩用例（可达性/字段自洽/穷尽） |
| 18 | `app/tests/core/patterns/PatternSelector.test.ts` | 可达性用例 |

---

## 5. 验收

| 项 | 标准 |
|---|---|
| 可达性如实（P1） | `GET /v1/patterns` 中 `self_verify` ⇒ `reachable === false` + 非空 `unreachableReason`；`competitive_strategy` ⇒ `reachable === true` + `featureGate` |
| 单一事实源（P2） | 全仓"某模式是否有触发面"判定**仅**在 `PATTERN_SELECTION_RULES`；`ChatManager` 不再含 `'COMPETITIVE_STRATEGY'` 字面量 |
| 编译期穷尽（P3） | 新增 `PatternName` 而不补规则/原因 ⇒ `bun run typecheck` **必失败**（变异验证） |
| 行为零变化（P4） | 既有 `PatternSelector` / `patternAssembly` / 研究分流用例**全绿** |
| 静态快照（P5） | 导出 ⇒ 文件落 `~/.pyapp/data/reports/pattern_catalog.json`，内容 = 目录项数组（含新字段） |
| 会话轨迹（P6） | 研究意图命中时事件日志出现 `pattern/decision`；未命中**不**落（无噪声） |
| 三处同步（P7） | 临时移除 `ALL_SESSION_EVENT_TYPES` 登记 ⇒ `TS2322`；恢复后 0 错 |
| 前端（P8） | 面板区分四态；导出按钮可用且**回显路径**；失败显式报错 |
| 分层（P9） | `lint:arch` 0 违规、动态跨层引用**不增** |
| 回归 | `typecheck`（app+client）0 · 改动文件 `eslint` 0 · `lint:size` 回基线 · 全量 `bun test` / `vitest` 0 fail |

---

## 6. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行（含 API + 数据模型变更）；D1/D2 用户裁定 |
| CS01 归一化 | ✅ 可达性**派生**自规则表（不建第二张表）；门控声明单点；复用 `reports/` 与既有端口/路由域 |
| CS02 状态判定 | ✅ `reachable` / `status` / `featureGate.enabled` 皆结构化字段，**无文案匹配** |
| CS03 回退最小化 | ✅ 无开关、无"以防万一"分支；快照按需写、失败不静默 |
| CS04 Mock 零容忍 | ✅ 不造 stub 运行时；`unavailable` 如实呈现 |
| CS06 证据驱动 | ✅ §1 逐条 `file:line`；新字段均有实测来源；未核实项标注 |
| R06-008 分层 | ✅ core → app → service 逐跳合法；infra 经端口取 app 能力 |
| `project_rules §1.6` | ✅ 新事件三处同批 + 穷尽断言；如实标注"非红线所迫" |
| `project_rules §1.13` | ✅ 路径一律 `resolveDataSubDir('reports')`，禁自建/拼接 |
| R11-001 | ✅ 日志走 `getLogger('...')` 门面 |

---

## 7. 风险与边界（如实）

1. **不解决"补功能"**：`iterative_refine` / `parallel_distributed` **仍不可达**（N4 裁定）；本 spec 只让面板**说真话**。
2. **`self_verify` 仍是"已接线但不可达"**：本 spec **不**为其新增触发面（用户裁定 D1 = 只补可达性维度）。
3. **静态快照是确定性内容**：同版本恒定 ⇒ 价值在留档/跨版本 diff，**不是**运行期诊断主通道（那是 §3.5 的事件）。
4. **事件触发面限于研究分流点**：`_maybeLaunchPdca` 之外若将来新增 pattern 消费点，须**同批**扩 `site` 闭集（否则轨迹不完整）。
5. **`feature()` 为环境/常量读取**：快照中的 `featureGate.enabled` 是**写入时刻**的值，非历史回放值。

---

## 8. 实施记录（2026-10-07）

**落点（实测）**：与 §4 表一致；另含 §4 未逐条列出的必要同步 2 处 —— `client/src/types/events.ts`（前端载荷镜像，三端一致性门禁要求）+ 2 个测试文件。

**门禁（全绿）**：

| 门禁 | 结果 |
|---|---|
| `bun run typecheck`（app + client） | **0** |
| `eslint`（改动文件） | **0** |
| `lint:arch` | 违规 **0** / 警告 **4（基线）** / 动态跨层引用 **41（未增）** |
| `lint:size` | **0 错 / 470 警告 / 8 例外（基线）** |
| `lint:doc-code` | **19 断言一致** |
| 全量 `bun test`（app） | **4891 pass / 21 skip / 0 fail**（+7 例） |
| `vitest`（client） | **60 files / 521 pass** |

**编译期变异验证（实测，非声称）**：
- 移除 `PATTERN_TRIGGER_ABSENCE_REASON.self_verify` ⇒ `TS2741: Property 'self_verify' is missing in type …`（**可达性穷尽断言成立**）；
- 移除 `ALL_SESSION_EVENT_TYPES` 的 `'pattern/decision'` ⇒ `TS2322: Type 'true' is not assignable to type 'never'`（**事件三处同步成立**）；
- 两处均已还原并复跑 `typecheck` = 0。

**真机端到端（实测）**：
- `GET /v1/patterns`（后端 `127.0.0.1:18990`，dev 实例热重载）⇒ 5 条字段逐条正确：`self_verify` = `ready / reachable=false / route=verify`；`competitive_strategy` = `reachable=true / route=research / featureGate=COMPETITIVE_STRATEGY:true`；其余三条 `unavailable + reachable=false`；
- `POST /v1/patterns/export` ⇒ `200 {"path":"C:\\Users\\csdnc\\.pyapp\\data\\reports\\pattern_catalog.json","entryCount":5}`，**文件实测存在**（4406 B，5 条 + `generatedAt`）；
- 前端（浏览器实点，`localhost:1420`）：「模式」Tab 渲染 5 行；**`自我验证` 徽标 = 「已接线 · 不可达」**（修复前为「已接线」）；`对抗竞争策略` 显示 `功能开关：COMPETITIVE_STRATEGY 已开启` + `route: research`；点「导出快照」⇒ **绿色提示 `已导出 5 条到：C:\Users\csdnc\.pyapp\data\reports\pattern_catalog.json`**。

**`pattern/decision` 真实对话端到端（2026-10-07 补测，实测）**：
- **正例（研究意图命中）**：`POST /v1/sessions` 建裸会话 → **流式** `POST /v1/chat/completions`（`deepseek-v4-flash`；消息 =「帮我做一个数据库选型调研报告。目标：为团队选型一款向量数据库／范围：需要多方案对比与权衡／请系统性地评估多个候选方案并给出选型建议。」）⇒ 事件日志实落：
  ```json
  {"type":"pattern/decision","seq":157,"time":1791384929179,
   "sessionId":"session_muy88ntm7icxkfkl9m7",
   "data":{"site":"research_dispatch","selected":"competitive_strategy","status":"ready",
           "route":"research","featureGate":{"flag":"COMPETITIVE_STRATEGY","enabled":true},
           "applied":true,"callSeq":157}}
  ```
  同会话 `metadata.projectId = proj_…` 已建（⇒ 升级链走通），日志同现 `pdca:bare_session_intent_detected`。
- **负例（噪声抑制对照）**：同法发**无研究关键词**的消息（「帮我做一个 3 行 2 列的 Markdown 表格。目标：…／范围：只输出该表格」）⇒ `metadata.projectId` **同样已建**（证明**已到达** `_maybeLaunchPdca` 决策点），而事件日志**无** `pattern/decision` ✓。
- **过程如实记录**：首次以**非流式** `sendMessage` 触发**未产生事件**；回仓确认 `_maybeLaunchPdca` 仅挂在**流式**路径 `_finalizeStreamMessage`（[ChatManager.ts:3185](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ChatManager.ts#L3185)）⇒ 改流式后一次通过。**"非流式路径无 PDCA 自动升级"为既有行为**，本批未改，仅登记（任务计划 §8-14）。

**遗留（明确，未做 / 未验）**：
1. `iterative_refine` / `parallel_distributed` **仍不可达**（D1 裁定：只补可达性维度，不新建运行时）。
2. 前端**窄视口可达性**：`ChatInspector` 在窗口 < 1024px 时自动收起、且**无法展开** ⇒ 该宽度下「模式」Tab 不可达（本次真机复现；属**既有**行为，非本批引入；已登记至任务计划 §8-13）。
3. **非流式对话路径**（`ChatManager.sendMessage`）**不触发** `_maybeLaunchPdca` ⇒ 该路径下既无 PDCA 自动升级、也无 `pattern/decision`（**既有**差异，本批未改；任务计划 §8-14）。

