# Spec：A2A 能力协商字段与独立健康探针（R11-3）

> 版本 1.1 ｜ 创建 2026-10-07 ｜ 状态：🟢 **已实施（2026-10-07）** —— D1/D2/D3 全部落地（**D3 由用户裁定取 (b) 撤销 JSON-RPC 声明**）
> 来源：台账 `dev_docs/任务计划-20261004.md` §24.4 **R11-3**（报告 11 §五-P2；§25.2 细化为「能力协商字段 + 独立健康探针」）
> 关联规则：GR15（Spec-Driven，**本项含 API 变更**）/ GR01（复用）/ CS01（归一化）/ CS03（回退最小化）/ CS06（证据驱动）/ R06-008（分层）
> 关联文档：`.trae/specs/a2a-external-exposure.md`（对外面主 spec，**G2"不得虚报 capabilities"**）· `.trae/specs/a2a-v1-naming-alignment.md`（**T4 待裁定**）· `.trae/docs/api-spec.md` §3.8.2

---

## 1. Problem Statement（回仓取证，2026-10-07 实测）

| # | 事实 | 证据 |
|:-:|---|---|
| 1 | **卡片 `capabilities` 缺 A2A 规范字段** `stateTransitionHistory` | 类型 [`A2AAgentCapabilities = { streaming, pushNotifications, extensions? }`](../../app/src/types/a2a.ts#L139-L143)（**无** `stateTransitionHistory`）；卡片只写两项 [`agentCard.ts:96-99`](../../app/src/agent/a2a/agentCard.ts#L96-L99)。规范字段集见 A2A 官方（v0.2.1 §5.5.2 / v0.3.0 §5.5.2）：`streaming` / `pushNotifications` / **`stateTransitionHistory`** / `extensions` |
| 2 | **⚠️ 卡片声明 `protocolBinding: 'JSONRPC'`，但服务端无 JSON-RPC 绑定** | 卡片 [`agentCard.ts:103-109`](../../app/src/agent/a2a/agentCard.ts#L103-L109) + 类型 [`A2AAgentInterface.protocolBinding: 'JSONRPC'`](../../app/src/types/a2a.ts#L146-L152)（**唯一取值**）；而 `A2A_METHODS`（`SendMessage`/`GetTask`/`CancelTask`）[`types/a2a.ts:213-236`](../../app/src/types/a2a.ts#L213-L236) **0 生产消费者** —— JSON-RPC 派发属 **T4「待裁定」**（`a2a-v1-naming-alignment.md:89`、其 D2=(b)）。实际端点只有 **自定义 REST**：`POST/GET /v1/a2a/tasks[...]`（[`a2a-routes.ts:6-7`](../../app/src/infrastructure/http/handlers/routes/a2a-routes.ts#L6-L7)）。⇒ **与 G2「不得虚报」同性质的不一致**（换了个字段） |
| 3 | **无 A2A 专用健康/就绪端点** | `grep 'a2a.*health\|health.*a2a\|/v1/a2a'` ⇒ 仅 `tasks` 相关 7 处，**0** health；外部调用方当前只能靠 **POST 后收 503**（[`a2a-routes.ts:305-313`](../../app/src/infrastructure/http/handlers/routes/a2a-routes.ts#L305-L313)）间接推断"委派后端未就绪" |
| 4 | 分层：路由（service）不得静态引 app | `a2a-routes.ts` 经 **`getCoreAPI().getA2APort()`** 取卡（D-204，[`runtime/api/a2aPorts.ts:22-35`](../../app/src/runtime/api/a2aPorts.ts#L22-L35)）—— 新增端点须沿用该缝，**不得** import `@modules/agent` |

## 2. 目标 / 非目标

**目标（可验证）**
- **G1**：卡片 `capabilities` 补全为 A2A 规范的**如实**取值（新增 `stateTransitionHistory: false`）。
- **G2**：新增**独立**就绪探针端点，使外部调用方**无需先 POST** 即可判断能否委派（如实反映 `A2ADelegator` 是否已装配）。
- **G3**：零新增跨层倒挂；鉴权/默认关闭语义与既有 A2A 面**逐字一致**（同双闸）。

**非目标（明确不做）**
- **N1**：**不**实现 JSON-RPC 绑定 / SSE / 扩展卡（**T4 待裁定**，属新能力）。
- **N2**：**不**擅自改/删 `supportedInterfaces` 或不实声明（见 **D3**，需裁定；本批只登记）。
- **N3**：**不**为探针引入缓存/心跳/超时等机制（CS03：探针只回答"此刻可否委派"）。
- **N4**：**不**改鉴权、路径、既有端点语义。

## 3. 设计

### D1 —— 能力协商字段如实补全 ✅ 本批实施

- `A2AAgentCapabilities` 增 **`stateTransitionHistory: boolean`**（**必填**，迫使每个构造点如实给出）。
- 卡片置 **`false`**（如实：本仓只暴露任务**当前态** `GET /v1/a2a/tasks/{id}`，**不含**状态变更历史）。

### D2 —— 独立健康探针 ✅ 本批实施

新增 `GET /v1/a2a/health`（同 A2A 双闸：未启用 ⇒ 不处理、自然 404；已启用无有效钥 ⇒ 401）：

```json
{ "status": "ok", "delegatorReady": true }
```

- `delegatorReady` = `hasA2ADelegator()`（**唯一**决定委派端点返回 200/202 还是 503 的因子）—— 与 `POST /v1/a2a/tasks` 的真实行为**同源**，不另造判据（CS01）。
- 非 `GET` ⇒ **405**（与既有两处端点同风格）。
- **不**返回密钥/版本/Agent 数（避免探针成为额外信息面；版本可由 Agent Card 发现端点取）。

### D3 —— `supportedInterfaces` 的 binding 声明如实化 ✅ **已实施（用户裁定取 (b)）**

| 选项 | 内容 | 结论 |
|---|---|---|
| **(a)** | 实现 A2A JSON-RPC 绑定（= **T4**） | ❌ 未采纳（属新能力；无对端可验） |
| **(b)（用户裁定，已实施）** | **撤销** `supportedInterfaces` 声明（未实现任何标准 binding 时不得声明），卡片**省略该字段**；对接以 `api-spec.md` §3.8.2 的**自定义 REST** 契约为准 | ✅ **已落地**：`agentCard.ts` 移除该字段（就地注释）；`types/a2a.ts` 的 `supportedInterfaces` / `A2AAgentInterface` 保留为**可选协议形状**并注明"当前不填充"；`a2aRoutes.test.ts` ③ 增 **`'supportedInterfaces' in card === false`** 断言锁定 |
| **(c)** | 维持现状 + 文档化偏差 | ❌ 未采纳（保留虚报，与 G2 纪律相悖） |

## 4. 影响文件

| # | 文件 | 改动 |
|:-:|---|---|
| 1 | [`app/src/types/a2a.ts`](../../app/src/types/a2a.ts) | `A2AAgentCapabilities` 增 `stateTransitionHistory: boolean`；`supportedInterfaces` / `A2AAgentInterface` 加注释说明**当前不填充**（D3） |
| 2 | [`app/src/agent/a2a/agentCard.ts`](../../app/src/agent/a2a/agentCard.ts) | 卡片 `capabilities` 增 `stateTransitionHistory: false`；**移除** `supportedInterfaces` 声明（D3）+ 就地注释 |
| 3 | [`app/src/infrastructure/http/handlers/routes/a2a-routes.ts`](../../app/src/infrastructure/http/handlers/routes/a2a-routes.ts) | 新增 `HEALTH_PATH` + `isA2APath` 纳入 + `handleHealth()`（D2） |
| 4 | [`app/tests/http/a2aRoutes.test.ts`](../../app/tests/http/a2aRoutes.test.ts) | ③ 改断言三字段 **+ 断言 `supportedInterfaces` 缺省**（D3 回归锁）；新增健康探针用例（就绪/未就绪/非 GET/未授权/未启用） |
| 5 | `.trae/docs/api-spec.md` §3.8.2（**2.8.0**） | 补 `GET /v1/a2a/health` 契约 + **绑定声明口径**（不声明 `supportedInterfaces`）+ 订正过时路径 `agent.json`→`agent-card.json` |

## 5. 验收

- [x] `capabilities` == `{ streaming: false, pushNotifications: false, stateTransitionHistory: false }`（如实，**三字段**）。
  > ⚠️ **后续变更（T4 批次 C，2026-10-07）**：SSE 流式实现后 `streaming` 已**如实翻为 `true`**（见 `a2a-jsonrpc-binding.md`）⇒ 本行为**当时**的验收记录。
- [x] 卡片 **不含** `supportedInterfaces` 键（D3）。
- [x] `GET /v1/a2a/health`：已装配后端 ⇒ `delegatorReady: true`；未装配 ⇒ `false`；两者均 `status:'ok'`。
- [x] 探针：非 GET ⇒ 405；未授权 ⇒ 401；未启用 ⇒ **不处理**（`handled=false`，不泄露存在性）。
- [x] `bun run typecheck` **0** · 定向 `bun test tests/http/a2aRoutes.test.ts` **19 pass** · 全量 `bun test` 绿 · `lint:arch` 违规 0（**动态跨层引用 41 不增**）。
- [x] D3 已按 (b) 实施；finding 已在 `预存错误与待处理问题.md` **A2A-1** 回写"已修"。

## 6. 合规检查清单

| 规则 | 判定 |
|---|---|
| **GR15**（Spec-Driven） | ✅ API 变更先立本 spec（D1/D2/D3） |
| **GR01**（复用） | ✅ 探针复用 `hasA2ADelegator()`（与 503 判据**同源**）；不新造就绪判据 |
| **CS01**（归一化） | ✅ 复用既有双闸（`isA2AEnabled` + `isA2AAuthorized`）与路径常量风格 |
| **CS03**（回退最小化） | ✅ 探针无缓存/心跳；D3 三选项均给出取舍，**不保留**虚报面 |
| **CS06**（证据驱动） | ✅ §1 全 file:line；A2A 规范字段集经官方 spec 核对 |
| **R06-008 / R00-001** | ✅ 不静态 import app（沿用 `A2APort` 缝）；零新增倒挂 |

## 7. 风险与边界（如实）

1. **D3 的"更深协议形状问题"已由 T4 收口（2026-10-07）**：A2A **v1.0** 把 `supportedInterfaces` 设为**必需**（且移除顶层 `protocolVersion` / `url`）。R11-3 当批只做到"**不虚报**"（撤销声明）；**T4 批次 B/C 实现 JSON-RPC + SSE** 后，**批次 D 已按 v1.0 形状如实恢复声明并移除顶层 `url`/`protocolVersion`** ⇒ **该残留关闭**（见 `a2a-jsonrpc-binding.md` / 预存 **A2A-1** 已修）。
2. **"能力协商"的完整实现仍属 T4**（JSON-RPC/SSE/扩展卡）；本批只做**字段如实化 + 探针 + 撤销虚报**，**不**声称已实现协商协议。
3. **探针的信息面**：`delegatorReady` 会暴露"后端未就绪"这一状态 —— 但该状态本已由 `POST` 的 503 暴露，**无新增泄露**。
4. **无对端可验**：本批仅**单元级**验证（卡片形状 + 探针语义），未与真实 A2A 客户端互操作。

## 8. 实施记录

**2026-10-07（R11-3）**：**D1**（`stateTransitionHistory: false`）+ **D2**（`GET /v1/a2a/health`）+ **D3**（撤销 `supportedInterfaces` 声明，用户裁定取 (b)）**全部落地**。
取证期发现的 binding 虚报（`预存错误与待处理问题.md` **A2A-1**）已随 D3 **关闭**。
门禁：全量 `bun test` **4858 pass / 21 skip / 0 fail** · `typecheck` 0 · 定向 `a2aRoutes.test.ts` 19 pass（+3 探针 +1 缺省断言）· `lint:arch` 违规 0 / 动态跨层引用 **41（未增）** · `lint:doc-code` 19 断言一致。
