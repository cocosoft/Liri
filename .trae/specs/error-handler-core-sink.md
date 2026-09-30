# `handleError` 去 infra 依赖并下沉 `core`（G3 端口化收口）

> 台账：**D-69**（本 spec 的落地记录）· 上游：[`layer-inversion-a-class-inventory.md`](./layer-inversion-a-class-inventory.md) §3.5 / [D-63]
> 状态：**[§8 任务状态](#8-任务状态)** · 最后更新 2026-09-30

---

## §0 修订记录

| 日期 | 变更 |
|---|---|
| 2026-09-30 | 初版（用户裁定「出 G3 spec 并落地端口化」） |

---

## §1 背景与问题

1. **D-63 已完成「第 2 批 AppError 家族」**（2026-09-29）：`AppError` / `ErrorCategory` / `ErrorSeverity` 下沉 `core/errors.ts`，`error/types.ts` 改为转出，**20 对清零**。
2. **D-63 明确留下尾巴**：8 个消费方因**同对还有 `handleError` 语句**而未清零（D-61/D-62 已三次踩中「同对残留 ⇒ 计数不变」）。
3. **本 spec 的实测扩面**（比 D-63 记的 8 个更大）：全仓仍从 `error` 模块取 `handleError` 的 **core 层源文件 = 27 个** ⇒ **27 对 `core -> infra`**：

| 取用路径 | 文件数 | 文件 |
|---|:--:|---|
| `@modules/error`（barrel）· 位于 `app/src/core/**` | 21 | `AppCoreOTelHelper` · `boot/BootPipeline` · `boot/BootPipelineIntegrator` · `Coordinator` · `di/ContainerScope` · `di/DIContainer` · `delivery/notifier/FailureNotifier` · `delivery/monitor/DiskSpaceMonitor` · `extensibility/ModuleManager` · `extensibility/PluginLoader` · `lazy/LazyService` · `flows/model-picker` · `memory-host-sdk/events` · `RemoteConfigManager` · `session/SessionSupervisor` · `storage/SecureStorage` · `tokenBudget/CacheAwareBudget` · `tokenBudget/ContextStatsCollector` · `tokenBudget/ModelContextCache` · `tokenBudget/PriceManager` · `tokenBudget/UnifiedTokenTracker` |
| `@modules/error/handleError`（子路径） | 2 | `core/external/sqlite3` · `core/loop/PlanDrivenLoop` |
| `@modules/error`（barrel）· 位于 `app/src/modules/**` | 4 | `modules/doc/installation/OfficeCliInstallService` · `modules/doc/api/officeHandlers` · `modules/doc/pipeline/DocPipelineTool` · `modules/doc/workflow/DocWorkflow` |

> **口径**：门禁统计单元 = **(源文件 × 目标模块) 对**；上表 27 个文件对 `error` **各仅 1 条语句** ⇒ 逐对可清零。

4. **为什么不能像 AppError 那样直接下沉**：`handleError` 依赖两个 **infra** 能力 ——
   - [`error/handleError.ts:25`](../app/src/error/handleError.ts) `createLogger, LogLevel` ← `@modules/monitoring/logs/Logger.js`（infra）
   - [`error/handleError.ts:26`](../app/src/error/handleError.ts) `getOTelTracing` ← `../monitoring/otel/OTelTracing.js`（infra）
   ⇒ 把实现整体搬进 core 会**把倒挂搬家**（core → monitoring），净收益 0。**必须先去掉这两个 infra 依赖**。

---

## §2 目标与非目标

### 2.1 目标
- **G1**：把 `error` 模块的 `handleError` 家族（`handleError` / `HandleErrorOptions` / `resolveErrorLogLevel` / `getErrorStats`）**变为零 infra 依赖**，下沉 `core`。
- **G2**：**27 对 `core -> infra`**（目标模块 `error`）全部清零；`已豁免` 应为 **417 → 390**。
- **G3**：**对外 API 逐字不变**（`@modules/error` 与 `@modules/error/handleError` 的导出名/签名/行为不变）。
- **G4**：**调用点语法零改动** —— 27 个消费方**只改 import 路径**，`handleError(e, opts)` 调用形态与 `await`/`void` 用法一律不动。

### 2.2 非目标
- ❌ 不造"`handleError` 注入端口"（`IErrorService` + DI 注入）：那会引入**注册前降级语义**——错误处理入口降级为 noop = **静默丢错**（比 Logger 的 noop 严重），且需改 60+ 处调用形态。**已排除**。
- ❌ 不动 `error` 模块其余内容（`ErrorCodes` / `ErrorClassifier` / `network/*` / `api/*` / `formatter` / `safeLog` 等）。
- ❌ 不顺手改他层同类项（如 `core/session/SessionSupervisor.ts` 从 `@modules/monitoring` 取 `getLogger`+`getOTelTracing` 那条对）—— 属另一目标模块 `monitoring`，另立批次。
- ❌ 不删例外条目（按 [`layer-inversion-a-class-inventory.md`](./layer-inversion-a-class-inventory.md) §5 口径：先下调计数，收口完成后另行清理）。

---

## §3 方案

### 3.1 关键决策：复用既有 SPI 基础设施（CS01），不新造抽象

`core/spi/` **已有**一条成熟的 **Logger SPI**（[`core/spi/LoggerService.ts`](../app/src/core/spi/LoggerService.ts)）：

| 既有要素 | 作用 |
|---|---|
| `ILogger` / `ILoggerService` | core 层声明的最小接口（不引用 infra 实现） |
| `LOGGER_SERVICE_ID` | SPI 服务标识 |
| `registerLoggerSpi(container)` | **组合根缝**：内部 `await import('../../monitoring/logs/Logger')` ⇒ 动态、集中、**静态零跨层依赖** |
| `resolveLogger(module)` | core 侧取值入口；**注册前返回 noop**（启动早期安全降级） |
| 调用点：`core/di/DIContainer.ts:310-319` | 容器就绪后注册 |

⇒ 本 spec **只补一条同构的 OTel SPI**，并**复用 `resolveLogger`**，不发明新范式。

### 3.2 新增：`core/spi/OTelService.ts`（与 LoggerService 同构）

- `interface IOTelTracing`：`getActiveSpan(): Span | undefined` · `recordError(span: Span, error: Error): void`（`Span` 为 **OTel 官方类型**）。
- `interface IOTelService`：`getTracing(): IOTelTracing`。
- `const OTEL_SERVICE_ID = 'core.spi.IOTelService'`。
- `resolveOTelTracing(): IOTelTracing` — 注册前返回 **noop tracing**（`getActiveSpan()` 恒 `undefined`）。
  - **降级是良性的**：`handleError` 的 OTel 段本就 `try/catch` 且注释「OTel 不可用时不中断主流程」⇒ noop 等价于"未启用 OTel"，**不丢错**（日志/统计/事件发布全部与 OTel 无关）。
- `registerOTelSpi(container)` — `await import('../../monitoring/otel/OTelTracing')` 后注册为 singleton。

> **🔴 实现期更正（原设计被实测证伪）**：初版设计了自造的结构接口 `ISpanLike`（`addEvent(name, attributes?: Record<string, unknown>)`），意图"core 不依赖 infra 类型"。**实测 `TS2322`**：官方 `Span.addEvent` 是**函数属性**（非方法语法）⇒ 受 `strictFunctionTypes` **逆变**校验，宽的 `Record<string, unknown>` 参数使上层 `OTelTracing` **无法结构化满足**。
> ⇒ 改为**直接复用 OTel 官方 `Span` 类型**（**外部库**，非项目分层；core 侧既有先例：`core/events/EventBusOTelBridge.ts` 即从 `@opentelemetry/api` 取 `Span`）—— 签名完全一致 ⇒ 无需任何 `as` 断言（未引入 `any`/断言）。

### 3.3 新增：`core/errorHandler.ts`（实现下沉，零 infra 依赖）

从 `error/handleError.ts` **原样搬迁**（逻辑逐字不变）以下导出：`HandleErrorOptions` · `resolveErrorLogLevel` · `handleError` · `getErrorStats`（`recordError` 及内部状态仍为文件私有）。

**依赖改写（唯一必要的三处）**：

| 原依赖 | 改为 | 说明 |
|---|---|---|
| `createLogger({ level, module })`（infra） | `resolveLogger(module)`（core SPI） | `createLogger` 的 `level` 仅作**过滤阈值**；WARN/ERROR 档位**始终输出**（`project_rules` §1.8）⇒ 显式调用 `.warn()` / `.error()` 行为等价 |
| `getOTelTracing()`（infra） | `resolveOTelTracing()`（core SPI，§3.2） | 同上 |
| `import('../core/events/EventBus.js')`（动态） | 不变 | 已是 core，且为动态导入（门禁不可见亦不构成隐患：core → core） |

其余依赖（`./errors.js` 的 `AppError` 家族、`./abortReason.js` 的 `isAbortReason`）**已在 core**（D-61/D-63）。

**落点**：core **模块根** `app/src/core/errorHandler.ts`（与 `core/errors.ts` / `core/abortReason.ts` / `core/errorCodes.ts` 同级）—— **不得**放 `core/utils/**`（R03-002「模块出口单一」，D-62 实测）。

**`error/handleError.ts` 改为纯转出**（对外 API 逐字不变）：

```ts
export { handleError, resolveErrorLogLevel, getErrorStats } from '../core/errorHandler.js';
export type { HandleErrorOptions } from '../core/errorHandler.js';
```

> `error/index.ts:91-92` 与 `infrastructure/http/handlers/error-report-handlers.ts`（经相对路径取 `getErrorStats`）**无需改动**，经转出链照常工作。

### 3.4 注册缝：`core/di/DIContainer.ts`

在既有 Logger SPI 注册块（`:310-319`）**紧随其后**加同构的一块：

```ts
try {
  const { registerOTelSpi } = await import('../spi/OTelService');
  await registerOTelSpi(this);
} catch (otelSpiError) { logger.warn('OTel SPI 注册失败（非致命，使用 noop 回退）', { ... }); }
```

### 3.5 消费方改直连（27 文件，**仅改 import 行**）

| 源 | 新 import |
|---|---|
| `app/src/core/**` 下 21 个 | 相对路径 `./errorHandler.js` / `../errorHandler.js` / `../../errorHandler.js`（随深度） |
| `core/external/sqlite3.ts` · `core/loop/PlanDrivenLoop.ts` | 同上（由 `@modules/error/handleError(.js)` 改为相对 core 根） |
| `app/src/modules/doc/**` 下 4 个 | 相对 `../../../core/errorHandler.js`（模块根相对引用，D-62 已验证 `parts.length < 3` 不触发 R03-002） |

> **禁止**在沿革注释里照抄 import 语句（D-59 实测：门禁正则也匹配注释里的 `from '…'`）。

### 3.6 测试守卫同步（1 文件）

[`app/tests/error/errorLogLevel.test.ts:129-133`](../app/tests/error/errorLogLevel.test.ts) 是**文本级守卫**：读 `src/error/handleError.ts` 并断言含 `resolveErrorLogLevel(`。实现搬迁后该断言会红 ⇒ **把读取路径改为 `src/core/errorHandler.ts`**（守卫意图不变：防"映射被内联回写、`resolveErrorLogLevel` 沦为死代码"）。
- 其余用例（映射表 / 逐码一致 / 反向下调 / 全表穷尽）**不动** —— 它们经 `error/handleError` 转出取符号，仍成立。

---

## §4 风险与对策

| # | 风险 | 对策 / 证据 |
|---|---|---|
| R1 | **日志级别语义漂移**（`createLogger({level})` → `resolveLogger(module)`） | `createLogger.level` 只是**过滤阈值**，而 WARN/ERROR **始终输出**（`project_rules` §1.8）⇒ 显式 `.warn()`/`.error()` 等价；`resolveErrorLogLevel`（映射单一事实源）**原样保留**并有 5 条单测守护 |
| R2 | **注册前 OTel 不可用** | noop 回退 = "未启用 OTel"，**不丢错**；且 `handleError` 的 OTel 段本就 best-effort（`try/catch` 注释明示） |
| R3 | **R03-002「模块出口单一」**（新文件落点） | 落 **core 模块根**（非 `core/utils/**`）；跨模块按**模块根相对**引用 —— D-62 已实测该形态不触发 |
| R4 | **门禁漏算**（只改 `import` 会漏 `export … from`） | 本批全部为 `import` 形态，无 barrel 再导出参与；且以 `已豁免` **总数变化**为终判（预期 −27） |
| R5 | **测试文本守卫失效** | 见 §3.6，同批修改 |
| R6 | **循环依赖**（core ↔ error） | 方向为单向 **error → core**（转出），core **零**回指 error；`error/index.ts` 现有 `../core/errorCodes.js` 转出即同向先例 |
| R7 | `getErrorStats` 统计状态随实现搬迁 | 状态（`trackedErrors`/`errorStats`）为模块级私有，**随文件整体搬迁**；同一模块内取用者（HTTP handler）经转出链访问**同一份**状态，无副本 |

---

## §5 验收（实测口径）

| 项 | 命令 | 预期 |
|---|---|---|
| 类型 | `cd app; bun run typecheck` | exit 0 |
| 分层门禁 | `cd app; bun run lint:arch` | **违规 0** · 错误 0 · 警告 1（仅既有 `R07-004 REF`） · **`已豁免` 417 → 390（−27）** |
| 全量测试 | `cd app; bun test` | 与基线一致（**4251 pass / 21 skip / 0 fail**） |
| 行为等价 | 读取 `core/errorHandler.ts` | 逻辑与 `error/handleError.ts` 搬迁前逐字一致（仅依赖改写 3 处） |
| 对外 API | `@modules/error` / `error/handleError` | 导出名/签名不变（转出） |
| 例外计数 | `scripts/layer-exceptions.json` | `BULK-010`(`core -> infra`) 按实测下调并在 rationale 记因 |

**回退方案**：本批为**纯搬迁 + import 路径改写**，无行为变更；若门禁/测试意外变红，逐文件回退 import 行即可（`error/handleError.ts` 的转出可临时改回原位实现）。

---

## §6 未覆盖 / 遗留

| # | 遗留 | 说明 |
|---|---|---|
| L1 | `core → monitoring` 同类对未动 | 如 `core/session/SessionSupervisor.ts`（`getLogger`+`getOTelTracing`）、`core/events/OrchestrationMetrics.ts`（`OTelMetrics`）⇒ 目标模块是 `monitoring`，**另立批次**；本批新建的 OTel SPI 为其提供现成落点 |
| L2 | `error` 模块其余对未动 | `error/utils`、`error/api`、`error/formatter` 等仍有 core 侧取用（同 `canonicalEntryKeys` 白名单），未纳入本批 |
| L3 | `IActualErrorService` 未落地 | 本 spec 采用"去依赖 + 下沉"而非"注入端口"（§2.2 已说明理由）；若未来需要"错误处理可插拔"（如测试替身），再另立 spec |
| L4 | ~~`Span` 形态抽象粒度~~ ✅ **已定** | 采用 **OTel 官方 `Span`**（外部库类型）；自造结构接口因 `strictFunctionTypes` 逆变校验**不可行**（§3.2 实测 `TS2322`） |
| L5 | **`BULK-010` 估值严重失真（已校正）** | 探针实测 `core -> infra` 真值 **120 对**，而 `estimatedCount` 记 **20** ⇒ **低估约 6×**（同 D-58 对同一桶的发现）。已按实测校正并在 rationale 记因；**其余 bulk 桶的估值同样未经实测**，建议后续逐桶探针重估（另立议题） |

---

## §7 合规清单

| 规则 | 落实 |
|---|---|
| **GR01** 基础设施复用 | ✅ 复用既有 `core/spi/` SPI 范式与 `resolveLogger`；**不新造** DI/事件/端口框架；新文件仅补同构的 OTel SPI |
| **CS01** 归一化 | ✅ 新增前已检索：`core/spi/{LoggerService,ErrorTypes,CacheService}` 既有先例；`registerLoggerSpi`/`resolveLogger` 直接复用，未另起炉灶 |
| **CS02** 禁字符串匹配做状态判断 | ✅ 本批不引入任何字符串判据 |
| **CS03** 回退策略最小化 | ✅ 仅 1 处必要回退（OTel noop，且**不掩盖错误**：日志/统计/事件不受影响）；未加"以防万一"兜底 |
| **CS04** Mock 零容忍 | ✅ noop tracing 是**接口降级实现**（logger SPI 既有同型），非 Mock 数据 |
| **CS06** 证据驱动 | ✅ 27 消费方逐文件 grep 得出（含 `@modules/error/handleError` 子路径 2 个，避免漏算）；`已豁免` 以门禁总数变化为终判 |
| **R02** 数据模型统一 | ✅ `AppError` 家族 + `handleError` 家族集中于 core；`error` 侧仅转出，无双定义 |
| **R06-008** 分层 | ✅ 方向 `error`(infra) → `core`，合法；`core/spi/OTelService.ts` 对 infra 的引用只存在于**注册缝**（动态 import，与 `LoggerService` 同型） |
| **R03-002** 模块出口单一 | ✅ 落点在 core **模块根**（D-62 实测形态），且新文件非子目录出口 |
| **R07-001** 微小文件 | ✅ 新增/改写文件均 > 10 行（`error/handleError.ts` 转出体 ≥ 10 行） |
| **R11-001** Logger 门面 | ✅ 新代码用 `resolveLogger()`（SPI 取值），**不** `new Logger(...)` |
| `project_rules` §1.9 错误处理唯一入口 | ✅ `handleError` 仍是唯一入口（对外 API 与实现语义不变），未新增第二套错误处理路径 |
| `project_rules` §1.3 向后兼容 | ✅ 无正式用户 ⇒ 直接搬迁；但因 `error` 是对外「唯一入口」，仍**保留转出**以维持模块契约 |
| PY_APP §2/§3 | ✅ 无投机性扩展（不建 barrel、不做无关重构）；改动逐行可追溯到"清零 27 对倒挂" |

---

## §8 任务状态

| # | 任务 | 状态 |
|:--:|---|:---:|
| 1 | 取证：27 个消费方 + 依赖改写点 + 复用既有 SPI | ✅ 完成（§1/§3.1） |
| 2 | 本 spec | ✅ 完成 |
| 3 | 新增 `core/spi/OTelService.ts` 并导出（`core/spi/index.ts` + `core/index.ts`） | ✅ 完成（初版 `ISpanLike` 被 `TS2322` 证伪 ⇒ 改用官方 `Span`，见 §3.2） |
| 4 | 新增 `core/errorHandler.ts`（零 infra 依赖） | ✅ 完成（逻辑逐字搬迁，仅依赖改写 3 处） |
| 5 | `error/handleError.ts` 改纯转出 | ✅ 完成 |
| 6 | `core/di/DIContainer.ts` 注册 OTel SPI + 改 import | ✅ 完成 |
| 7 | 27 个消费方改直连 core | ✅ 完成（core 21 + 子路径 2 + modules 4；grep 复核 core/modules 对 `error` **归零**） |
| 8 | `errorLogLevel.test.ts` 文本守卫指向新位置 | ✅ 完成 |
| 9 | 验收（§5 五项）+ 例外计数下调 | ✅ 完成（见下） |
| 10 | 台账 D-69 回写 | ✅ 完成 |

**实测结果**：`typecheck` **0** · `lint:arch` **违规 0 / 错误 0 / 警告 1**（仅既有 `REF`）· **`已豁免` 417 → 390（−27，与预测逐数吻合）** · 扫描文件 3962 → 3964（+2 新文件）· 全量 `bun test` **4251 pass / 21 skip / 0 fail**。
**附带实测**：探针测出 `BULK-010` 真值 **120**（旧记 20，低估 6×）⇒ 已校正（§6 L5）。
