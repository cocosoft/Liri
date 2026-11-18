# 外部事件适配器（D1）—— 立项与能力边界

> **状态**：✅ 一期已落地（2026-11-14）：webhook 入站 + 受理层（签名/去重/限速）+ 接入既有
> `SourceRegistry`；GitHub issue 轮询**已接线**（2026-11-18，默认关）；邮件轮询**用户裁定暂不做**（见 §5）。
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

1. ~~**GitHub issue 轮询**~~ → **2026-11-18 已接线（默认关）**：`app/src/tasks/sources/githubIssuePoller.ts`
   - 开关：`autonomy.externalPollers.github = { enabled: true, repos: ['owner/repo'], intervalMs? }`
     + `GITHUB_TOKEN`（**无 token ⇒ 不启动**，不做匿名轮询）；默认值 = 关；
   - 链路：`pollOnce → externalEventSource.emit`（`eventId = github-issue:<repo>#<id>`，
     `threadId = github-issue:<repo>#<number>`，`payload.kind='github-issue'`，只带
     `kind/repo/number/title/url/state/createdAt`）；
   - `since` 位点为**进程内**：重启从启动时刻重新开始（不补发），重复由 `eventId` + `triggerId` 幂等兜住；
   - **拉取语义（2026-11-18 自查修正）**：GitHub 的 `since` 按 **`updated_at`** 过滤 ⇒ 必须配
     `sort=updated&direction=asc`（原写 `sort=created` 会让"老 issue 刚被更新"挤占首页、新 issue 落到后页
     而**漏事件**）；并分页（50/页、最多 5 页）直到不满一页；
   - 失败语义：单 repo 拉取失败只记日志、**不推进位点**（下一拍用旧 `since` 重试）；
   - 回归：`app/tests/tasks/sources/githubIssuePoller.test.ts` 11 例（配置边界 / 翻译 / 拍次 / 不推进位点 / start-stop / 拉取语义与分页 / 非 2xx 抛错）。
2. **邮件轮询**：**2026-11-18 用户裁定：暂不做**（不是"顺手接一下"，两处硬前置本就未解）：
   - **口径未定**：必须能声明「哪些发件人可信」。落地形态建议 `autonomy.externalPollers.email.senders`
     （**空 ⇒ 不启动**，与 GitHub 侧"无 token 不启动"同惯例），但名单本身要产品给；
   - **架构位置未定**：增量读取能力在**办公域**（`app/packages/office/email/EmailReader.ts`），
     现有 API 只有 `inbox(limit)` / `search(query, limit)`，**没有 UID / since 增量接口**。
     两条路各有代价：① 在 office 侧补 `readSince(uid)` 并把轮询器放 office（能力内聚，但要动办公域）；
     ② 复用 `inbox(limit)` 全量拉取 + 靠 `eventId` 幂等去重（零新增能力，但每拍重复读最近 N 封）。
   - **重开条件**：出现真实"邮件触发任务"需求，且同时确认 ① 可信发件人名单 ② 归属域（office vs tasks/sources）。
     GitHub issue 侧不受影响，仍为**已接线、默认关**。
3. **执行面放开**：当前只读（`alwayson_discovery`）；若需"外部事件驱动写操作"，必须先接审批
   （既有 Inbox approval），不在本 spec 范围。
4. **审计增强**：目前成功路径依赖 ticket 台账 + 日志；如企业版需要，接 `EnterpriseAuditService`。
