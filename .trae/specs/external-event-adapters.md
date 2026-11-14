# 外部事件适配器（D1）—— 立项与能力边界

> **状态**：✅ 一期已落地（2026-11-14）：webhook 入站 + 受理层（签名/去重/限速）+ 接入既有
> `SourceRegistry`；GitHub issue / 邮件轮询适配器**复用同一受理与来源**，尚未接线（见 §5）。
> **来源**：`dev_docs/20261113/建议落地方案-20261114.md` §2 波段二 **D1**。
> **关联规则**：CS01（复用既有调度/队列）、CS03（默认关 + 失败不阻断）、R02（不新建第二套队列）、
> §1.4（开关登记）、§1.6（模型可见输入必须落盘）。

---

## 1. 目标与非目标

**目标**：外部系统（webhook / GitHub issue / 邮件轮询）的事件到达后，**生成一次任务**（工作项），
并可通过既有台账审计。

**非目标**：
- 不新建调度器 / 队列 / 存储 —— 全部复用 `SourceRegistry`（幂等 + 同线程串行）、
  `ticketSink`（`trigger:<id>` 工作项）、`ticketRunConsumer`（执行领取）；
- 不做"事件 → 立即执行任意工具"：执行面沿用 `alwayson_discovery`（**只读**工具面）+ prompt 明令禁止改文件；
- 不提供公网暴露面：端点仍受传输层共享密钥/Bearer 两道门约束（回环/内网为主）。

## 2. 数据流（唯一路径）

```
POST /v1/events/external
  → ExternalEventIntake（service 层：HMAC 签名 / 大小 / 幂等 eventId / 速率窗口）
  → externalEventSource.emit → InboundEvent（threadKey = external:<threadId>，type = external_event）
  → withPolicyGate（policy.sources.external === true 才放行）
  → SourceRegistry（triggerId 幂等 / 同线程串行 / 读位点）
  → ticketSink（queued 工作项）→ ticketRunConsumer（宿主注入执行器）
```

## 3. 开关与安全

| 项 | 口径 |
|---|---|
| 启用 | `autonomy.policy.sources.external === true`（**默认 false**；未启用 ⇒ 不注册来源、端点 503） |
| 签名 | `X-Liri-Signature: sha256=<hex>` = HMAC-SHA256(`LIRI_EXTERNAL_EVENT_SECRET`, rawBody)；密钥未配置 ⇒ **503 fail-closed**（不做"无签名放行"） |
| 幂等 | `X-Liri-Event-Id` 必填；HTTP 层 TTL 去重（默认 10 min）+ `triggerId` 确定性幂等（双层） |
| 速率 | 按来源滑动窗口（默认 30 次/分钟）⇒ 429 |
| 载荷 | 必须 JSON 对象；≤ 64 KB（413） |
| 审计 | 拒绝原因结构化返回 + 日志；成功落 `trigger:<id>` 工作项（既有 ticket 台账可查） |

## 4. 验收（已达成）

- 单测（`app/tests/tasks/sources/externalEvent.test.ts`，9 例）：类型登记 / 翻译 / 未订阅不静默 /
  签名 fail-closed / 载荷校验 / 重复 409 / 限速 429（窗口滑出恢复）/ 投递失败不记账可重试。
- 验收口径：外部事件到达 ⇒ 生成一次工作项（`ticketSink`）+ 只读分析会话一轮；默认关时端点 503。

## 5. 未做 / 后续接入

1. **GitHub issue 轮询**：新增 poller（凭据 `GITHUB_TOKEN`，默认关、带 `since` 位点）→ 调
   `externalEventSource.emit`；事件类型复用 `external_event`，`payload.kind='github-issue'`。
2. **邮件轮询**：复用既有 IMAP 能力（`imapflow` 已是外部依赖）→ 同上；需单独定"哪些发件人可信"。
3. **执行面放开**：当前只读（`alwayson_discovery`）；若需"外部事件驱动写操作"，必须先接审批
   （既有 Inbox approval），不在本 spec 范围。
4. **审计增强**：目前成功路径依赖 ticket 台账 + 日志；如企业版需要，接 `EnterpriseAuditService`。
