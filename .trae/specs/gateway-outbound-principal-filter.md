# Spec：出站投影 SSE 的身份绑定与前置过滤（T25-01）

> 版本 1.0 ｜ 创建 2026-10-25 ｜ 状态：🟢 已实施
> 来源：`dev_docs/20261025/待完成工作任务清单-20261025.md` §2.1（v1.1，含外部评审 13 条修订）
> 触发：外部建议「SSE 长轮询管线补齐主体身份路由过滤网」——回仓取证为**真实缺口**（条件式）
> 关联：`google-ai-review-adjudication.md` §3.4（多租户数据面契约，本项**不改**该契约）· `LocalHTTPServiceSSE.ts`（同口径先例）

---

## 1. 问题与定性

`GET /v1/gateway/outbound/stream` 是四原语投影的**唯一出站订阅面**。取证结论：

| 事实 | 证据 |
|---|---|
| 建连只注册 sink，**不读身份** | `app/src/infrastructure/http/handlers/gateway-outbound-stream.ts:28-49` |
| 单订阅 → fan-out 到**全部** sink，无过滤 | `app/src/state/engine/projectionOutbound.ts:40-59` |
| 投影载荷**无归属字段** | `app/src/state/engine/projectionBroker.ts:85-99` |
| 端点已在请求身份作用域内（可拿到真实 Principal） | `app/src/infrastructure/http/LocalHTTPService.ts:435-450` |
| 鉴权由 `REQUIRE_BEARER` 覆盖（非回环/headless 必须有效 Bearer） | `app/src/infrastructure/http/requestIdentity.ts:117-164` |
| 广播开关默认关 | `packages/kernel/src/core/featureFlags.ts:433` |

**定性：条件式 P1** —— 默认部署（回环单用户）无泄露面；「非回环多租户 + `FEATURE_STATE_PROJECTION_BROADCAST=true`」时，
任一已认证租户用户可收到其他租户的投影。不是 P0（P0 判据 = 默认配置可触发）。

---

## 2. 设计（三条硬约束）

### 2.1 choke point 不得做裁决

`projectionOutbound` 的既有边界是「只搬运、不解释、不改写」（文件头 `:9-13`）。
⇒ 过滤能力由 **sink 自声明**，choke point 只机械调用：

```ts
if (sink.accept && !sink.accept(projection)) continue;
```

### 2.2 归属只在发布点取（不反查 DB）

`publishStateProjection` 用 `currentOwnerKey()` 填 `ownerKey`：

- 已认证身份 ⇒ `<tenantId>:<userId>`；
- 本地身份 / 无作用域 ⇒ 缺省（fail-closed：只投递给本地连接）。

**拒绝**「`sessionId` → 查库得归属」：① 广播是同步热路径；② `orchestration` 域载荷可只带 `orchestrationId`；
③ 既有主 SSE 已因同样理由采用作用域身份（`LocalHTTPServiceSSE.ts:182-183`）。

**已知边界（如实）**：后台 / 调度器 / 协调器发布的投影若无请求作用域 ⇒ 只到本地连接（少投，不误投）。

### 2.3 长连接不继承上下文

身份键必须在**建连时**快照进 sink 闭包；`deliver` 内**禁止**调用 `getRequestPrincipal()` / `currentOwnerKey()`。

---

## 3. 实施落点

| 文件 | 改动 |
|---|---|
| `app/src/state/engine/projectionBroker.ts` | 载荷加可选 `ownerKey`；`publishStateProjection` 填充 |
| `app/src/state/engine/projectionOutbound.ts` | `ProjectionOutboundSink.accept?`；fan-out 前机械调用 |
| `app/src/infrastructure/http/handlers/gateway-outbound-stream.ts` | 建连快照身份键；`accept` 做同键匹配 |

## 4. 验收

- 两身份交叉断言：A 的连接收不到 B 作用域发布的投影；同身份可收；
- 本地身份（无作用域）只收到本地发布的投影；
- 广播开关关 ⇒ 零事件（沿用既有用例）；
- 断开仍注销 sink；`tests/state` + `tests/http` 全绿。

## 5. 回退

- 内容级：`FEATURE_STATE_PROJECTION_BROADCAST=false`（默认）⇒ 零行为；
- 代码级：`accept` 为可选钩子，摘除实现即回到「不过滤」的历史行为。
