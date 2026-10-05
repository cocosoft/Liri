# 通道进程隔离（Worker 化 + 守护自愈）—— 立项与可行性核查

> **状态**：🔄 **重新立项评估（2026-10-05，用户裁定）** —— ⚠️ 原「不实施」的**前置前提已被推翻**：原依据为 2026-09-29「**通道运行期历史 = 0 条**」，但 2026-10-05 本机实测 `~/.pyapp/data/logs/app.log` **含 QQ 通道完整运行链路**（见 §0.1）⇒ 收益**已有数据可依**，原裁定须重评。（原裁定**不实施**的前提不再成立；"守护自愈"这半**确已具备** —— `ChannelRealtimeMonitor` 是活的，见 §3。）
> **来源**：[`liri-upgrade-plan-20260928.md`](./liri-upgrade-plan-20260928.md) §2.E **E1** / §2.G **G1** / §3 **P2-2**（含 v2 增补：守护自愈重启 + IPC 选型）
> **关联规则**：GR01（基础设施复用）/ GR02（实现唯一性）/ GR03（证据驱动）/ CS01（新增前先查已有）/ CS03（回退最小化）/ CS05（根因优先）/ `project_rules.md §1.14`（通道系统规范）
> **最后更新**：2026-10-05

---

## 0. 前置被推翻（2026-10-05）

原裁定「不实施」的唯一依据 =「通道运行期历史 = 0 条（本机未启用任何通道）⇒ 收益无数据可证」。**该前提已不成立**：

| 证据（本机 `c:\Users\csdnc\.pyapp\data\logs\app.log`，2026-10-04 轮换） | 摘录 |
|---|---|
| `channels:base`（`:24-31`） | `QQ Bot WebSocket 连接关闭`（`code:4009` / `reason:"Session timed out"`）·「QQ Bot 会话异常 (4009)，清理后重连」· `sinceConnectMs:3599840` |
| `channels:monitor`（`:35-39`） | 「渠道探测不健康: qq」·「渠道状态变更: qq connected → error」·「渠道退避重连已调度: qq」（`baseMs:2000`, `maxMs:300000`）·「qq error → reconnecting」 |
| 自愈恢复（`:40-71`） | 「QQ Bot WebSocket 已连接」(`recoveryMs:2346`) →「鉴权成功」→「渠道自动重连成功且探测健康: qq」 |

⇒ **存在真实"通道抖动/长连接失效/退避重连/自愈"数据**；`ChannelFailureLogger` 已不存在（代码 0 命中，与台账 D-20 一致）；`~/.pyapp/data` 下**无** `failure-logs` 目录。

**立项待答（重评须先回答，再决定是否上马）**：
1. **故障域边界**：QQ 通道 4009 超时这类故障，同进程下是否**已污染核心**（事件循环阻塞 / 内存泄漏 / 阻塞其他通道）？—— 需以日志时间戳对齐核心侧耗时证据。
2. **隔离收益量化**：Worker 化的收益（故障不扩散 / 可独立重启 / CPU 亲和）与代价（IPC 序列化、通道状态同步、`CHANNEL_MAX_COUNT` 语义变更、调试复杂度）**能否用现有数据支撑**（CS03）。
3. **与既有自愈的关系**：`ChannelRealtimeMonitor` 的退避重连（`baseMs:2000`/`maxMs:300000`）已在起作用 ⇒ 进程隔离是否只是"第二层保险"？若是，优先级如何。
4. **IPC 选型**（v2 增补项）：与 **P2-2 / T-4（ACP 内核 IPC/信号总线）** 是否应合并评估。
5. **多通道并发**：本机目前仅 1 个通道（qq）有数据；`CHANNEL_MAX_COUNT` 默认 10 ⇒ 隔离收益是否需多通道并发数据才算充分？

> **裁定记录**：2026-10-05 用户裁定「**重新立项评估**」（原依据失效）。完整评估**未做**，待上述问题有结论后裁定上马/搁置。

## 1. 现状取证（先立事实）

| 事实 | 证据 |
|---|---|
| **26 个通道全部与核心同进程** | `app/src/channels/` 下 26 个通道目录（`qq` / `feishu` / `dingtalk` / `discord` / `slack` / `telegram` / `wechat` / `wecom` / `email` / `sms` / `signal` / `irc` / `matrix` / `mattermost` / `msteams` / `line` / `zalo` / `nostr` / `twitter` / `webhook` / `yuanbao` / `googlechat` / `facebookmessenger` / `bluebubbles` / `claude` / `webhook`…） |
| **注册唯一入口 = `ChannelBootstrapper.bootstrap()`** | [`channels/bootstrap/ChannelBootstrapper.ts:86-134`](../../app/src/channels/bootstrap/ChannelBootstrapper.ts#L86-L134)：遍历配置 → `factory()` 得插件 → [`channelRegistry.register(plugin)`](../../app/src/channels/bootstrap/ChannelBootstrapper.ts#L104)；`ChannelRegistry` 已原生支持 `IChannelPlugin` |
| **入站单管线 = `routeChannelMessage()`** | 定义 [`channels/routing/messageRouter.ts:278`](../../app/src/channels/routing/messageRouter.ts#L278)；调用点 3 处 —— [`bridge/ChannelBridgeAdapter.ts:198`](../../app/src/channels/bridge/ChannelBridgeAdapter.ts#L198)、[`setupChannels.ts:495`](../../app/src/channels/setupChannels.ts#L495)、[`infrastructure/http/handlers/channel-handlers.ts:718`](../../app/src/infrastructure/http/handlers/channel-handlers.ts#L718) |
| **`ChannelRegistry` 直接持有进程内资源** | 其 import 面含 `Database`（`@modules/core/external/sqlite3`）、`resolveDbPath`（`@modules/core`）、`channelEventBus`（`../events/ChannelEventBus`）、`dependencyRegistry`（`@modules/context`）—— 见 [`registry/ChannelRegistry.ts:14-21`](../../app/src/channels/registry/ChannelRegistry.ts#L14-L21) |
| **进程隔离能力：目录内无任何 Worker 化** | `app/src/channels/` 全仓 grep `Bun.spawn` / `Worker` / `process.fork` ⇒ **零命中**（2026-09-29 实测） |
| **架构规则现状基线** | `project_rules.md §1.14` 明写"**唯一真相源**：`src/channels/` 为实现层"，且 `CHANNEL_MAX_COUNT` 默认 **10**（同进程配额），未涉进程模型 |

---

## 2. 为什么这是"重活"——耦合点清单（决定可行性）

把通道搬进 Worker 后，下列**进程内句柄**必须先解决"跨进程可获得性"，否则搬不动（每条都附证据）：

| # | 耦合点 | 证据 | 跨进程难点 |
|---|---|---|---|
| 1 | **事件总线** `channelEventBus` | `ChannelRegistry.ts:18`；`channels/events/ChannelEventBus.ts` | 独立实例 + 选择性桥接 `globalEventBus`（§1.14）；跨进程需重做桥接（IPC 转发而非直接调用） |
| 2 | **会话/持久化** | `ChannelRegistry` 直连 SQLite（`Database` + `resolveDbPath`，`ChannelRegistry.ts:15-16`）；`channels/session/ChannelSessionManager.ts` | SQLite 单文件多进程写（WAL 已开，但仍需评估锁竞争；且**通道侧不应各自持库**） |
| 3 | **LLM 调用链** | `routeChannelMessage()` 内部收敛到 `CoreAPI.chat()`（§1.14 管线第 ⑤ 步） | `CoreAPI` 是主进程单例（`runtime/api/CoreAPI.ts`）⇒ Worker 必须走 IPC 回主进程，**不能各自建 CoreAPI** |
| 4 | **工具与技能面** | `getToolRegistry()` 全局单例（`tools/ToolRegistry.ts`）；§1.16 工具注册表单一 | Worker 侧工具执行需回主进程或复制注册表（后者会破坏"写入口单一"） |
| 5 | **去重/限流/追踪** | `channels/dedup/index.ts`、`routing/rateLimiter.ts`、`monitoring/MessageTraceBuffer.ts` | 目前是**进程内共享状态**；进程化后需改为共享存储或 IPC 汇总，否则去重/限流失效（**安全回归**） |
| 6 | **设备配对 / 策略** | `channels/DevicePairingService.ts`、`policy/PairingStore.ts`、`policy/DmPolicy.ts` | 同 #5，属共享状态 |
| 7 | **`channelRegistry` 双注册守卫** | `ChannelRegistry.register()` 内置双重注册守卫（§1.14） | 谓词在单进程内有效；跨进程需重新定义"注册"的边界 |

⇒ **结论（GR03）**：这不是"把 26 个类塞进 Worker"的机械改造，而是**通道运行模型**的变更（进程内共享状态 → 跨进程契约）。

---

## 3. 可复用基座核查（GR01：先查已有，别造第二套）

**⚠️ 2026-09-29 更新：下表三条候选里，`WorkerSandbox` 与 `PluginHealthMonitor` 已随「沙箱实例层」删除（台账 D-25）；`ChannelRealtimeMonitor` 仍是活的（那才是与本议题相关的自愈实现）。下表保留原文以存历史判断过程。**

| 候选 | 位置 | 实测结论 |
|---|---|---|
| `WorkerSandbox`（Worker Threads 沙箱） | [`sandbox/WorkerSandbox.ts:68`](../../app/src/sandbox/WorkerSandbox.ts#L68) | ① **零消费者**（全仓仅 `sandbox/index.ts:68-69` 桶导出，无 `new WorkerSandbox()`）；② **语义不符** —— 它是**命令执行器**（`execute({args}) → {exitCode, stdout, stderr}`），**已在 [`workflow-bounded-cancel.md:9`](./workflow-bounded-cancel.md) 裁定**"本仓工作流步骤是**进程内工具调用**（依赖 DB/MCP/会话句柄，无法序列化进 worker）"⇒ **同一理由适用于通道**（见 §2 耦合点） |
| `PluginHealthMonitor`（心跳 + 崩溃恢复） | [`sandbox/PluginHealthMonitor.ts:97`](../../app/src/sandbox/PluginHealthMonitor.ts#L97) | **零消费者**（全仓仅 `sandbox/index.ts:83` 桶导出）⇒ 属"未接线的死实现"（同族：台账 **D-15/D-16**） |
| **`ChannelRealtimeMonitor`（探测 + 五态机 + 退避自愈）** | [`channels/monitoring/ChannelRealtimeMonitor.ts:113`](../../app/src/channels/monitoring/ChannelRealtimeMonitor.ts#L113) | ✅ **已接线、确为活的**（消费者：[`setupChannels.ts:661`](../../app/src/channels/setupChannels.ts#L661) / [`main.ts:880`](../../app/src/main.ts#L880) / [`channel-handlers.ts:957`](../../app/src/infrastructure/http/handlers/channel-handlers.ts#L957)）。能力实测（附行）：**5s 探测循环**（`probeIntervalMs:5000`）+ **五态机**（`disconnected/connecting/connected/reconnecting/error`）+ **退避自愈 2s→300s**（`reconnectBaseMs`/`reconnectMaxMs`）+ `forceReconnect()` → `scheduleReconnect()` + `recovered` 事件 + 错误快照（≤2000 字符）+ 自愈边界"**只拉起连接成功过的渠道**" ⇒ **E1/G1 要求的"守护自愈重启"，在进程内已经具备** |

⇒ **更正后的结论（2026-09-29）**：进程隔离（Worker 化）**没有现成基座**（`WorkerSandbox` / `PluginHealthMonitor` 两条候选都未接线，且前者已被裁定为"命令执行器、不适用"）；但 G1 的"**守护自愈重启**"这半 **已有现成且已接线的实现**（`ChannelRealtimeMonitor`）⇒ **该要求不构成缺口**，原 spec 把它当作"待新建能力"是**不准确的**。

---

## 4. 前置条件（2026-09-29 取证后：**量化结论 = 0 条 ⇒ 无开工依据**）

`liri-upgrade-plan-20260928.md` §3 P2-2 自己写明的前置是「**需先量化通道抖动/崩溃历史与耦合点**」。现状：

| 前置 | 状态 | 说明 |
|---|:--:|---|
| **通道崩溃/抖动历史量化** | ✅ **已做（2026-09-29）—— 结论：0 条** | ① `app.log`（`~/.pyapp/data/logs/app.log`，**6.6 MB / 覆盖 2026-09-28~09-29**）中 `"module":"channels:*"` **零命中**（只有 15 组 `modules:moduleInitializer` 的"初始化模块: channels"行）；② `~/.pyapp/data/failure-logs/` **目录不存在** ⇒ `ChannelFailureLogger` **从未写入**（该模块**零消费者**，另立台账 **D-17**；**已于 2026-09-29 删除**，见 **D-20**）；③ 原因：`setupChannels.ts` 的 `enabled` **全部取决于环境变量 token**（`TELEGRAM_BOT_TOKEN` / `DISCORD_TOKEN` / `SMS_FROM_NUMBER` / `WEBHOOK_LISTEN_PORT` …），本机**一个都没设** ⇒ 通道运行期**从未真正开始**。⇒ **无任何可量化数据** |
| **耦合点清单** | ✅ **已做**（§2 七条） | 但**尚需**逐条定"IPC 契约 or 共享存储" |
| **IPC 选型** | ⏸ **不再推进**（随 §5 裁定 D 搁置） | 候选：本地端口 / Unix socket；若 A/B 将来复活，须与 §1.14"通道→Master 仍走 `routeChannelMessage()` 语义"兼容 |
| **收益证据** | ✅ **已得结论：不成立**（2026-09-29） | 与 CS03「不为理论可能性加机制」一致：**既无"因通道崩溃拖垮核心"的实测事件，也无任何通道运行数据**（见本表首行） |

> **⚠️ 诚实结论**：在**无崩溃/抖动实测数据**的前提下开工，等于**为理论可能性做架构级改造**（26 通道 × 7 类耦合点），与 `PY_APP.md §2 简洁优先`、CS03、`liri-upgrade-plan-20260928.md §3` 的"不臆造"一致 ⇒ **应先把 §4 第一行补齐**。

---

## 5. 候选形态（待前置满足后再裁）

| 形态 | 内容 | 成本 | 风险 |
|---|---|---|---|
| **A 全量 Worker 化** | 26 通道各一 Worker + IPC 回主进程（`CoreAPI` / 工具 / 会话经 IPC） | **最大** | 高（重写事件桥接、去重、限流、持久化边界） |
| **B 仅"外部接入型"通道 Worker 化** | 仅把**长连接/易抖**的通道（如 QQ / Feishu WebSocket 类）移出，其余留进程内 | 中 | 中（两套模型并存 ⇒ 需显式边界声明，防"双轨"） |
| **C 只做"守护自愈"** | 不进程化，仅在**进程内**补"通道级熔断 + 自动重启"（复用/接线 `PluginHealthMonitor` 设计） | **最小** | 低；**收益最直接**（先解决"崩了不恢复"） |
| **D 暂缓** | 记录取证，等通道崩溃数据 | 零 | 零 |

- **裁定（2026-09-29，前置取证后）**：**D 搁置**。三条理由：① **C 已在位** —— `ChannelRealtimeMonitor` 已实现且已接线（§3），无需再做；② **A/B 无依据** —— §4 已证"通道运行期历史 = 0 条"，收益**无数据可证**，按 CS03 / `PY_APP.md §2` **不得开工**；③ 建议把本项转为**"待真实通道运行数据"的观察项** —— 届时的量化口径直接用 `ChannelRealtimeMonitor.getStatusAll()` 的 `reconnectCount` / `lastError` / `lastErrorSnapshot`（本 spec 编号保留，不删除）。

---

## 6. 合规检查表

| 规则 | 落实 |
|---|---|
| GR01（基础设施复用） | §3 已核两条候选（`WorkerSandbox` / `PluginHealthMonitor`）⇒ **结论是"都不可直接用/未接线"**，故本 spec **不承诺**复用既有基座 |
| GR02（实现唯一性） | 若选 B（部分 Worker 化），**必须**显式划"谁进程内/谁进程外"的边界，防两套模型并存成双轨 |
| GR03（证据驱动） | §1 / §2 / §3 每条附 `文件:行`；§4 明写"收益证据未做"⇒ **不据此开工** |
| CS01（新增前先查已有） | §3 即该检查；**未**新造第二套隔离框架 |
| CS03（回退最小化） | 形态 C 优先（不引入 IPC 回退面）；**不**为"理论崩溃"加机制 |
| CS05（根因优先） | 根因待定：**是"进程隔离不足"还是"缺自愈"** —— §4 的量化正是为分清这一点（形态 C 押注后者） |
| §1.14（通道规范） | 保持注册唯一入口 / 单管线 / 事件总线分层三条不变；本 spec **不破**这些契约 |

---

## 7. 不在范围 / 未验（如实）

- ❌ **不改** `routeChannelMessage()` 的管线语义（§1.14 第 ①–⑥ 步）。
- ❌ **不引入** ACP/gRPC 等跨机传输（`liri-upgrade-plan-20260928.md` §3 已判 E6 ➖）。
- ❌ **不删除** `WorkerSandbox` / `PluginHealthMonitor`（它们属 D-15/D-16 同族"未接线死实现"，**删除与否另案裁定**）。
- ⚠️ **未验**：① 通道崩溃/抖动**历史数据**（§4 第一行）；② 26 个通道各自的**长连接/短连接**分布（决定形态 B 的候选集）；③ `CHANNEL_MAX_COUNT`（默认 10）与"26 个通道目录"的关系（是否仅 10 个可同时启用）——**本轮未查**。
