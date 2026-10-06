# Spec：终稿校验补齐「无工具回合」（mermaid 自纠覆盖面）

> 版本 1.1 ｜ 创建 2026-10-04 ｜ 状态：🟢 **已实施**（§8 流式 + §9 非流式 + §10 收编统一输出护栏 13-P2-1）
> 状态复核（2026-10-04）：状态头 stale——§8/§9 显示 D1–D5 已裁定、finalOutputGuard.ts 已实施并实测；全量 bun test 未收口。
> 状态复核（2026-10-05）：§10 追加（13-P2-1 收编）；全量 bun test 已收口 **4557 pass / 0 fail**。
> 来源：运行时调试会话 `debug-mermaid-selfheal-miss.md`（根因已证）+ `dev_docs/20260926/liri-optimization-plan-20260926.md` **P0-1②**
> 关联规则：GR15（Spec-Driven）/ **CS01**（归一化）/ **CS02**（状态判定）/ **CS03**（回退最小化）/ **CS05**（根因优先）/ §1.6（模型可见 ⇔ 已落盘）/ §1.3（无兼容包袱）

---

## 1. Problem Statement（运行时证据，非静态推断）

### 1.1 现状

| # | 事实 | 证据 |
|---|---|---|
| 1 | 终稿校验钩子 `onFinalOutputValidation` 只在 `ReActToolLoop` 生效（基类为 no-op） | `chat/ReActToolLoop.ts:2497`；`query/ReActLoop.ts:631` |
| 2 | 该钩子的调用点在**循环内**（`!shouldContinue` 分支） | `query/ReActLoop.ts:836-852` |
| 3 | **循环的创建被"本轮是否有工具调用"门控** | `chat/orchestrator/streamMessageFlow.ts:2062` `if (finalResponse?.tool_calls?.length > 0)` |
| 4 | ⇒ **无工具回合（本轮无 tool_calls）不创建循环 ⇒ 校验从不被调用** | 调试负例：入口探针 `F`(`ReActLoop.run`)/`G`(`createChatAgentLoop`) **均未命中** |
| 5 | 校验器本身正常、事件可落盘、守卫有效 | 调试正例（先逼一次 `file_read`）：D `issues=1` → E `hasSink=true` → `events.jsonl:43` = `validation/injected`；第二轮 C `retried=true` |
| 6 | 非流式路径同样绕过 | `CoreAPIImpl.chat` → `ChatOrchestrator.sendMessage`（无工具时不进 TAORLoop）；本轮 2 次纯文本请求**零插桩命中** |

### 1.2 根因（CS05）

> 校验**能力**已具备且正确；缺口是**覆盖面** —— 它被隐含绑定在「本轮进入过 ReAct 工具循环」这一条件上，
> 而"让模型画个图"最常见的形态恰恰是**无工具调用的纯文本回复**。

### 1.3 交付形态约束（决定改法）

- **非流式**：正文在返回值里**尚未交给调用方** ⇒ 可在返回前直接校验+替换（**无需** supersede）。
- **流式**：正文**已边生成边以 SSE chunk 发出** ⇒ 同请求内修复必须补「**替换已发正文**」语义（现成原语 `ChatManager.updateMessageBlocks`，`:2098`）。这是本 spec 的主要复杂度来源。

---

## 2. 目标 / 非目标

**目标**

- **G1**：无工具回合的**助手终稿**同样接受 `lintMermaidBlocks` 校验（两条路径都覆盖）。
- **G2**：命中 ⇒ 先落 `validation/injected`（§1.6：模型将看到什么必须可从事件重建）⇒ **同请求内至多 1 次**有界修复；用户最终看到**修正后**正文。
- **G3（单一实现）**：复用 `utils/mermaidLint`（校验+措辞）、`mermaid_repair` 模板、`validation/injected` 事件；**不新建**第二套校验器/模板/事件。
- **G4**：流式替换走**既有** `updateMessageBlocks`；不新造替换通道。

**非目标（明确不做）**

- N1：不改工具轮既有行为（`ReActToolLoop` 内逻辑逐字不变）。
- N2：不新增事件类型 / 不改事件载荷 / 不新增配置项。
- N3：不扩展到非 mermaid 的产物校验。
- N4：不改 `PatternSelector` / PDL / 分流判据。
- N5：不做"重试 >1 次"或"自动重写提示词"（沿用 P0-1② 的保守口径）。

---

## 3. 设计

### 3.1 共享「终稿守卫」（单一实现，G3）

新增 `app/src/chat/finalOutputGuard.ts`：

```ts
export interface FinalOutputGuardDeps {
  /** 复用 lintMermaidBlocks；返回问题清单 */
  lint: (text: string) => MermaidLintIssue[];
  /** 复用 renderGoalTemplate('mermaid_repair', { issues: formatMermaidIssues(issues) }) */
  renderInstruction: (issues: MermaidLintIssue[]) => string;
  /** §1.6：先落 validation/injected，再注入 */
  emitValidationInjected: (issues: MermaidLintIssue[], instruction: string) => Promise<void>;
  /** 一次有界修复（调用方提供其模型调用）；无法修复/失败 ⇒ 返回 null */
  repair: (instruction: string) => Promise<string | null>;
}

/** 校验终稿；命中则落事件 + 修复一次。返回最终正文与是否已修复。 */
export async function guardFinalOutput(
  text: string,
  deps: FinalOutputGuardDeps
): Promise<{ text: string; repaired: boolean }>;
```

- 顺序不可颠倒：**先落盘再修复**（§1.6）。
- `repair` 失败/超时 ⇒ **如实原样放行**（`repaired:false`，不静默、不阻塞；CS03）。
- 上限：**1 次**（与工具轮口径一致，见 P0-1②第 4 条）。

### 3.2 流式路径（`streamMessageFlow`）

- 落点：`:2062` 的 **`else`（无 tool_calls）分支**，在 `assistantMessage` 终态落定之前。
- `repair`：复用同一条 `StreamPipeline` 以"再跑一次"的方式取修正文本（**执行方式见 D2**）。
- `repaired === true` ⇒ 经 `host.updateMessageBlocks(assistantMessage.id, <修正后 text 块>)` **替换**正文（G4），并保证事件面可重建（§1.6）。
- 既有流式体验不变（先流后替换，与工具轮 `_supersedeNextRoundText` 同语义）。

### 3.3 非流式路径（`ChatOrchestrator.sendMessage`）

- 落点：构造 `ChatResponse` **之前**。
- `repaired === true` ⇒ 用修正文本作为 `response.content`，并同步落盘/更新消息（此时正文**尚未交给调用方**，无需 supersede）。

### 3.4 影响面（预计）

| 文件 | 改动 |
|---|---|
| `app/src/chat/finalOutputGuard.ts` | **新增**（共享守卫，含契约用例） |
| `app/src/chat/orchestrator/streamMessageFlow.ts` | 改：无工具分支接入守卫 + supersede |
| `app/src/chat/orchestrator/ChatOrchestrator.ts` | 改：非流式返回前接入守卫 |
| `app/tests/chat/finalOutputGuard.test.ts` | **新增**：契约用例（干净/命中/修复失败/先落盘顺序） |

> **不改**：`client/`；`api-spec.md`；事件类型；`ReActToolLoop` 既有逻辑。

---

## 4. 决策点（待评审裁定）

| ID | 决策项 | 选项 | 建议 |
|:--:|---|---|---|
| **D1** | 共享守卫的落点 | (a) 新模块 `chat/finalOutputGuard.ts` ／ (b) `ReActToolLoop` 静态方法 | **(a)**：两路径共用，避免把宿主编排类当工具库 |
| **D2** | 流式路径的**修复调用**如何复用模型 | (a) 抽出 `StreamPipeline` 的**最小单次调用入口**（同一套装配）／ (b) 直接用 `aiService` 非流式调用（少一层，但需自备 messages/system） | **(a)**：与首次调用同源，避免第二套提示词装配（CS01） |
| **D3** | 替换语义 | (a) `updateMessageBlocks` 全量替换该消息 blocks ／ (b) 追加一条"修正后正文"事件 | **(a)**：与工具轮 supersede 同语义（用户只看到一份） |
| **D4** | 是否同时覆盖非流式 | (a) 覆盖（推荐）／ (b) 仅流式 | **(a)**：非流式改动小且同源 |
| **D5** | 修复上限 | 1 次（同 P0-1②） | 固定 1 次 |

---

## 5. 验收（可证伪）

| 项 | 通过标准 |
|---|---|
| G1/G2（**post-fix 对照**） | **无工具**回合注入坏 mermaid ⇒ 插桩 D（`issues≥1`）+ E 命中 ⇒ 会话 `events.jsonl` 出现 `validation/injected` ⇒ **返回正文为修正后**（与 pre-fix 的"原样返回坏块"形成对照） |
| G3 | 全仓 `mermaidLint` / `mermaid_repair` / `validation/injected` 仍各只有**一处**实现/定义 |
| G4 | 替换路径 = `updateMessageBlocks`（grep 佐证），无新替换通道 |
| 零回归 | 工具轮既有 `mermaid_repair` 用例全绿；`typecheck 0` · `lint:arch 0 错` · 全量 `bun test` 0 fail |
| 突变验证 | ① 去掉"先落盘"⇒ 顺序用例必 red；② 把上限改为 2 ⇒ 上限用例必 red |
| 未做（明确） | 非 mermaid 产物校验（N3）、重试调优/提示词演化（N5） |

---

## 6. 合规（对照 workspace rules）

| 规则 | 落点 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行，批准后实施 |
| **CS01 归一化** | ✅ 复用既有校验器/模板/事件；守卫为**唯一**新增抽象且被两条路径共用 |
| CS02 状态判定 | ✅ 用 `repaired:boolean` 结构字段与闭集 kind，不用用户可见字符串 |
| CS03 回退最小化 | ✅ 修复失败**如实原样放行**；不做无上限重试/静默兜底 |
| CS05 根因优先 | ✅ 根因＝"覆盖面绑定在工具轮上"，修复＝把守卫接到两条直连路径，而非在工具轮内补丁 |
| §1.6 模型可见 ⇔ 已落盘 | ✅ `validation/injected` 先落盘再注入 |
| §1.3 无兼容包袱 | ✅ 不留旧路径/开关 |
| 文件行数 ≤1000 | ✅ 新模块远低于上限（`streamMessageFlow` 已在既有例外清单内） |

---

## 7. 风险与边界（如实）

1. **流式替换的用户观感**：先看到坏图、随后被替换（与工具轮既有 supersede 行为一致；非新增体验类型）。
2. **成本**：命中时每回合**多一次模型调用**（仅命中坏 mermaid 时；上限 1 次）。
3. **D2 的取舍**：抽 `StreamPipeline` 单次入口会触及流式装配（改动面大于"接一根线"）；若评审认为风险偏高，可退化为 (b)。
4. **覆盖边界**：本 spec 只保证"**助手终稿**里的 mermaid 块"；工具返回值里的 mermaid 不在范围（与 P0-1② 既有边界一致）。
5. **调试环境**：`debug-mermaid-selfheal-miss.md` 保持 `[OPEN]`，插桩与 Debug Server 保留至 post-fix 对照完成，之后再清理。

---

## 8. 实施记录（2026-10-04）

**裁定**：D1=(a) 新模块 · D2=(a) 复用同源 client+messages · D3=(a) `updateMessageBlocks` 全量替换 · D4=(a) 同覆盖非流式 · D5=上限 1 次。

| 文件 | 改动 |
|---|---|
| `app/src/chat/finalOutputGuard.ts` | **新增**：`guardFinalOutput(text, deps)` —— 校验 → **先落盘** → 一次有界修复；失败如实放行 |
| `app/src/chat/orchestrator/ChatOrchestrator.ts` | 改：`ChatOrchestratorHost` 增 `updateMessageBlocks` 端口 |
| `app/src/chat/ChatManager.ts` | 改：host 装配补 `updateMessageBlocks` 转发 |
| `app/src/chat/orchestrator/streamMessageFlow.ts` | 改：**无工具分支**接入守卫；修复复用同源 `activeClient.streamMessage` + `StreamingThinkScrubber`；替换走 `updateMessageBlocks` |
| `app/tests/chat/finalOutputGuard.test.ts` | **新增**：5 用例（干净放行 / **先落盘再修复**顺序 / 无产出 / 抛错 / 仅空白） |

**验证实测**

| 项 | 结果 |
|---|---|
| `bun run typecheck` | **0** |
| `bun run lint:arch` | **错误 0**（警告回基线） |
| `tests/chat/finalOutputGuard.test.ts` | **5 pass / 0 fail** |
| `tests/chat` + `tests/query`（改动面定向） | **473 pass / 0 fail**（76 文件 / 12.33s） |
| **post-fix 运行时对照** | ✅ 探针 H：`issues:1 repaired:true`；会话落 `validation/injected` **1 条**；消息 **blocks 已替换为合法 `flowchart TD`**（pre-fix 为原样坏块） |
| 全量 `bun test tests/` | ⚠️ **未收口**（>5min，与 `file-size-debt-partition-plan.md` §7.8 记录的"资源争抢"同因；本机另有 `--watch` 实例在跑）⇒ 以改动面定向套件为准 |

**过程中自查并修复的自身缺陷（如实）**：首版修复轮未擦洗 ⇒ blocks 带出 `<response>` 协议标签；已补 `StreamingThinkScrubber` 并复验干净。

**残留（如实，未修）**：`updateMessageBlocks` 只替换 **blocks**；消息顶层 `content` 仍为流式原稿。渲染源是 blocks（前端可见面正确），但读 `content` 的消费方（导出/下一轮上下文）可能拿到旧文本 ⇒ 属既有 `updateMessageBlocks` 语义，另议。

**未覆盖（按非目标）**：非流式路径的接入**未实施**（本轮聚焦用户可见的流式主路径；`ChatOrchestrator.sendMessage` 的接入点已定位，留作后续）。

---

## 9. 剩余项补齐（2026-10-04，用户裁定「继续做剩余项」）

### 9.1 非流式路径接入（原 §8「未覆盖」）

- 落点：`ChatOrchestrator.sendMessage` 的 `validateOutputPaths(...)` **之后**（`:741`）。
- `repair` 复用同一 `invokeLlm(ctx, activeClient)`（CS01：不另起第二套装配；仅向临时 ctx 追加一条 `steering` 片段）。
- `repaired` ⇒ 同步更新 `assistantMessage.content` + `response.content`，并经 `updateMessageBlocks(..., text)` 落盘。

### 9.2 顶层 `content` 与 blocks 一致性（原 §8「残留」）

- `updateMessageBlocks` 增**可选**第 4 参 `text?: string`：提供时一并写 `message.content`（**增量、向后兼容**，其余调用方零改动）。
- 两处调用（流式/非流式）均传 `guardResult.text`。

### 9.3 复验（post-fix，运行时）

| 路径 | 证据 |
|---|---|
| **非流式** | 会话 `session_mut2jhxn855vjvulklf`：`events.jsonl` 落 `validation/injected` **1 条**；`app.log` = `sendMessage:no_tool_final_output_repaired (issueCount:1)`；**最终 blocks = 合法 `sequenceDiagram`**（pre-fix 为 `flowmap` 坏块） |
| **流式** | 会话 `session_mut2jmri9lnwuzvyy4j`：`app.log` = `streamMessage:no_tool_final_output_repaired`；消息顶层 **`content` 与 `blocks` 一致**（均为修正后的 `flowchart TD`） |

**门槛（本轮复跑）**：`typecheck 0` · `lint:arch` **错误 0 / 警告 2（基线）**，分层 3856 → **3857**（+1 新文件）· `tests/chat` **343 pass / 0 fail**（另 `tests/query` 同批 **473 pass / 0 fail**）。

⇒ 本 spec 的 G1–G4 与 §5 验收项**均已达成**（全量套件未收口一事见 §8 说明）。

---

## 10. 后续更新：收编为统一输出护栏入口（13-P2-1，2026-10-05）

**来源**：`dev_docs/任务计划-20261004.md` §13.3（13-P2-1，源自 Agentic Design Patterns 21 模式复查 A6「护栏单侧」）。

**改动**（`outputGuards` 为**可选**依赖 ⇒ 不注入时本 spec 全部既有行为/验收不变）：

- **core 层新增统一契约 + 注册表**：`app/src/core/outputGuard/{types,registry,index}.ts`
  —— `OutputGuard{name,priority,check}` / `OutputGuardVerdict{action:'pass'|'redact'|'block',text?,issues}` /
  `runOutputGuards(guards,text)` 顺序管线（priority 升序；`redact` 累积改写、`block` 短路）/
  `OutputGuardRegistry` + `getOutputGuardRegistry()`（唯一实例）。
- **app 层具体护栏**：`app/src/chat/outputGuards/`
  —— `sensitive_content`（**PII/密钥打码**，复用 `SensitiveDataService.sanitize`；`FEATURE_OUTPUT_GUARD_BLOCK=true` ⇒ **敏感拦截**）·
  `injection_echo`（**注入回显观测**，复用 `PromptInjectionDetector.detect`，仅 info/warn）。
- **收编**：`guardFinalOutput` 在 mermaid 校验**前/后**各跑一次统一管线（`deps.outputGuards`）：
  打码改写正文 → mermaid 校验作用于打码后文本 → **修复产物再复检一次**（防修复轮带回敏感内容）；
  阻断 ⇒ 提前返回 `{blocked,blockReason,text=安全替代文本}`，不再修复。
  结果新增 `guardIssues` / `blocked` / `blockReason` / `redacted`。
- **两条路径**接入：`streamMessageFlow`（阻断/打码 ⇒ `updateMessageBlocks` 替换，日志 `*_blocked`）·
  `ChatOrchestrator.sendMessage`（同步更新 `content` + `response.content` + blocks）。
- **组合根**：`ChatManager` 构造调 `registerDefaultOutputGuards()`（幂等）。
- **开关**：`FEATURE_OUTPUT_GUARD`（默认 **false** ⇒ 空注册、零行为变更）· `FEATURE_OUTPUT_GUARD_BLOCK`（默认 false ⇒ 打码）。

**如实边界**

1. **mermaid 的 lint 未下沉为护栏**：它需要 LLM/事件落盘（异步 + IO），不满足「同步纯文本」契约
   ⇒ 保留为本函数内的 remediation；「收编」指**统一管线入口 + 内容护栏合流**，非把修复搬进注册表。
2. **输入侧 3 套检测器未迁移**：报告原建议的完整 `IGuardrail{phase}` 含 input 相位；本轮按 §13.3 收敛口径**只落地输出相位**。
3. **默认关闭**：开启后邮箱/卡号等会被打码（可见行为变更）⇒ 需显式 `FEATURE_OUTPUT_GUARD=true`；当前生产路径**未开启**。
4. **既存缺陷（另记台账）**：`SensitiveDataService.detectSensitiveData()` 用 `/g` 正则 + `.test()` 判定，连续调用会因 `lastIndex` 残留交替返回 ⇒ 本护栏**刻意改用 `sanitize()` 的"文本是否变化"判定**规避。

**门槛（本轮实测）**：`typecheck 0` · `eslint` 新增文件 0 error · `lint:arch 错误 0`（警告回基线）·
`lint:size 错误 0`（警告回基线 463）· 定向 `tests/core/outputGuard` + `tests/chat/outputGuards` + `tests/chat/finalOutputGuard` **24 pass / 0 fail** ·
全量 `bun test` **4557 pass / 0 fail**（4578 tests / 482 files）。
