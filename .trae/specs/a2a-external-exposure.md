# A2A 对外暴露（`/.well-known/agent.json` + 任务委派）—— 立项

> **状态**：🟢 **边界已裁定（2026-09-29，用户）→ 待实施** —— **`ACP 对内`、`A2A 对外`**（T0 完成，见 §4）；实现任务 T1–T5 见 §4
> **来源**：[`liri-upgrade-plan-20260928.md`](./liri-upgrade-plan-20260928.md) §2.F **F2** / §2.G **G2** / §3 **P3-1**；[`architecture-benchmark-20260928.md`](./architecture-benchmark-20260928.md) #15（协议双轨）
> **关联规则**：GR01（基础设施复用）/ GR02（实现唯一性）/ GR03（证据驱动）/ CS01 / CS03 / CS05 / §1.6.1（前后端接口清单 `api-spec.md`）/ §1.8（日志）
> **最后更新**：2026-09-29

---

## 1. 取证：能力面已就绪，**只差对外暴露这一层**

| 事实 | 证据 |
|---|---|
| **A2A 数据模型已就绪（3 文件）** | [`agent/a2a/`](../../app/src/agent/a2a)：`agentCard.ts` / `taskStore.ts` / `types.ts`（**转出层**；协议类型已由 **2026-10-01 D-204** 下沉 core ⇒ `A2AAgentCard` 定义见 [`types/a2a.ts:167`](../../app/src/types/a2a.ts#L167)） |
| **卡片构建器已实现** | [`buildAgentCard(definitions, options)`](../../app/src/agent/a2a/agentCard.ts#L80-L100)：`AgentDefinition[]` → `A2AAgentCard`；协议版本常量 `A2A_PROTOCOL_VERSION = '1.0'`（[:34](../../app/src/agent/a2a/agentCard.ts#L34)）；另有 [`computeAgentCardEtag()`](../../app/src/agent/a2a/agentCard.ts#L119)（供 ETag / 条件请求） |
| **G2 要求"声明 streaming / 长任务 pending" —— builder 内**已按"未支持须声明"处理 | [`agentCard.ts:95-104`](../../app/src/agent/a2a/agentCard.ts#L95-L104)：`capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: false }` + 就地注释。**注（T4 批次 C，2026-10-07）**：`streaming` 原为 `false`，SSE 实现后**如实翻为 `true`**；`pushNotifications` **仍为 `false`**（未实现） |
| **纪律已定：卡片不内嵌密钥** | [`agentCard.ts:26`](../../app/src/agent/a2a/agentCard.ts#L26)："卡片**不得内嵌静态密钥** —— 只声明 `securitySchemes`，凭证经 HTTP Header 带外传递" |
| **⚠️ 但整体未接线（本项的真实缺口）** | `buildAgentCard` / `A2AAgentCard` / `computeAgentCardEtag` 全仓 grep **仅命中自身文件 + `types.ts`** ⇒ **零消费者** ⇒ **无任何 HTTP 暴露**（与 `liri-upgrade-plan-20260928.md` §5-#5/#10"无端点"的复核结论一致） |
| **挂载机制（已定位）** | 路由按业务子域分文件：[`infrastructure/http/handlers/routes/`](../../app/src/infrastructure/http/handlers/routes)（**17 个** `*-routes.ts`），由 [`route-table.ts`](../../app/src/infrastructure/http/handlers/route-table.ts#L10-L23) 逐域 `import { dispatch<Domain>Routes }` 统一挂载 ⇒ 新端点＝**新增 1 个 route 模块 + 在 route-table 注册**（不新造机制） |
| **✅ 协议双轨边界已裁定（2026-09-29，用户）** | `acp/`（**对内**）与 `agent/a2a/`（**对外**）分工明确；⇒ **不下线任何一套**（作用域不同）。"对内"已取证成立：默认仅 loopback（见 §4 T0） |

---

## 2. 目标与验收（可证伪）

- **G1（主目标）**：暴露 `GET /.well-known/agent.json`，返回由 `buildAgentCard()` 产出的 **A2A Agent Card**（标准发现端点）。
- **G2（能力声明一致）**：卡片中的 `capabilities.streaming` / `pushNotifications` **必须与实现一致** —— 当前实现为**同步委派** ⇒ 恒为 `false`；**不得**为"看起来符合规范"而虚报 `true`（否则客户端会按流式/推送握手 ⇒ 必然失败）。
- **G3（长任务 pending 语义）**：A2A 的"长任务"用 **Task 状态机**表达（`taskStore`），而非 `pushNotifications`；若委派耗时超阈值，端点须返回 `working` 态 + 任务 id（**非** HTTP 长挂）。
- **G4（默认关闭 / fail-closed）**：**未显式启用时不得监听对外** —— 与 `sandbox.landlock.bashEnabled` 的默认全局面一致（本项目对"对外暴露"类能力一律默认关）。
- **G5（零回归）**：未启用时，`route-table` 行为与现状**逐项一致**（新模块不得改变既有 17 个域的派发）。
- **验收判据**：① 启用后 `curl /.well-known/agent.json` 返回符合 `A2AAgentCard` 的 JSON 且 `capabilities` 与实际一致；② 未启用时该路径 **404**（不泄露存在性）；③ 既有 HTTP 契约测试全绿。

---

## 3. 设计要点

1. **挂点（复用既有机制，GR01）**：新增 `infrastructure/http/handlers/routes/a2a-routes.ts`（导出 `dispatchA2ARoutes`）+ 在 [`route-table.ts`](../../app/src/infrastructure/http/handlers/route-table.ts) 注册一行。**不新造路由框架**。
2. **`baseUrl` 装配**：`AgentCardOptions.baseUrl` 由**调用方按实际监听地址传入**（[`agentCard.ts:41-42`](../../app/src/agent/a2a/agentCard.ts#L41-L42) 已明令"**禁止**硬编码域名/端口"）⇒ 从既有 LocalHTTPService 监听配置读取。
3. **ETag / 条件请求**：直接用 `computeAgentCardEtag()`；`version` 取配置或构建时间戳（`AgentCardOptions.version`）。
4. **鉴权**：只声明 `securitySchemes`（**不内嵌密钥**，[:26](../../app/src/agent/a2a/agentCard.ts#L26)），凭证走 HTTP Header；委派端点沿用**既有权限体系**（`permission/`）而非新造。
5. **默认关闭**：新增配置项（命名遵循 §1.4 前缀规范）控制"是否暴露 A2A 端点"；默认 `false`。

---

## 4. 任务清单（**T0–T6 全部完成**，见 §6）

| 编号 | 任务 | 状态 | 验证方式 |
|---|---|:--:|---|
| **T0** | 划 `acp/` 与 `agent/a2a/` 的边界（谁对外、谁对内；是否下线一套） | ✅ **已裁定（2026-09-29，用户）：`ACP 对内` / `A2A 对外`；不下线**（**"对内"已闭环复核**，见下） | ① 取证（静态）：[`AcpWebSocketServer.ts:76`](../../app/src/acp/AcpWebSocketServer.ts#L76) 默认 `host: '127.0.0.1'` · [`ModuleBridgeSetup.ts:29-44`](../../app/src/bridge/ModuleBridgeSetup.ts#L29-L44) `resolveAcpRemoteConfig()` **仅在 `ACP_REMOTE_PORT` 显式设置且 >0 时返回配置**（否则 `null` ⇒ 不启动）⇒ **要对外须同时设 `ACP_REMOTE_PORT` + `ACP_REMOTE_HOST`（双显式 opt-in）**；门控确在**活的启动链**上（[`main.ts:1821`](../../app/src/main.ts#L1821) / [`BootPipelineIntegrator.ts:246`](../../app/src/core/boot/BootPipelineIntegrator.ts#L246)）。② 取证（**运行期**）：本机 `app.log` **5 次启动全部**为 `[Bridge] ACP 远程服务未启用（设置 ACP_REMOTE_PORT 以启用）`、**零**条「已启动」⇒ **ACP 从未对外** |
| T1 | 新增 `a2a-routes.ts`（`dispatchA2ARoutes`）+ `route-table.ts` 注册（**默认关闭**） | ✅ **已完成** | 用例①：未启用 ⇒ **不处理、不写响应**（上层自然 404） |
| T2 | `baseUrl` 装配（`A2A_PUBLIC_URL` 优先，缺省按请求 `Host`；**不硬编码**） | ✅ **已完成** | 用例②③：Host 推导 / 显式 URL 优先 |
| T3 | ETag / 条件请求（复用 `computeAgentCardEtag`） | ✅ **已完成** | 用例④：`If-None-Match` 命中 ⇒ **304**（无 body）；另 405 / 非目标路径用例 |
| T4 | 委派端点（`POST /v1/a2a/tasks` + `GET /v1/a2a/tasks/{id}`；有界等待 ⇒ 超阈值 `working`，**不做 HTTP 长挂**） | ✅ **已完成**（后端按**方案①**接入：`createCoreApiDelegator` → `CoreAPI` 对话轮） | 端点 5 态（**503+`Retry-After`** 兜底 / 400 / 200+`completed` / 202+`working` → 回查 `completed` / 404）+ 后端自身 **4 例**（会话创建 / 人格降级 / 空正文） |
| T5 | `api-spec.md` 同步（§1.6.1 强制） | ✅ **已完成** | 已新增 **§3.8.2**（发现 + 委派 + 鉴权契约）+ 版本 **2.4.0 / 2.5.0 / 2.6.0** |
| **T6** | **鉴权：专用密钥 + fail-closed**（`A2A_API_KEYS`（**清单**）；未配置 ⇒ **401**，不回退"本地信任基线"） | ✅ **已完成（2026-09-29 用户裁定）**；**2026-10-07 扩为多钥 + 可选过期** ⇒ 见 [`a2a-multikey-rotation.md`](./a2a-multikey-rotation.md) | 用例：未配密钥 ⇒ 401 / 头缺失或错 ⇒ 401 / 正确 ⇒ 放行 / **多钥均可通** / **过期钥 ⇒ 401** |

**依赖顺序**：**T0 → T1 →（T2 ∥ T3 ∥ T4）→ T5**。

---

## 5. 合规检查表

| 规则 | 落实 |
|---|---|
| GR01（基础设施复用） | 复用 `buildAgentCard` / `computeAgentCardEtag` / `taskStore` / `route-table` 挂载机制；**不新造**路由或卡片框架 |
| GR02（实现唯一性） | **T0 即为此设** —— `acp/` 与 `agent/a2a/` 的边界必须先划清，否则会形成**第二套对外协议**（`architecture-benchmark-20260928.md` #15 已预警） |
| GR03（证据驱动） | §1 每条附 `文件:行`；G2 明确"不得虚报 capabilities" |
| CS01（新增前先查已有） | §1 即该检查 ⇒ 结论是"**模型已在、只差暴露**"，故**不重写**卡片逻辑 |
| CS03（回退最小化） | **默认关闭**（G4）；不引入"半开"中间态 |
| CS05（根因优先） | 根因＝**未接线**（零消费者），非"缺模型" |
| §1.6.1（接口清单） | T5 强制同步 `api-spec.md` |
| §1.8（日志） | 端点启用/委派日志走 `getLogger(module)`，module 命名 `http:a2a` |
| 安全（§1.1） | 卡片**不内嵌密钥**（`agentCard.ts:26` 既有纪律）；对外默认关闭 |

---

## 6. 实施记录（T1–T3 / T5，2026-09-29）

| 项 | 落点 | 状态 |
|---|---|:--:|
| 路由模块（**新建**） | [`routes/a2a-routes.ts`](../../app/src/infrastructure/http/handlers/routes/a2a-routes.ts)：`dispatchA2ARoutes` + `isA2AEnabled` + `resolveBaseUrl` | ✅ |
| 统一注册 | [`route-table.ts`](../../app/src/infrastructure/http/handlers/route-table.ts#L27-L28) 导入 + [派发链末位](../../app/src/infrastructure/http/handlers/route-table.ts#L133-L135) 注册 | ✅ |
| **barrel 导出（必需）** | [`agent/index.ts:281-290`](../../app/src/agent/index.ts#L281-L290) 导出 `A2A_PROTOCOL_VERSION` / `buildAgentCard` / `computeAgentCardEtag` + 类型 | ✅ |
| 测试（**新建**） | [`tests/http/a2aRoutes.test.ts`](../../app/tests/http/a2aRoutes.test.ts) **5 例** | ✅ |
| 接口清单 | `.trae/docs/api-spec.md` **§3.8.2** + 版本 **2.4.0** | ✅ |

**改动面（5 文件）**：`infrastructure/http/handlers/routes/a2a-routes.ts`（新建）、`infrastructure/http/handlers/route-table.ts`（+4 行）、`agent/index.ts`（+17 行 barrel 导出）、`tests/http/a2aRoutes.test.ts`（新建）、`.trae/docs/api-spec.md`（+§3.8.2）。

### T4 委派：设计与一处**张力**（如实）

- **既有边界**：[`a2a/taskStore.ts`](../../app/src/agent/a2a/taskStore.ts) 头注释明写"只缓存**同步委派**的结果…**不是**后台任务账本 —— 本实现**不启动任何后台任务循环**、不做跨轮计数"。
- **本 spec 的 T4 要求**"超阈值 ⇒ `working` + 任务 id（**非** HTTP 长挂）" ⇒ 二者**有张力**。**落地取法**：**有界等待**（`A2A_DELEGATE_MAX_WAIT_MS`，默认 15 s）——阈值内完成即返回终态（**同步**，与 store 定位一致）；超阈值才标记 `working` 并立即返回，随后由**同一个 Promise**（**非**循环/轮询）收尾 ⇒ **不新增后台任务循环**，与 store 头注释仍相容。
- **委派后端 = 可注入端口**（`A2ADelegator` + `setA2ADelegator`）：**本模块不替它选后端**。取证结论：`AgentService` **只有 CRUD**（`createAgent`/`getAgent`/`listAgents`/`deleteAgent`/`updateAgent`，见 [`services/agentService.ts`](../../app/src/agent/services/agentService.ts)）⇒ **仓内没有干净的"把消息交给某个 Agent"的 API**；既有 [`handleAgentTaskChat`](../../app/src/infrastructure/http/handlers/agent2-handlers.ts#L259-L279) 依赖**已存在**的 taskId 且 `as any` 密集 ⇒ 未复用。
- ✅ **后端已接入（方案①，2026-09-29 用户裁定）**：新增 [`routes/a2a-delegator.ts`](../../app/src/infrastructure/http/handlers/routes/a2a-delegator.ts) 的 `createCoreApiDelegator()` —— **每次委派新建独立会话**（`mode: 'a2a'`，隔离外部调用者之间的上下文）→ `CoreAPI.chat({ content, sessionId, stream: false, systemPrompt? })` → 返回助手正文；`agentId` 命中注册表时用该 Agent 的 `systemPrompt` 作本轮人格（**未命中 ⇒ WARN + 按默认人格**，**不臆造**）。
  · **装配点**：[`getLocalHTTPService()`](../../app/src/infrastructure/http/LocalHTTPService.ts#L485-L496) 内**同步** `installA2ADelegator()`（静态 import ⇒ 消除"首个请求早于装配"的竞态）；装配异常**不阻断** HTTP 启动。
  · **可测性**：后端只依赖**窄端口** `A2ADelegationCore`（仅 `createSession` + `chat`）⇒ 单测注入假实现，**不触碰真实 `CoreAPI`、不产生对话成本**（**4 例**）。
  · ⚠️ **边界（如实）**：这是**一条完整对话轮** ⇒ 会走既有**模型路由 / 工具执行 / 权限门 / 成本记账**；未就绪态（`503`）退化为**装配失败时的兜底**（正常装配后不可达）。A12（2026-10-06）：未就绪态由 **501** 改为 **503 + `Retry-After`**（501="永不支持" 与"装配后即恢复"语义不符）。

**实施期一处**架构约束**（如实记录）**：初版在 route 里**深路径** `import ... from '@modules/agent/a2a/agentCard'` ⇒ 被 **`module-registry/no-direct-module-import`** 拦下（`infrastructure` 只允许 `@modules/agent` **barrel**，深路径须走 `moduleRegistry.resolve`）⇒ 改为**经 barrel 导出**所需 4 个符号（GR01 复用既有 barrel，不新增 `allowedPaths` 例外）。

**验收（实测）**：新增守卫 **5 pass / 0 fail** · `typecheck` **0** · 改动文件 `eslint` **0** · `prettier` ✓ · `lint:arch` **违规 0**、检查文件 **3970 → 3971**（+1 = 新模块，**逐数吻合**）、告警仍 1（预存 R07-004）、`R03-002 模块出口单一 0 处违规`。

**未做/已闭环（如实）**：① ~~委派后端未接线 ⇒ `POST /v1/a2a/tasks` 返回 501~~ ⇒ ✅ **已于同日接入**（**方案①：CoreAPI 对话轮**；未就绪态**已由 501 改为 503 + `Retry-After`**，见 A12）· ② **未做真机端到端**（需 `A2A_ENABLED=true` 起 daemon 后从外部 `curl`）—— 由单测覆盖：卡 4 态 + 委派 5 态 + **鉴权 3 态** · ③ ~~鉴权强度未决策~~ ⇒ ✅ **已定**（**专用密钥 + fail-closed**）；**分发与轮换见 §8**。

---

## 7. 不在范围 / 未验（如实）

- ✅ **SSE 流式已实现（T4 批次 C，2026-10-07）**：`streaming` 翻为 **`true`**（`SendStreamingMessage` / `SubscribeToTask` 经 `POST /v1/a2a/rpc` 以 `text/event-stream` 推送）；`pushNotifications` **仍不实现**（**如实声明为 `false`** ⇒ 4 个推送配置操作返回 `-32003`）。见 [`a2a-jsonrpc-binding.md`](./a2a-jsonrpc-binding.md)。
- ✅ **不声明传输绑定（R11-3 D3，2026-10-07 用户裁定；T4 批次 D 将如实恢复）**：卡片**省略** `supportedInterfaces` —— 定这个裁定时本仓**未实现**任何 A2A 标准绑定 ⇒ 不得虚报 `protocolBinding: 'JSONRPC'`（G2 纪律的同一精神）。**注（T4 批次 B/C，2026-10-07）**：JSON-RPC 与 SSE **已实现** ⇒ **批次 D 将按 v1.0 如实恢复**该声明（指向 `/v1/a2a/rpc`）。详见 [`a2a-jsonrpc-binding.md`](./a2a-jsonrpc-binding.md)。⚠️ 残留：A2A v1.0 该字段为**必需** ⇒ 批次 D 前卡片仍属 v0.x 形状。
- ❌ **不引入** A2A SDK 依赖（当前为自建类型 + 手写端点）。
- ❌ **不改** `acp/`（其去留由 **T0** 结论决定）。
- ✅ **已核并闭环（2026-09-29）**：`acp/` **确为对内** —— 远程 WS 服务**默认不启动**（`ACP_REMOTE_PORT` 未设 ⇒ `resolveAcpRemoteConfig()` 返回 `null`，[`ModuleBridgeSetup.ts:29-44`](../../app/src/bridge/ModuleBridgeSetup.ts#L29-L44)），且门控**在活的启动链上**（`main.ts:1821` / `BootPipelineIntegrator.ts:246`）；**运行期实证**：本机 5 次启动**全部**输出「ACP 远程服务未启用」、**零**「服务已启动」。⇒ 所谓"协议双轨"实为 **「A2A 对外（新接线）+ ACP 对内（默认关、双显式 opt-in 才能开）」**，边界清晰，**无需下线任何一套**。
- ✅ **ACP 侧暴露加固（2026-10-06，台账 N-81，用户裁定 = fail-closed）**：**ACP 的"对内"不再只是约定** —— [`resolveAcpRemoteRefusalReason`](../../app/src/bridge/ModuleBridgeSetup.ts#L78-L91)（纯函数）+ [`startAcpRemoteServer` 门控](../../app/src/bridge/ModuleBridgeSetup.ts#L145-L159)：**`ACP_REMOTE_HOST` 非回环（非 `localhost`/`127.0.0.0/8`/`::1`）且未配 `ACP_REMOTE_AUTH_TOKEN` ⇒ 拒绝启动**（不建服务器、不绑端口）。同时修掉同族根因：`AcpWebSocketServer` 构造函数原用 `...config` ⇒ `host: undefined/''` **可覆盖回环默认**（`listen(port, undefined)` 绑所有网卡，潜在 fail-open），现显式兜底回环。**回环下行为零变化**（默认 `127.0.0.1` + 可选 token 的"本机信任基线"保留）。
- ✅ **鉴权强度已定（2026-09-29，用户裁定「专用密钥 + fail-closed」）**：新增环境变量 **`A2A_API_KEYS`**（2026-10-07 起为**清单**，兼容单钥写法）—— **无有效钥 ⇒ 一律 401**（**刻意不**沿用本机 API 的"未配密钥即放行（本地信任基线）"回退，因为 A2A 是**对外**面）；配置了则复用 [`verifyRequestAuth`](../../app/src/infrastructure/http/LocalHTTPServiceHelpers.ts#L36) 的**同一头部语义**（`x-api-key` / `Bearer`）。⇒ 与 `A2A_ENABLED` 构成**双闸**（启用 + 有密钥）。
- ✅ **分发与轮换（2026-09-29 首定；2026-10-07 升级为多钥）**：**分发 = OS 环境变量**（`A2A_API_KEYS`）；**轮换 = 单钥文档化流程**（§8.3，含回滚点 + "旧钥必须 401"必验项）**或 多钥零中断流程**（§8.4 ⇒ `a2a-multikey-rotation.md`，新旧钥并存 + **可选过期**）。`A2A_ENABLED` 仍**默认关闭**。
- **未做（属新需求，另立 spec）**：密钥使用审计 / 轮换脚本 —— 见 §8.4 与 `a2a-multikey-rotation.md` §7。
- ✅ **鉴权强度余量已收口（2026-10-07，台账 R07-4②）**：密钥比较改为**常量时间**（消除时序/**长度**侧信道）+ 修正 `a2a-delegator.ts` 的**过时注释**（原称"鉴权强度尚未决策"，与 2026-09-29 裁定矛盾）；其余（审计 / 轮换脚本 / 失败限流 / TLS）**不做**并逐条给出理由与**触发条件** —— 见 **§9**。
- ✅ **多钥并存（零中断轮换）已实施（2026-10-07，用户裁定「按这个方案来」）**：`A2A_API_KEYS` 由**单钥**扩为**清单**（`key` 或 `key@<ISO-8601>`）⇒ 详见 **[`a2a-multikey-rotation.md`](./a2a-multikey-rotation.md)**。

---

## 8. 部署与密钥轮换（运营说明；2026-09-29 裁定：**维持 env + 单钥文档化**；2026-10-07 增补 **多钥零中断**，见 §8.4）

**为什么不做密钥管理面（如实）**：按 **CS03**（不做未被要求的可配置性）—— 本项**默认关闭**、单机部署、无多租户需求 ⇒ **不**接 `credentials.json`、**不做**轮换脚本。**2026-10-07 例外**：用户裁定需要**零中断轮换** ⇒ 仅把"单钥"扩为"**清单 + 可选过期**"（配置面**极小**，不引入密钥管理的持久化面），见 §8.4 / [`a2a-multikey-rotation.md`](./a2a-multikey-rotation.md)。

### 8.1 环境变量清单（唯一分发面 = **OS 环境变量**）

| 变量 | 必填 | 缺省行为 | 作用 |
|---|---|---|---|
| `A2A_ENABLED` | 要对外则须为 `'true'` | **不处理任何 A2A 路径**（上层自然 404，不泄露存在性） | 总开关（第一道闸） |
| `A2A_API_KEYS` | 启用后**必填** | **无有效钥 ⇒ 一律 401**（fail-closed；不回退"本地信任基线"） | 访问密钥**清单**（第二道闸）：逗号分隔，每项 `key` 或 `key@<ISO-8601>`（`@` 后为**过期时刻**） |
| `A2A_PUBLIC_URL` | 否 | 按请求 `Host` 推导 | 卡片中写出的对外基址（**不硬编码**） |
| `A2A_DELEGATE_MAX_WAIT_MS` | 否 | `15000` | 委派**有界等待**上限（超时转 `working`，不做 HTTP 长挂） |

⚠️ **生效方式**：读取走 `configManager.env()` = **`process.env`**（[`ConfigManager.ts:1420-1421`](../../app/src/config/ConfigManager.ts#L1420-L1421)）⇒ **改任意一项都必须重启进程**（**无热加载**）；`~/.pyapp/config.json` **不参与** env 解析（勿把密钥写在那里并期待生效）。

### 8.2 首次启用（三步）

1. **生成强随机密钥**：
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
2. **在启动环境注入**（启动脚本 / 服务管理器 / 由启动外壳读取的 `.env`）：`A2A_ENABLED=true` 与 `A2A_API_KEYS=<上一步的值>`；
3. **重启进程** ⇒ 首次访问时日志应出现 **`A2A Agent Card 已发布`**。

**自检（两条都要跑）**：
- 带钥 ⇒ **200**：`curl -H "x-api-key: $A2A_API_KEYS" http://127.0.0.1:<port>/.well-known/agent.json`
- **不带钥 ⇒ 401**（证明 fail-closed 生效，而非误放行）

### 8.3 轮换流程（**单钥**；含**回滚点**）

> 前提（为什么单钥可接受）：`A2A_ENABLED` **默认关闭**，轮换窗口的业务影响**可控**；若要零中断，见 §8.4。

1. **记录现状 = 回滚点**：抄下当前生效的 `A2A_API_KEYS` 值与它的**部署位置**（哪份启动脚本/服务配置）；
2. 生成新钥（同 §8.2 第 1 步）；
3. **先通知客户端**改配新钥（或安排维护窗）；
4. 更新启动环境中的 `A2A_API_KEYS`；
5. **重启进程**；
6. **验证（三步，缺一不可）**：新钥 ⇒ **200**；**旧钥 ⇒ 401**（必须验——若旧钥仍通，说明没换成）；无钥 ⇒ **401**；
7. **作废旧钥**：从所有副本、历史脚本等处清除；
8. **回滚**：第 6 步任一不符 ⇒ 把 `A2A_API_KEYS` **改回第 1 步的值**并重启（回滚点即该值 + 原启动配置）。

**已知代价（如实）**：单钥意味着轮换期存在**短暂不可用窗口**（第 4–5 步之间客户端仍持旧钥）；且**无法审计"哪把钥被谁用"**（没有多钥/使用记录）。

### 8.4 多钥并存（**零中断轮换**）—— ✅ **已实施（2026-10-07）**

> 本节原为"本 spec **不做**"的占位；**2026-10-07 用户裁定「按这个方案来」**（§8.4 的触发条件成立）⇒ **已另立 spec 并实施**：
> **[`a2a-multikey-rotation.md`](./a2a-multikey-rotation.md)**（含 D1–D5 裁定、零中断流程、过期语义、fail-closed 保持、门禁）。

**要点速览**：`A2A_API_KEYS` 由**单钥**扩为**清单**（逗号分隔；每项 `key` 或 `key@<ISO-8601>`）；新旧钥**并存**期间**均可通**（无停机窗口）；旧钥可带 `@` 过期时刻**自动失效**；**无有效钥 ⇒ 401** 不变。
**仍不做**（如实，见该 spec §7）：密钥使用审计 / 轮换脚本。

---

## 9. 鉴权强度收口（R07-4②，2026-10-07）

> 来源：台账 `dev_docs/任务计划-20261004.md` §28.3 **R07-4②**（外部报告 §五-P1-1 后半："确认 `A2A_ENABLED` 默认值与**鉴权强度**"）。

### 9.1 先纠一处**注释漂移**（取证）

`a2a-delegator.ts` 头注释原写「**鉴权强度**尚未决策（spec §7）」——**该表述已过时**：
§7 记载 **2026-09-29 用户裁定**「专用密钥 + fail-closed」（当时的单钥变量名 `A2A_API_KEY`；**2026-10-07 已扩为清单 `A2A_API_KEYS`**），且**分发与轮换**同日已定（§8）。
⇒ 本批修注释（防止后人据旧注释误判"尚无鉴权"）。**决策本身不需要重做**；R07-4② 的真实剩余面 = **强度余量**。

### 9.2 已具备的强度（逐条，含证据）

| # | 项 | 证据 |
|:-:|---|---|
| 1 | **双闸**：`A2A_ENABLED` 默认关（未开 ⇒ 不处理任何 A2A 路径，不泄露存在性） | `a2a-routes.ts:88-89` |
| 2 | **fail-closed**：`A2A_API_KEYS` **无有效钥**（未配/空白/全过期/全非法）⇒ **一律 401**（不回退"本地信任基线"） | `a2a-routes.ts`（`isA2AAuthorized`） |
| 3 | 卡片**不内嵌密钥**（只声明 `securitySchemes`） | `agent/a2a/agentCard.ts:26` |
| 4 | 密钥**不进** `config.json`（唯一分发面 = OS 环境变量；改后须重启，无热加载） | §8.1 |
| 5 | 轮换流程**文档化**（含**回滚点** + "旧钥必须 401"必验项） | §8.3 |
| 6 | **（本批新增）密钥比较改为常量时间** | `LocalHTTPServiceHelpers.ts#verifyRequestAuth`：两侧 SHA-256 **定长摘要** + `timingSafeEqual` ⇒ 同时消除**逐字节短路的时序侧信道**与**长度侧信道**（直接对原文比较会在长度不等时提前返回 ⇒ 泄露长度）。语义**完全等价**（仅计时不同），且因该函数**共享** ⇒ 本机 API（`LIRI_API_SECRET`）**同批受益** |

### 9.3 本批**不做**的项及理由（CS03：不做未被要求的可配置性）

| 未做项 | 理由（触发条件 → 才另立 spec） |
|---|---|
| ~~**多钥并存窗口**（零中断轮换）~~ | ✅ **已于 2026-10-07 实施**（用户裁定「按这个方案来」）⇒ 见 §8.4 / [`a2a-multikey-rotation.md`](./a2a-multikey-rotation.md) |
| **密钥使用审计**（哪把钥被谁用） | 单钥下无区分价值；需与多钥一并设计。**触发条件**：多钥落地后 |
| **轮换脚本** | §8.3 的 8 步含人工"通知客户端 + 回滚判断"，自动化收益低而误操作风险高。**触发条件**：轮换频次上升 |
| **失败限流 / 退避** | 当前**默认关 + 单机 + 32 字节随机钥** ⇒ 在线暴力破解**不可行**（256 bit 搜索空间），加限流是"无真实场景的防御"（CS03）。**触发条件**：密钥改由人工设置且强度不足（如短口令）⇒ 届时**先**强制最小长度，**再**谈限流 |
| **TLS / mTLS** | 本服务为**明文 HTTP**（bind 于本机/内网）；对外暴露的**传输加密由部署层承担**（反向代理 / 隧道）。**如实边界**：spec 不声称已加密 —— 直接将该端口暴露到公网而不加 TLS，等同于**明文传密钥** |

### 9.4 门禁（全绿）

`typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **违规 0 / 警告 4（基线）** · `lint:size` **0 错 / 470 警告 / 8 例外（基线）** · 相关用例：`tests/http/verifyRequestAuth.test.ts` **新建 6 例** + `tests/http/a2aRoutes.test.ts` **既有 12 例全过**（鉴权行为未变）· 全量 `bun test`（数值见台账 §28.3-R07-4）。

**未做真机端到端**：本批为单元级（比较语义 + 既有 A2A 路由回归）；**未**在 `A2A_ENABLED=true` 的真实进程上以 curl 复验（§8.2 自检两条仍属运营侧待跑）。
