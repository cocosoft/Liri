# LLM 请求 OTel Span 接线 Spec（TR-20 启用观测链路）

> 版本: 1.0 | 创建: 2026-09-22 | 状态: **已实施（2026-09-22）**
> 关联: GR15（Spec-Driven）/ GR01（基础设施复用）/ CS01（复用既有 span 与去重机制）/ CS04（零 Mock）/ CS05（根因优先）/ TR-20（本项即其"启用"路径）
> 前置：用户 2026-09-22 决策「TR-20 按**启用观测链路**处理」

## 1. Problem Statement

`SessionTracing` 的 `llm_request` span 能力**已完整实现但从未被调用** —— 是"半成品"而非"未建"：

- `startLLMRequestSpan(model, options)`（`monitoring/tracing/SessionTracing.ts:233-285`）：创建 `Liri.llm_request` span，挂 `model` / `llm_request.context` / `speed` / `query_source` 属性，支持挂到 `interaction` 父 span，内置 `SpanCoverageRegistry` 去重；
- `endLLMRequestSpan(span, metadata)`（`:292-342`）：写 `llm_request.duration_ms` / `input_tokens` / `output_tokens` / `success` / `error` / **`ttft_ms`**，并 `span.end()`；
- OTel 基础设施齐备：`monitoring/instrumentation.ts` 的 `bootstrapTelemetry()` + `OTEL_TRACES_EXPORTER` / OTLP endpoint / protocol（含 `ANT_OTEL_*` 兼容前缀）；
- `SpanCoverageRegistry.ts:30` 的约定分工明确写着 `SessionTracing` 负责 `llm_request`（交互层）。

**唯一缺口 = 没有调用方**（全仓 `Grep` 证实两者均只命中定义处）。

后果：LLM 请求的延迟/用量在 OTel（启用 exporter 时）**不可见**；且 `llm_request.ttft_ms` 的语义缺陷（实为 TTFB，见 TR-20）因"从未写入"尚未暴露 —— 一旦被误接线即会写入错位指标。

## 2. 事实与影响评估

| 面 | 事实（附证据） | 结论 |
|---|---|---|
| span 设计是否就绪 | `startLLMRequestSpan` / `endLLMRequestSpan` 完整实现（`SessionTracing.ts:233-342`） | **无需改 span 本体** |
| 是否有调用方 | ❌ 全仓无调用（`Grep` 两者均只命中定义处） | 本 Spec 的核心 = **补调用** |
| OTel 导出是否可用 | `instrumentation.ts` 有 `bootstrapTelemetry()` + traces exporter / OTLP endpoint / protocol | 基础设施已具备，**无需新建** |
| 去重约束 | `SpanCoverageRegistry`：父 span 下同名 span 只建一次；`EventBusOTelBridge` 负责 `dag.*`（不产 `llm_request`） | 无冲突，沿用既有去重 |
| 真 TTFT 是否可得 | 本轮已在 `streamMessageFlow` 算出 `firstContentChunkAt − requestStartAt`（首个内容 chunk） | **接线数据已就绪**（CS01 复用） |
| 请求边界上下文 | `streamMessageFlow` 的 `while (true)` 每轮 = 一次 `activeClient.streamMessage`，且持有 `options?.model` 与 `session.id` | 该层**上下文齐全**（provider 层缺 session/model） |
| `ttftMs` 语义缺陷 | `endLLMRequestSpan` 的 `ttftMs` 由**调用方提供** | **接线时传真值**，从源头避免 TR-20 的错位 |

## 3. 决策

| ID | 决策 | 理由 |
|---|---|---|
| D1 | 接线点选 **`streamMessageFlow`**（orchestrator 层），**不选** `BaseAIProvider` | ① 上下文齐全（model/session）；② 真 TTFT 已在该层算出；③ 与 `metric/timing` 同层同粒度（避免两套"请求边界"定义）；④ provider 属传输层，缺业务上下文 |
| D2 | `endLLMRequestSpan` 的 `ttftMs` 传**真 TTFT**（`firstContentChunkAt − requestStartAt`），**不传** TTFB | 从源头消除 TR-20 错位隐患；`ttfb` 已由 session 事件承载，无需进 span |
| D3 | **不改** `SessionTracing` 本体（仅必要注释澄清 `ttftMs` 语义） | span 设计已就绪（GR01 复用），改动面最小 |
| D4 | **不新增** `host.` 方法；`streamMessageFlow` 直接 `import { getSessionTracing }` 单例 | 该文件已 import monitoring 的 logger（同模块族，无循环依赖）；避免为单一用途扩展 host 接口 |
| D5 | span 生命周期用 **try/catch + 必达 `end`**，失败路径同样 `span.end()` | 避免 span 泄漏（未 end 的 span 不导出且占内存） |
| D6 | **失败请求也记 span**（与 session 事件的"仅成功"策略**刻意不同**） | 语义不同：span 是**观测**（失败有诊断价值：`success: false` + `error`）；session 事件为控体积只记成功。**此处差异须显式记录**，避免后人误判不一致 |
| D7 | 本批**不做** `pushApiMetricsEntry`（CLI/TUI 指标回调） | 它是**另一条独立通道**（TUI 展示用），当前无消费者；混做会扩大回归面 |

## 4. 影响文件

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/chat/orchestrator/streamMessageFlow.ts` | 每轮请求：`startLLMRequestSpan` → try/catch 内 `endLLMRequestSpan`（含真 TTFT）；失败路径亦 end |
| 2 | `app/src/monitoring/tracing/SessionTracing.ts` | 仅**注释**澄清 `ttftMs` 语义（"由调用方提供**真 TTFT**；勿传 TTFB"）—— 不改逻辑 |
| 3 | `app/tests/chat/llmRequestSpan.test.ts` | **新建**：以替身 tracer 断言 span 创建与 `end` 必达（成功 + 异常两路径）；断言 `ttftMs` 取真 TTFT |
| 4 | `dev_docs/error_repairs/预存错误与待处理问题.md` | TR-20 状态更新（启用路径已实施） |
| 5 | `dev_docs/20260922/trajectory-benchmark/TR-12-TR-14-决策记录.md` | §7 追加实施结果 |

## 5. 验证方案

| 项 | 通过标准 |
|---|---|
| 类型/检查 | `bun run typecheck` exit 0 ｜ `eslint` 0 error |
| 单测 | 新增用例全绿：成功路径 `span.end()` 调用一次；异常路径同样 end；`ttftMs` == 真 TTFT（非 TTFB） |
| 回归 | `bun test tests/chat tests/monitoring` 全绿；**app 全量 3290 基线不回归** |
| span 泄漏 | 单测覆盖"异常时 `span.end` 仍被调用" |
| 未做（明确） | `pushApiMetricsEntry` 通道（D7）—— **已取证判定为"缺失接收端"**：全仓**无实现方、无调用**，且**无任何 UI/REPL 引用** `ttft` / `ApiMetrics` ⇒ "启用它"等于**新建 UI 指标展示功能**（并需实现一份 `ToolUseContext`），**不是接线缺口**，应单独立项；exporter 配置变更（沿用 `instrumentation.ts`） |

**后续补做（2026-09-22 本批）**：`interaction` 父 span 已接线 —— 见 §9。

## 6. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先于实现创建 |
| GR01 基础设施复用 | ✅ 复用 `SessionTracing` + `SpanCoverageRegistry` + `instrumentation.ts`，零新建框架 |
| CS01 归一化检查 | ✅ 已检索：span 能力与去重机制均既有；真 TTFT 复用本轮已算值 |
| CS04 零 Mock | ✅ 生产路径无 mock（单测替身为测试专用） |
| CS05 根因优先 | ✅ 根因是"缺调用方"（非 span 设计缺失），故只补接线 |
| project_rules §1.8 | ✅ 不新增日志入口 |
| project_rules §1.9 | ✅ span 失败不阻断主流（与事件写入一致）；错误经既有 `handleError` |
| PY_APP §2 简洁优先 | ✅ 只做"创建/结束 + 传真值"，不扩展 span 属性面 |
| PY_APP §3 外科手术 | ✅ 不改 `SessionTracing` 逻辑（仅注释） |

## 7. 风险与待确认

| 风险 / 待确认 | 处置 |
|---|---|
| span 创建的**每请求开销** | `startLLMRequestSpan` 在 `!config.enabled` 时早退（`:240-242`）⇒ 未启用 OTel 时无实质开销 |
| `interaction` 父 span 是否存在 | 不存在时 `llm_request` 为 standalone（`:248` 已处理）；**本批不建 interaction span** |
| 工具循环多轮 ⇒ 多个 `llm_request` span | **符合语义**（每次 LLM 请求一个 span），与 `metric/timing` 粒度一致 |
| 是否有既有测试断言"无 span 调用" | 实现后以 `bun test tests/chat` 验证；如失败则按实际语义调整用例（**不放宽断言**） |

## 8. 实施结果（2026-09-22）

| 项 | 结果 |
|---|---|
| 接线点 | `streamMessageFlow.ts`：每轮 `while (true)` 请求处创建 span（`:999-1041`）；**4 条退出路径**各调 `endLlmRequestSpan()` —— 降级重试前（`:1464`）、catch 末尾（`:1500-1502`）、成功分支（`:1543-1544`） |
| 幂等保障 | `llmSpanEnded` 守卫 ⇒ 多路径重复调用无害。**未用 `try/finally`**：那会给既有数十行代码带来大范围缩进改动（违反"外科手术式修改"），改用「守卫 + 显式调用」 |
| 真 TTFT | `ttftMs = firstContentChunkAt − requestStartAt`；无内容 chunk（纯 tool_call 响应）⇒ **不传**（不拿 TTFB 冒充，D2） |
| 失败语义 | `success: !llmRequestFailed` + `error`（catch 开头置位，截断 200 字符）—— 与 session 事件"仅成功"策略刻意不同（D6） |
| 注解同步 | `SessionTracing.endLLMRequestSpan` 的 `ttftMs` 加注释："**必须传真 TTFT，不得传 TTFB**"（TR-20 教训） |
| 新增单测 | `app/tests/chat/orchestrator/llmRequestSpan.test.ts`（2 例：成功路径 start/end 各一次 + `ttftMs` 有限非负；中断路径 span 仍 end 且 `success=false` / `error` 有值）。**替身方式**：直接替换 `getSessionTracing()` 单例方法，**不做模块级 mock**（避免波及 `@modules/monitoring` 的 logger 等测试基座依赖） |
| 验收 | `typecheck` 0 ｜ `eslint` 0 ｜ 新增 2 例全绿 ｜ `tests/chat` 185 pass ｜ app 全量 **3290 pass / 19 skip / 0 fail**（基线不回归） |
| 未做（明确） | `pushApiMetricsEntry`（D7）；`interaction` span 的创建；exporter 配置（沿用既有） |

**实施过程中澄清的两处事实**（留档以免后人重复排查）：

1. **不存在"双轨 OTel"**：`SessionTracing.getTracer()` 内部即 `getOTelTracing().getTracer()`（`SessionTracing.ts:92-98`，注释明示"确保所有 Span 在同一棵树内"）⇒ 与既有 span **同树**，本项不会产生第二套 trace。
2. **本文件所在层早于本项已有 span 使用**：`streamMessageFlow` 一直有 `ctx.streamSpan.addEvent(...)`（上层传入）⇒ 本项补的是 **`llm_request` 语义 span**，并非"从零引入观测"。

## 9. 后续补做：`interaction` 父 span 接线（2026-09-22）

**背景**：§5 原列为"未做"的 `interaction` span（`startInteractionSpan` / `endInteractionSpan`）同样**全仓无调用方** —— 与 `llm_request` 是同一类「端点齐全、只缺调用」的半成品。

| 项 | 结果 |
|---|---|
| 接线点 | `streamMessageFlow.ts` 的 `runStreamMessage`：`startInteractionSpan(content)` 置于**最外层 `try` 之前**（`:235-247`）；`endInteractionSpan()` 置于最外层 `finally`、与 `mutex.release()` **同层**（唯一释放点，`:2417`）—— `endInteractionSpan` 自带 `spanContext` / `ended` 双重守卫，重复调用无害 |
| 属性用**原始输入** | 传 `content`（函数参数），**不传** `ctx.content`（`_prepareStreamSession` 处理后的内容，可能含图片/附件标记与**本地路径**）—— span 属性会导出到 tracing 后端，不应带路径 |
| 效果 | 使本轮内的 `llm_request` 嵌套在"一次用户交互"之下（`SessionTracing` 经 AsyncLocalStorage 传递父 span：`:196` `enterWith` / `:244` `getStore`） |
| 新增单测 | 同文件 +2 例（成功路径 interaction start/end 各一次且 `prompt` 为用户输入；中断路径仍 end） |
| 验收 | `typecheck` 0 ｜ `eslint` 0 ｜ 该文件 **6 pass / 0 fail**（2 `llm_request` + 2 `interaction` + 2 机制探针）｜ app 全量 **3296 pass / 0 fail** |
| **机制已验证（2026-09-22 补测）** | 曾标"未验证"（`AsyncLocalStorage.enterWith` 与 **async generator** 的组合在 `yield` 之后是否有效）。**已补机制探针实测通过**：`enterWith` 设定的 store **跨 `await` 与跨 `yield` 均可见**（2 例，见 `llmRequestSpan.test.ts` 的「机制验证」describe）⇒ `interaction` 父 span 能被重试循环内的 `startLLMRequestSpan` 读到，**嵌套成立**。**附带固化的既有语义**：`enterWith` **不自动恢复**（generator 结束后调用方仍可见该 store）—— 这正是 `endInteractionSpan` 必须显式 `enterWith(undefined)` 清除的原因（`SessionTracing.ts:224`）。**残余边界**：本次验证的是**机制层**（原生 ALS + generator）；`config.enabled=false` 时 `startInteractionSpan` 早退为 dummy（不执行 `enterWith`），故**集成层的父子关系建议启用 exporter 后肉眼确认一次**（机制已不成疑） |
