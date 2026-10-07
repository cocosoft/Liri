# Spec：A2A JSON-RPC 标准绑定（T4）

> 版本 1.0 ｜ 创建 2026-10-07 ｜ 状态：🟡 **实施中** —— 用户裁定「**全量 T4**」（11 操作 + SSE + 扩展卡 + v1.0 卡片形状）
> 来源：`.trae/specs/a2a-v1-naming-alignment.md` **§4-D2 = (b) 本批不做 ⇒ T4 待裁定** / **§5-T4**（JSON-RPC 分发（11 操作）/ SSE / 扩展卡 / 能力协商）
> 上游：`.trae/specs/a2a-external-exposure.md`（对外面主 spec）· `.trae/specs/a2a-capability-negotiation.md`（**R11-3 D3 撤销 JSONRPC 声明** —— 本 spec 完成后可**如实重声明**）
> 关联规则：GR15（**API 变更必立 spec**）/ GR01（复用）/ CS01 / CS03 / CS06（证据驱动）/ R06-008（分层）
> 规范来源（2026-10-07 拉取）：官方 spec <https://a2a-protocol.org/latest/specification/>（**1.0.0**）· 规范数据源 `specification/a2a.proto`（`package lf.a2a.v1`）

---

## 1. 背景与授权

- **现状**：本仓 A2A 面**已接线但非标准绑定** —— 对外只有**自定义 REST**（`POST/GET /v1/a2a/tasks[...]` + `/v1/a2a/health`），协议**类型层已就绪**（JSON-RPC 2.0 报文类型 / 错误码表 / 方法名 + v0.3 别名 / Task 状态机 / `taskStore.cancel` 语义），**缺的是 dispatcher**。
- **问题**：声明「JSON-RPC」会失败（R11-3 D3 因此**撤销**了该声明）⇒ 本仓 A2A 面**不满足 A2A 的互操作目的**。
- **授权**：用户 2026-10-07 裁定 **全量 T4**（明确接受"工程量较大 + 无对端可联调 ⇒ 仅单元级验证"）。

## 2. 权威规范要点（本 spec 的落地依据，逐条附来源）

**2.1 11 个操作 / JSON-RPC 方法名**（spec §3.1.1–3.1.11 + §5.3 方法映射表 + proto `service A2AService`）

| # | 操作 | JSON-RPC `method` | 请求参数对象 | 响应 |
|:-:|---|---|---|---|
| 1 | Send Message | `SendMessage` | `SendMessageRequest` | `SendMessageResponse`（oneof `task` \| `message`） |
| 2 | Send Streaming Message | `SendStreamingMessage` | `SendMessageRequest` | `stream StreamResponse` |
| 3 | Get Task | `GetTask` | `GetTaskRequest` | `Task` |
| 4 | List Tasks | `ListTasks` | `ListTasksRequest` | `ListTasksResponse` |
| 5 | Cancel Task | `CancelTask` | `CancelTaskRequest` | `Task` |
| 6 | Subscribe to Task | `SubscribeToTask` | `SubscribeToTaskRequest` | `stream StreamResponse` |
| 7 | Create Push Notification Config | `CreateTaskPushNotificationConfig` | `TaskPushNotificationConfig` | `TaskPushNotificationConfig` |
| 8 | Get Push Notification Config | `GetTaskPushNotificationConfig` | `GetTaskPushNotificationConfigRequest` | `TaskPushNotificationConfig` |
| 9 | List Push Notification Configs | `ListTaskPushNotificationConfigs` | `ListTaskPushNotificationConfigsRequest` | `ListTaskPushNotificationConfigsResponse` |
| 10 | Delete Push Notification Config | `DeleteTaskPushNotificationConfig` | `DeleteTaskPushNotificationConfigRequest` | `Empty` |
| 11 | Get Extended Agent Card | `GetExtendedAgentCard` | `GetExtendedAgentCardRequest` | `AgentCard` |

**2.2 关键语义（照录，逐条来源见上表节号）**
- **`historyLength`**：未设置 ⇒ 服务端默认量；`0` ⇒ 不返回历史（`history` SHOULD 省略）；`>0` ⇒ 最多最近 N 条。
- **`ListTasks`**：`pageSize` 未指定 ⇒ **最多 50**（min 1 / max 100）；**cursor 分页**（`pageToken`/`nextPageToken`，无更多结果时 `nextPageToken` **必须为空串**）；MUST 按 status timestamp **降序**；`includeArtifacts=false` ⇒ `artifacts` **整体省略**。响应 4 字段 `tasks`/`nextPageToken`/`pageSize`/`totalSize` **均 REQUIRED**。
- **`SendMessageConfiguration.returnImmediately`**（默认 `false`）⇒ 阻塞至终态/中断态。
- **流事件联合**（v1.0 **移除 `kind`**，改由 **JSON 成员名判别**）：`{ task }` \| `{ message }` \| `{ statusUpdate: TaskStatusUpdateEvent }` \| `{ artifactUpdate: TaskArtifactUpdateEvent }`；两事件对象**无 `final` 字段**。
- **SSE**：`Content-Type: text/event-stream`；每条 `data:` = 一个 **JSON-RPC 响应对象**（`{"jsonrpc":"2.0","id":N,"result":{…StreamResponse…}}`）；任务型流以 `Task` 开始，**终态即关闭**；`SubscribeToTask` 首事件 MUST 为 `Task`，且对**终态任务**订阅 ⇒ `UnsupportedOperationError`。
- **扩展**：`AgentExtension { uri, description?, required?, params? }` 位于 **`capabilities.extensions`**；客户端经 **`A2A-Extensions`** 头（逗号分隔 URI）选入；`required:true` 且服务端不支持 ⇒ MUST 报错。
- **服务参数头**：`A2A-Version`（`Major.Minor`；客户端 MUST 每请求发送，空值按 0.3 处理）· `A2A-Extensions`。
- **卡片 v1.0**：`supportedInterfaces`（`AgentInterface[]`，含 `url` + `protocolBinding` + `protocolVersion` + `tenant?`）为 **REQUIRED**（proto）/ SHOULD（spec §8.3.1，**两处强度不一致，如实并列**）；**顶层 `protocolVersion` 已移除**；`capabilities` = `{ streaming?, pushNotifications?, extensions?, extendedAgentCard? }`。
- **错误码映射**（spec §5.4）：`TaskNotFoundError -32001` · `TaskNotCancelableError -32002` · `PushNotificationNotSupportedError -32003` · `UnsupportedOperationError -32004` · `ContentTypeNotSupportedError -32005` · `InvalidAgentResponseError -32006` · `ExtendedAgentCardNotConfiguredError -32007` · `ExtensionSupportRequiredError -32008` · `VersionNotSupportedError -32009`（+ JSON-RPC 标准 `-32700/-32600/-32601/-32602/-32603`）。
- **能力门控（spec §3.3.4）**：未声明 push ⇒ push 配置类操作 MUST 返回 `-32003`；未声明 streaming ⇒ 两个流操作 MUST 返回 `-32004`；未声明 `extendedAgentCard` ⇒ 该操作 MUST 返回 `-32004`。

## 3. 本项目**落地子集**与能力门控（**如实边界，不虚报**）

| 项 | 本仓落地 | 依据 |
|---|---|---|
| **支持（6）** | `SendMessage` · `SendStreamingMessage` · `GetTask` · `ListTasks` · `CancelTask` · `SubscribeToTask` | 有真实实现面（`A2APort` + `taskStore` + 现有委派后端 + 状态广播） |
| **不支持（如实报错，5）** | 4 个 push-config 操作 ⇒ **`-32003 PushNotificationNotSupportedError`**；`GetExtendedAgentCard` ⇒ **`-32004 UnsupportedOperationError`** | `capabilities.pushNotifications=false` / `extendedAgentCard` 不做（spec §3.3.4 要求**能力未声明即报错**） |
| **版本** | `A2A-Version` 仅接受 `1.0`；缺失 ⇒ 按 `0.3` 处理（spec §3.6.1）⇒ 报 `-32009`（`0.3` 只保留**方法名别名**兼容） | 本仓方法名已按 v1.0 PascalCase |
| **扩展** | 声明 **0 个**扩展（不设置 `capabilities.extensions`）；**不做**扩展协商（无扩展实现，如实登记） | CS03 |
| **`stateTransitionHistory`** | 保持 `false`（只返回当前态） | R11-3 D1 已如实声明 |
| **`streaming`** | **`true`**（T4 批次 C：SSE 已实现） | `agentCard.ts` 如实声明 |

> ⚠️ **与"全量 T4"的差异（如实）**：用户裁定"全量"，但规范§3.3.4 要求**能力未声明即必须报错** ⇒ 4 个 push 操作与 extended card **只能如实报错**（除非实现推送投递与扩展卡视图）。本 spec 按"**11 个方法全部可被调用**、其中 4+1 个按能力门控**如实返回标准错误**"落地 —— 这是**规范要求**的行为，不是省略。

## 4. 分批计划

| 批次 | 内容 | 状态 |
|---|---|---|
| **A** | **协议类型补全**（`types/a2a.ts`）：11 方法常量 + v0.3/v0.4 别名 + 请求/响应 DTO（**落地子集**）+ 流事件联合 + `AgentExtension`/`AgentInterface` v1.0 形状 | ✅ |
| **B** | **JSON-RPC dispatcher**：`POST /v1/a2a/rpc`（单入口，同双闸）；11 方法分派 + 错误映射；`A2APort` 补 `listTasks`/`cancelTask` | ✅ |
| **C** | **SSE 流式**：`SendStreamingMessage` / `SubscribeToTask`（`text/event-stream` + 终态关流 + 订阅广播）+ `streaming` 如实翻 `true` | ✅ |
| **D** | **卡片 v1.0 形状 + 如实重声明**：`supportedInterfaces`（指向 `/v1/a2a/rpc`）、**移除顶层 `url`/`protocolVersion`**、`security`→`securityRequirements` ⇒ **关闭预存 A2A-1** | ✅ |
| **E** | api-spec 收口 + **拆 `routes/a2a-rpc.ts`**（回落 `lint:size` 计数）+ 台账 | ✅ |

## 5. 决策点（本批已定）

- **D1 入口路径**：`POST /v1/a2a/rpc`（与既有自定义 REST **并存**，不删 REST —— 后者已被 `api-spec.md` 记为对外契约，且 `A2A_ENABLED` 默认关、无兼容负担但删除不产生收益）。
- **D2 单入口 vs 多路径**：**单入口**（JSON-RPC 的规范形态就是单一端点 + `method` 分派）。
- **D3 能力门控**：**按 spec §3.3.4 如实报错**（§3 表），**不虚报**任何能力。
- **D4 流实现**：复用既有 SSE 基础设施（`infrastructure` 已有 `broadcastEvent` / SSE 响应写法），**不新造**流框架。

## 6. 影响文件（全批次）

| # | 文件 | 改动 |
|:-:|---|---|
| 1 | `app/src/types/a2a.ts` | 11 方法 + 别名 + DTO + 流事件 + 扩展/接口/卡片 v1.0 形状 + `A2A_RPC_PATH`（**A/D**） |
| 2 | `app/src/runtime/api/a2aPorts.ts` | 端口补 `listTasks` / `cancelTask` / `subscribeTask`（**B/C**） |
| 3 | `app/src/infrastructure/http/handlers/routes/a2a-routes.ts` | 卡片 v1.0 / 探针 / 自定义 REST + 委派核心（**D/E**） |
| 3b | `app/src/infrastructure/http/handlers/routes/a2a-rpc.ts` | **E 拆出**：JSON-RPC 单入口 + 非流式方法 + 共用纯函数（461 行） |
| 3c | `app/src/infrastructure/http/handlers/routes/a2a-rpc-stream.ts` | **E 第二拆**：SSE 流式（`SendStreamingMessage` / `SubscribeToTask`） |
| 4 | `app/src/agent/a2a/agentCard.ts` · `taskStore.ts` | 卡片 v1.0 形状（**D**）· 订阅/广播（**C**） |
| 5 | `app/tests/http/a2aRpc.test.ts`（新建）· `a2aRoutes.test.ts` | 帧/错误码/门控/分页/流/卡片 |
| 6 | `.trae/docs/api-spec.md` §3.8.2 | 新端点契约 + 卡片/基址口径 + **2.9.0**（**E**） |

## 7. 验收

- [x] 11 个方法**均可被调用**：支持的 6 个返回规范形状；门控的 4 个（push）+ 1 个（extended card）返回**规范错误码**。
- [x] JSON-RPC 帧正确：`{"jsonrpc":"2.0","id":…,"result"|"error"}`；非法 JSON ⇒ `-32700`；非 2.0 / 缺 method ⇒ `-32600`；未知 method ⇒ `-32601`；参数非法 ⇒ `-32602`。
- [x] `ListTasks`：默认 `pageSize` 50（夹 `[1,100]`）、`nextPageToken` 无更多时为空串、按 status timestamp 降序、`includeArtifacts` 非 true ⇒ 省略 `artifacts`。
- [x] 流：`text/event-stream`；每条 `data:` 为 JSON-RPC 响应对象；**以 `Task` 起**、任务终态即关闭；终态任务 `SubscribeToTask` ⇒ `-32004`。
- [x] 卡片：`supportedInterfaces[0]` 指向 RPC 端点且 `protocolBinding='JSONRPC'`（**真值**，非虚报）；**无**顶层 `url`/`protocolVersion`（v1.0 形状）；能力字段与实现一致（`streaming:true` / `pushNotifications:false` / `stateTransitionHistory:false`）。
- [x] 门禁：`typecheck` 0 · 定向 **32 pass** · 全量 **4871 pass / 21 skip / 0 fail** · `lint:arch` 违规 0（**动态跨层引用 41 未增**）· `lint:doc-code` 19 断言一致。
- [x] ⚠️ **无对端联调**（如实）：仅**单元级**验证；不与真实 A2A 客户端互通。

## 8. 合规检查清单

| 规则 | 判定 |
|---|---|
| **GR15**（Spec-Driven） | ✅ API 变更必立本 spec（11 操作 + 新端点 + 卡片形状） |
| **GR01 / CS01**（复用） | ✅ 复用既有 `A2APort` / `taskStore`（含 `cancel` 语义）/ JSON-RPC 类型与错误码 / SSE 基础设施；**不新造框架** |
| **CS03**（回退最小化） | ✅ 不实现无需求能力（push / extended card）⇒ **如实报错**而非留桩；不建可配置面 |
| **CS06**（证据驱动） | ✅ §2 全部照录官方 spec/proto（含**两处规范自相不一致**如实并列）；§3 明确"落地子集 ≠ 全量" |
| **R06-008 / R00-001** | ✅ 新增端点仍在 `infrastructure` 层，经 `A2APort` 取数据（**不得**静态 import app） |

## 9. 风险与边界（如实）

1. **无对端可联调**：全部验证为单元级（帧/错误码/门控/分页/流关闭）；**未**与真实 A2A 客户端互通 ⇒ 互操作风险未消除。
2. **规范自相不一致**（已如实并列，落地**取 proto 为准** —— spec §1.4 明示 proto 是唯一规范源）：① `supportedInterfaces` 的 REQUIRED（proto）vs SHOULD（spec §8.3.1）；② `AgentCapabilities.extendedAgentCard` 字段号 §A.2.2 写 5 / proto 写 4；③ **安全需求字段名**：spec §3.1.11 正文写 `AgentCard.security`，proto 为 `security_requirements` 且 §8.5 样例亦作 `securityRequirements` ⇒ 本批取**后者**。
3. **卡片形状来源（可复核）**：`url` / `protocolVersion` / `preferredTransport` / `additionalInterfaces` / `supportsAuthenticatedExtendedCard` 的**移除**与 `supportedInterfaces` 的**新增**，取自官方 **"What's New in A2A Protocol v1.0" §AgentCard Object**（"Removed Fields" 与 "Structure Example v1.0" 两段，2026-10-07 拉取核对）；**非**从本仓推测。
4. **`final` 字段已移除**：流关闭靠"终态事件 + 关流"，**不得**引入 `final`（v1.0 明确"should not be emitted"）。
5. **推送通知不做** ⇒ 长任务在客户端断开时**无法通知**（本仓以 Task 状态机 + 轮询表达）。
6. **`A2A_ENABLED` 默认关** ⇒ 本批对正常使用**零影响**。

## 10. 实施记录

| 日期 | 批次 | 详情 |
|---|---|---|
| 2026-10-07 | **立项 + 批次 A** | 用户裁定「全量 T4」⇒ 拉取官方 spec/proto（11 操作 / DTO / 流事件 / 扩展 / 卡片 v1.0 / 错误码）⇒ 本 spec + `types/a2a.ts` 协议类型补全 |
| 2026-10-07 | **批次 B** | `POST /v1/a2a/rpc` 单入口 dispatcher（11 方法分派 + 能力门控 + 错误映射）；`A2APort` 补 `listTasks`/`cancelTask`（**结构化结果**，避免异常控制流与字符串匹配）；`runDelegation` 抽为 REST/RPC **共用核心**（CS01）；新增 `tests/http/a2aRpc.test.ts`（**11 例**，含帧/错误码/门控/分页/`returnImmediately` 不阻塞）。门禁：`typecheck` 0 · `lint:arch` 违规 0/警告 4（基线）/动态跨层引用 **41（未增）** · 定向 **11 pass** · 全量 **4869 pass / 21 skip / 0 fail** |

| 2026-10-07 | **批次 C** | **SSE 流式**：`SendStreamingMessage` / `SubscribeToTask`（`openSseStream`：`text/event-stream` + 每条 `data:` 为 **JSON-RPC 响应对象** + **终态即关流** + **幂等** `close`）；`taskStore` 内新增**订阅/广播**（快照遍历 + 逐监听器隔离 ⇒ 单流失败不影响其它流，spec §3.5.2）；`A2APort` 补 `subscribeTask`；卡片 `streaming` **如实翻为 `true`**（同批同步 api-spec §3.8.2 + `a2a-external-exposure.md` §1/§7 + `a2a-v1-naming-alignment.md` §1-4/§1-9/N1–N3 + `a2a-capability-negotiation.md` §5，**防双源漂移**）；`a2aRpc.test.ts` **+2 例**（流帧/关流/首帧/终态订阅拒绝）。门禁：`typecheck` 0 · 定向 **32 pass**（两文件）· 全量 **4871 pass / 21 skip / 0 fail** |

| 2026-10-07 | **批次 D** | **卡片 v1.0 形状**（依据官方 "What's New in v1.0" §AgentCard，2026-10-07 核对）：新增 `supportedInterfaces`（**REQUIRED**，`url = <base>/v1/a2a/rpc`）；**移除**顶层 `url` / `protocolVersion` / `security`⇒`securityRequirements`（依 v1.0 proto）；`A2A_RPC_PATH` 提为 core 常量（**卡片与路由共用单一事实源**）；`A2AAgentCard.supportedInterfaces` 由可选改**必填**；同批同步 api-spec §3.8.2（含 **2.9.0** 版本行）+ `a2a-external-exposure.md` §7 + `a2a-capability-negotiation.md` §7-1 ⇒ **预存 A2A-1 关闭**。门禁：`typecheck` 0 · 定向 **32 pass** |

| 2026-10-07 | **批次 E** | **两次文件拆分**（回落 `lint:size`）：`a2a-routes.ts` → **`a2a-rpc.ts`**（JSON-RPC 单入口 + 非流式方法 + 共用纯函数，**461 行**；委派状态经 **`A2ARpcDeps` 注入** ⇒ 单向依赖、无静态环）→ **`a2a-rpc-stream.ts`**（SSE；由 `a2a-rpc` **懒加载**调用）；api-spec `§3.8.2` 实现行同步为新文件；`a2a-routes.ts` 的本地 `A2APortSlice`/`toDeliverables` 改为自 `a2a-rpc` 导入。门禁：`typecheck` 0 · 改动 `eslint` 0 · `lint:arch` 违规 0/警告 4/动态跨层引用 **41（未增）** · **`lint:size` 470（回到基线）** · 定向 **32 pass** · 全量 **4871 pass / 21 skip / 0 fail** |

**✅ 门禁计数已回落（批次 E 收口）**：批次 B 曾使 `a2a-routes.ts` 超 500 行（`lint:size` 警告 470 → 471）。批次 E 两次拆分后：
`a2a-routes.ts`（卡片/探针/REST + 委派核心）· `a2a-rpc.ts`（**461 行**）· `a2a-rpc-stream.ts`（SSE）**三者均在阈值内** ⇒ **`lint:size` 警告回到 470（基线）**。
拆分手法：**依赖注入**（`A2ARpcDeps`，避免 `a2a-routes` ⇄ `a2a-rpc` 静态环）+ **懒加载**（`a2a-rpc` 对 `a2a-rpc-stream` 用 `await import`，同仓既有断环手法）。

**批次 B 的两处**如实**口径**：
1. **协议级错误以 HTTP 200 + `error` 对象**返回（JSON-RPC 2.0 惯例）。spec §5.4 另给 HTTP 状态列，属 **REST 绑定**视角；本仓无对端可验，取惯例并在此登记（§9-1）。
2. `SendMessage` 在**未装配** `A2ADelegator` 时返回 **`-32603 InternalError`**（JSON-RPC 无 503 语义）—— 与 REST 侧的 `503 + Retry-After` **同口径**（如实"未就绪"，不伪造成功）。
