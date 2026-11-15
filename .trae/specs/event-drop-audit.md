# 事件静默丢弃审计（P1-2）

> 日期：2026-11-15 · 范围：会话事件日志（`events.jsonl`）的**写入与读取链路** · 方法：静态取证（grep + 逐行读实现），不执行被测代码。
> 规则依据：`project_rules.md` §1.6「模型可见 ⇔ 已落盘」红线、`coding-standards.md` CS06（禁止空结果编造）、AR-3（「没跑」不得当成「通过」）。

## §1 事实基线：`append` 实际会返回什么

`EventLogStorage.append()` 现实现只有 3 种失败 reason（`packages/service/src/session/storage/EventLogStorage.ts`）：

| reason | 触发点 | 证据 |
|---|---|---|
| `invalid-event` | 无损 JSON 校验失败；运行时未知事件类型 | L586–L596、L599–L611 |
| `session-dir-missing` | 会话目录被外部进程删除（TB-14/E1-a，主动放弃） | L710–L716 |
| `write-error` | `appendFile` 抛错 | L790–L793 |

外层 `ChatEventLogStore.appendStreamEvent()` 另加一种：`exception`（L315–L322）。

**关键订正**：`duplicate-seq` / `out-of-order` **今天已不存在** —— H11 起 seq 冲突走「自动纠正」（L667–L704，`logger.warn` 后重分配），不丢事件。但两处口径仍是旧的：

- 文件头守卫说明（L12–L14）仍写「拒绝并返回 duplicate-seq/out-of-order」「重复 seq 幂等，文件不变」；
- `appendStreamEvent` 仍保留死条件 `result.reason !== 'duplicate-seq'`（L284–L289）——该 reason 在当前实现中**永不产生**（全仓 `reason: 'duplicate-seq'` 命中 0 处）。

## §2 逐点判定

| 编号 | 位置 | 行为 | 丢事件 | 可观测性 | 判定 |
|---|---|---|---|---|---|
| D1 | `EventLogStorage.ts:586-596` | sanitize 拒绝（BigInt/undefined/循环引用） | **是** | 单行 `logger.warn`，**不进 ErrorTracker、无计数、无事件** | **缺陷** |
| D2 | `EventLogStorage.ts:599-611` | 运行时未知事件类型 `assertEventWritable` 拒绝 | **是** | 同上 | **缺陷** |
| D3 | `EventLogStorage.ts:790-793` + `recordAppendFailure` L1024–L1068 | 写盘失败 | 是 | `handleError(AppError HIGH)` + 熔断 + `reconcileDrain` 暂停对账；节流窗口内仅 `debug` | 可接受（已具观测链） |
| D4 | `EventLogStorage.ts:710-716` | 会话目录已被删除，主动放弃 | 是（有意） | 无告警（有意） | 合法（TB-14/E1-a） |
| D5 | 33 处 `appendStreamEvent` 实际调用点 | 仅 6 处取返回值（`streamMessageFlow:411/446/1392`、`streamMessageToolLoop:272`、`streamResume:407/575`）；1 处显式 `void`（`usageAccounting:189`）；其余 26 处裸 `await`/不 await | 放大 D1/D2 | 调用方无从得知 | **缺陷（放大面）** |
| D6 | `EventLogStorage.ts:574-580` + `thinkingBuffer.absorb` | 缓冲正文 / 相邻 thinking 合并 | 不丢，但**合并**（请求的每条事件不一定成行） | `debug` | 合法，但**未登记**为允许形态 |
| D7 | 同上 §1 | 头部注释 + `duplicate-seq` 死条件 | — | 误导后续维护者（本次即因此差点重复实现门禁） | **缺陷（文档失真）** |
| D8 | `EventLogStorage.ts:1086-1116` + `MessageToEventMigrator.ts:257-274` | `appendBatch` 部分拒绝 | 由调用方判定 | migrator 已 `logger.error` + 清理半成品 | 合法 |
| D9 | `client/src` 事件回放 | 未穷尽（`getStreamMaxTurn` 注释提到历史「重复回放整块丢弃」） | 待查 | 待查 | **未覆盖**（见 §4） |

## §3 建议修复（最小改动）

- **F1（对应 D1/D2）**：`invalid-event` 从「只 warn」升级为 `handleError(AppError, HIGH, EVENT_APPEND_INVALID)`，与 `write-error` 同一条观测链；错误码区分「载荷不可序列化」与「未知事件类型」。
- **F2（对应 D5）**：至少让**模型可见输入类**事件（`user/message`、`assistant/*`、`tool/result`、`context/*`）在 `ok === false` 时进入同一告警链，而非依赖调用点自觉。
- **F3（对应 D6）**：把「缓冲合并」写进 `project_rules.md` §1.6 的允许形态（合并 ≠ 丢弃，flush 后仍有等价内容）。
- **F4（对应 D7）**：重写 `EventLogStorage` 头部守卫注释；删除 `appendStreamEvent` 的死条件 `duplicate-seq`。

## §4 如实边界（未覆盖）

- 客户端回放侧的丢弃判定（D9）**未审计**：需另查 `client/src` 的事件归约与分页合并路径。
- 非会话事件写入者（渠道 / 任务 / 工作流事件各自的事件表）未纳入本次范围。
- 本审计为静态判定：`invalid-event` 在真实运行中的发生频次**未有实测数据**（`events.jsonl` 中不存在「被拒绝」痕迹，故无法从数据反推）。
