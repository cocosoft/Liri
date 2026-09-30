# `core/modules → monitoring` 收口（96 对）—— core 日志门面化

> 台账：**D-70** · 上游：`layer-inversion-a-class-inventory.md` §3（A 类倒挂）
> 状态：见 [§8](#8-任务状态) · 最后更新 2026-09-30

---

## §1 背景与问题

1. `BULK-010`(`core -> infra`) 探针实测 **120 对**（D-69 附带发现，旧估值 20 严重低估）。其中**最大单簇是 `monitoring`**。
2. 本 spec 取证实测：`core` / `modules` 取用 `monitoring` 的源文件共 **96 个** ⇒ **96 对**（占该桶 80%）：

| 来源 | 对数 | 说明 |
|---|:--:|---|
| `app/src/core/**` | 59 | 54 经 `@modules/monitoring`（其中 6 处为子路径 `…/logs/Logger.js`、`…/otel/*`）· 5 经相对路径 `../../monitoring/logs/Logger` |
| `app/src/modules/**` | 37 | 全部 `@modules/monitoring` |
| 合计 | **96** | **≈89 对是纯 `getLogger`** |

3. **`core/spi/LoggerService.ts` 本就是为此而建**（其文件头原话：*"core 层代码通过 `resolveLogger()` 获取 Logger，避免直接 import monitoring 层"*），但 core 侧**从未采用** ⇒ 这是"既有基础设施未被使用"的收口，**不是新造抽象**（CS01）。

### 🔴 两个必须解决的语义问题（否则机械替换会制造新缺陷）

**(a) 顶层绑定 → 永久 noop**：96 个文件几乎都是顶层取 logger（`const logger = getLogger('x')`，模块求值即执行）。而 `resolveLogger()` 在 SPI 注册前返回 **noop** ⇒ 注册前求值的模块会把 noop **永久绑进顶层常量**（不是"早期丢日志"，而是**这些模块此后全部日志静默消失**）。
> 仓内先例印证：[`acp/AcpWsClient.ts:39-43`](../app/src/acp/AcpWsClient.ts) 正是为规避此坑而改用惰性取值。

**(b) 注册前窗口**：SPI 注册发生在 `DIContainer.start()`（`DIContainer.ts:310-319`）；此前 core 侧日志会丢。

---

## §2 目标与非目标

### 2.1 目标
- **G1**：`core`/`modules` 对 `monitoring` 的 **96 对**清零（`已豁免` 390 → 预期 **~301**，以实测为准）。
- **G2**：**调用点语法零改动** —— 消费方**只改 import 路径**（符号名 `getLogger` 不变）。
- **G3**：**日志零丢失** —— 修复 (a) 顶层永久 noop，并对 (b) 做**注册前缓冲 + 注册后回放**（用户裁定）。
- **G4**：对外 API 与既有一致：`@modules/monitoring` 的 `getLogger` 语义不变（仍是官方门面）；core 侧走 SPI 门面。

### 2.2 非目标
- ❌ 不改 `monitoring` 模块内部实现（`Logger` / `OTelTracing` / `OTelMetrics` / `HealthChecker` 一律不动）。
- ❌ 不引入"禁止 core 使用 monitoring"之外的新门禁规则。
- ❌ 不动 `BULK-010` 的其余 ~24 对（非 monitoring 目标：`config` / `error` 存量 / `cost` / `utils` / `performance` / `state` …）⇒ 另立批次。
- ❌ 不改 `error` 模块对 `monitoring` 的取用（infra → infra，本来就合法）。

---

## §3 方案

### 3.1 升级 `core/spi/LoggerService.ts`（延迟绑定 + 注册前缓冲回放）

**① 延迟绑定（memoized 转发代理）**：新增 `createDeferredLogger(module)` —— 返回的 `ILogger` **不持有实现**，每次方法调用时才解析当前 `_loggerService`。
- **按 module memoize**（`Map<string, ILogger>`）⇒ 反复调用零分配、身份稳定。
- `resolveLogger(module)` 的**返回类型与用法不变**，语义升级为延迟绑定 ⇒ 顺带修掉 (a)（既有唯一消费方 `AcpWsClient` 本就用惰性，不受影响）。

**② 注册前缓冲 + 回放**：
- 未注册期间的调用进入 `_pending` 队列（**上限 500**，超出计数丢弃，不无界增长）。
- `registerLoggerSpi()` 设置 `_loggerService` 后 **flush**：逐条回放，并输出 **1 行汇总**（回放 N 条 / 丢弃 M 条）—— 回放本身走正式实现，故不会再次入队。
- **如实说明局限**：回放日志的**时间戳为回放时刻**（Logger 自填），非原始发生时刻；不额外伪造时间字段（避免与既有 JSON schema 冲突）。

### 3.2 新增 core 根门面 `core/loggerFacade.ts`（**同名**导出 ⇒ 1 行改动）

```ts
export { resolveLogger as getLogger } from './spi/LoggerService.js';
export { resolveLogger, type ILogger } from './spi/LoggerService.js';
```

- **为什么放 core 模块根**：`core/spi/**` 是**子目录**，跨模块（`modules/**`）或 core 内相对引用它会被 **R03-002「模块出口单一」**判违规（D-62 实测）；模块根相对引用（`../loggerFacade.js`）不触发（D-62/D-69 已验证）。
- **为什么同名 `getLogger`**：消费方 96 个文件的 `const logger = getLogger('x')` 与 `logger.info(...)` **一字不改**，diff 仅 1 行 import ⇒ 最小化误改面。

### 3.3 Phase 1：89 个"纯 `getLogger`"文件改路径（仅 import 行）

| 源 | 新 import |
|---|---|
| `app/src/core/**`（52 个） | 相对 core 根（`./loggerFacade.js` / `../loggerFacade.js` / `../../loggerFacade.js`，随深度） |
| `app/src/modules/**`（37 个） | `../../../loggerFacade.js` 等（模块根相对） |

> **禁止**在沿革注释里照抄 import 语句（D-59 实测：门禁正则也匹配注释内 `from '…'`）。

### 3.4 Phase 2：9 个特殊情况（**另行设计，不在 Phase 1 内**）

| 文件 | 特殊点 | 拟处理 |
|---|---|---|
| `core/events/TokenTracker.ts` | `createLogger` + `LogLevel` | 用门面 `getLogger` + `SpiLogLevel`（口径同 D-69 对 `handleError` 的改写） |
| `core/AppCoreOTelHelper.ts` | `getLogger, Logger`（`Logger` 疑似**当类型用**） | 类型位置改 `ILogger`（SPI）；若用到类独有成员则另议 |
| `core/migration/StateMigrator.ts` | `Logger, getLogger as getModuleLogger` | 同上 |
| `core/events/OrchestrationMetrics.ts` | `type OTelMetrics` + `getLogger` | OTel Metrics 需**新 SPI**（本轮仅有 `resolveOTelTracing`）⇒ 另议 |
| `core/events/EventBusOTelBridge.ts` | 多行 import，符号待核 | 待核后归类 |
| `core/events/EventBus.ts` | 经子路径 `…/logs/Logger.js` 取值，符号待核 | 待核 |
| `core/loop/PlanDrivenLoop.ts` | `getLogger` + `getOTelTracing` | `getOTelTracing` → **已就绪**的 `resolveOTelTracing()`（D-69） |
| `core/session/SessionSupervisor.ts` | `getLogger` + `getOTelTracing` | 同上 |
| `core/flows/doctor-health.ts` | `HealthChecker`（类，非 logger） | 需端口或另议 |

### 3.5 注册缝

**不变** —— `DIContainer.ts:310-319` 已注册 Logger SPI；本 spec 只在其内部追加 flush 调用（见 §3.1②）。

---

## §4 风险与对策

| # | 风险 | 对策 |
|---|---|---|
| R1 | 顶层永久 noop（本 spec 的核心动机） | 延迟绑定代理（§3.1①）；**验收**：抽取若干启动早期模块，确认注册后仍有日志 |
| R2 | 注册前日志丢失 | 缓冲 + 回放（§3.1②，用户裁定）；缓冲有上限 + 丢弃计数，**不静默** |
| R3 | 回放时间戳失真 | 明确写入本 spec 与代码注释（§3.1②「如实说明局限」），不伪造字段 |
| R4 | R03-002（跨模块引用 core 子目录） | 门面放 core **模块根**（§3.2） |
| R5 | 批量改动的误改面 | 每文件**仅改 import 行**；以 `typecheck` + 门禁**总数变化**+ grep 残留为三重校验 |
| R6 | `ILogger` 与 monitoring `Logger` 的方法面差异（如 `error(msg, Error)` 重载） | `ILogger` 已声明 `error(message, error)` 重载；差异由 `typecheck` 暴露 ⇒ 归入 Phase 2 |
| R7 | 缓冲被早期高频日志打满 | 上限 500 + 丢弃计数 + 回放汇总行 |

---

## §5 验收（实测口径）

| 项 | 命令 | 预期 |
|---|---|---|
| 类型 | `cd app; bun run typecheck` | exit 0 |
| 分层门禁 | `cd app; bun run lint:arch` | 违规 0 · 错误 0 · 警告 1（既有 `REF`） · **`已豁免` 390 → 390 − (Phase 1 对数)** |
| 残留复核 | grep `@modules/monitoring` / 相对 `monitoring/` | `core`/`modules` 下**仅剩 §3.4 的 9 个特殊文件** |
| 全量测试 | `cd app; bun test` | 与基线一致（4251 pass / 21 skip / 0 fail） |
| SPI 行为 | 单测或手验 | 注册前调用入队、注册后回放；顶层 `const logger = getLogger(x)` 在注册后**不再 noop** |

---

## §6 未覆盖 / 遗留

| # | 遗留 | 说明 |
|---|---|---|
| L1 | §3.4 的 9 个特殊文件 | 含需**新 SPI** 的 `OTelMetrics`；本轮不做 |
| L2 | `BULK-010` 剩余 ~24 对（非 monitoring） | 另立批次 |
| L3 | 其余 13 个 bulk 桶的 `estimatedCount` 仍未实测 | 仅 `core -> infra` 已校正（D-69）；建议逐桶探针/复刻脚本重估 |
| L4 | 回放日志的时间戳语义 | 见 §3.1②；如将来需要"原始时间"，再评估是否扩 Logger schema |

---

## §7 合规清单

| 规则 | 落实 |
|---|---|
| **GR01** 基础设施复用 | ✅ 复用 **既有** `core/spi/LoggerService.ts`（其设计目的即此）；不新造日志框架 |
| **CS01** 归一化 | ✅ 新增前检索确认 SPI 已存在且未被 core 采用 ⇒ 采用而非另起 |
| **CS02** 禁字符串匹配判状态 | ✅ 不引入字符串判据 |
| **CS03** 回退最小化 | ✅ 缓冲回放是**用户裁定**的行为保全手段，非"以防万一"；有上限、有丢弃计数、有汇总行 |
| **CS04** Mock 零容忍 | ✅ 无 mock；noop 只是注册前占位 |
| **CS06** 证据驱动 | ✅ 96 对逐文件 grep 得出（含相对路径 5 个，避免漏算）；以门禁总数变化为终判 |
| **R02** 数据模型统一 | ✅ 日志能力仍单一实现（monitoring），core 仅经 SPI 取值 |
| **R03-002** 模块出口单一 | ✅ 门面落 **core 模块根**（D-62/D-69 验证形态） |
| **R06-008** 分层 | ✅ 方向 `core → core`（经 SPI）；对 monitoring 的引用仅存在于**注册缝**（动态 import，既有设计） |
| **R11-001** Logger 门面 | ✅ 不 `new Logger(...)`；core 侧走 SPI 门面 |
| `project_rules` §1.8 日志规范 | ✅ `getLogger(module)` 的**用法与命名不变**；仅把 core 侧取值路径从 monitoring 换成 SPI（§1.8 管"用门面还是 new"，本 spec 未违背） |

---

## §8 任务状态

| # | 任务 | 状态 |
|:--:|---|:---:|
| 1 | 取证 96 对 + 识别顶层绑定陷阱 | ✅ 完成（§1） |
| 2 | 本 spec | ✅ 完成 |
| 3 | 升级 `core/spi/LoggerService.ts`（延迟绑定 + 缓冲回放） | ✅ 完成（`resolveLogger` 改转发代理 + `_pendingLogs`/`PENDING_LOG_LIMIT=500` + `flushPendingLogs()`） |
| 4 | 新增 `core/loggerFacade.ts` | ✅ 完成（`export { resolveLogger as getLogger }`） |
| 5 | Phase 1：**87** 个文件改 import 路径（原估 89） | ✅ 完成（core 50 + modules 37；各文件**仅改 import 行**） |
| 6 | Phase 1 验收（§5） | ✅ 完成 —— 见下 |
| 7 | Phase 2：9 个特殊情况 | ✅ **完成 9 / 9** —— 8 个按端口/门面收口；`doctor-health.ts` 经审计为**零消费方死代码**（`@deprecated`）⇒ **删除**（明细见台账 D-70） |
| 8 | 台账 D-70 + `BULK-010` 计数下调 | ✅ 完成（`BULK-010` 120 → 33 → **24**） |

**Phase 1 验收（实测，我独立复核）**：`typecheck` **0** · `lint:arch` **违规 0 / 错误 0 / 警告 1**（仅既有 `REF`）· **`已豁免` 390 → 303（−87，与改动文件数逐数吻合）** · 扫描文件 3964 → 3965 · grep 复核：`core` 残留**恰好只在 §3.4 的 9 个文件**、`modules` 下**全清** · 全量 `bun test` **4251 pass / 21 skip / 0 fail**。
**Phase 2 验收（实测）**：`typecheck` **0** · `lint:arch` **违规 0 / 错误 0 / 警告 1** · **`已豁免` 303 → 295（−8）** · 全量 `bun test` **4251 pass / 21 skip / 0 fail**。
**🔴 Phase 2 真实返工（如实记录）**：首轮 `IOTelTracing` 接口**不全**（漏 `startSpan`/`endSpan`）⇒ **7 处 `TS2339` + 2 个测试失败**；补全接口并把 noop 改为 **OTel API 自身的 noop tracer**（返回合法 `NonRecordingSpan`）后全部转绿。**教训**：把"具体实现"替换为"接口 + 回退实现"时，必须①穷尽该实现类在消费方的**全部方法面**，②回退实现要**行为等价**而非仅"编译不报错"。
**顺带**：`core/paths.ts` 因本次改动而过时的沿革注释（原述"直连 Logger 实现文件而非 monitoring barrel…触发 TDZ"）已改写为门面/SPI 口径。
