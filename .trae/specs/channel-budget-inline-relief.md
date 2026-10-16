# Spec：通道侧「就地放行」——预算挂起卡片与按钮回调

> 版本: **1.0** ｜ 创建: 2026-10-17 ｜ 状态: **已批准（用户裁定「A + C2，先 QQ」）** ｜ 证据：`.trae/architecture/fix-evidence-registry.json` **`CHANNEL-BUDGET-INLINE-RELIEF`**
> 关联：`.trae/specs/long-task-suspend-resume.md`（挂起事实源 / 协调器 / 放行语义）· `.trae/specs/daily-budget-over-limit-ux.md`（撞限卡片 D-b/D-f）· `dev_docs/20261012/通道治理方案-20261012.md` §3 阶段 2.3（**出站 SSE 订阅面，已裁定暂缓**）与 §7「预算闸门卡片」
> 关联规则：**GR16-002**（跨模块变更须建 Spec）· **CS01**（不重复造轮子）· **CS02**（禁止字符串匹配做状态判断）· **CS03**（回退最小化 / 不掩盖错误）· **R01-007**（分层：channels 不得反向依赖 app 层）

---

## §0 问题与取证（2026-10-17）

**用户痛点**：通道（QQ/飞书）侧的会话撞上**日预算**后，用户**只能在桌面端**放行 ——「放行」这个动作没有通道内的入口。手机上的通道用户因此卡住。

**取证（只读，本仓实况）**：

| # | 事实 | 位置 |
|---|---|---|
| 1 | 通道侧**已有**「发送被拦」专用文案（含出路指引：去桌面端放行后重发） | `channels/routing/messageRouterContract.ts` 的 `BUDGET_EXCEEDED_FAILURE` / `resolveLlmFailure` |
| 2 | **运行中被挂起**（而非发送被拦）时，通道把助手侧的 ⏸ 收尾文案当普通文本投递（**桌面措辞**，无通道内动作） | `chat/ReActToolLoop` 的 `resolveTerminationOutput` → 出站文本 |
| 3 | 流内**已有结构化信号**：`finishReason='budget_exhausted'`（**非**字符串匹配内容） | `chat/ReActToolLoop.ts:2376-2377`；通道侧流消费者可见 `finishReason`（`channels/routing/streamConsumption.ts:110-137`） |
| 4 | 卡片契约**已带按钮**：`InteractiveCard.buttons[]` | `channels/types/IChannel.ts:135-144` |
| 5 | 出站**已有** `sendInteractive`（含 `interactive → markdown → text` 降级链）与现成先例 | `channels/bridge/inboxChannelReply.ts:100-152`（审批回投） |
| 6 | 会话↔通道归属**已落元数据**：`channel` / `channelSessionId` / `channelConversationId` | `channels/routing/messageRouter.ts:547-556` |
| 7 | **入站侧零「用户一次交互 → 服务端动作」通道**：全仓无卡片回调处理（`card.action.trigger` / `action.value` / `open_message_id` 均无命中），通道消息一律当**普通对话** | 全仓 grep；`channels/routing/messageRouter.ts` 是唯一入站路径 |
| 8 | **QQ 出站实现是空的**：`sendInteractiveMessage` 把卡片**拍平成 Markdown**（丢弃 `buttons`） | `channels/qq/QQChannel.ts:737-743` |
| 9 | **QQ 入站未处理交互事件**：只处理 `READY`/`RESUMED`/`C2C_MESSAGE_CREATE`；`QQEventType` 无 `INTERACTION_CREATE`；意图掩码**不含** `INTERACTION` | `channels/qq/QQChannel.ts:1108-1134`；`channels/qq/types.ts:67-82` |
| 10 | spec 原先点名的前置（通道治理**阶段 2.3**）**引用错配**：2.3 = **出站 SSE 订阅面**（供订阅状态机四原语广播），已裁定**暂缓**（理由 = CS03「无消费者不建空抽象」）；而阶段 **2.4 早已落地** | `dev_docs/20261012/通道治理方案-20261012.md` §3 阶段 2.3/2.4、§6 裁定表 |

**QQ 官方协议（外部权威，落地依据）**：
- 带按钮消息：`keyboard.content.rows[].buttons[]`，每按钮 `render_data{label,visited_label,style}` + `action{type, permission{type}, data, unsupport_tips}`；`action.type`：**0=跳转 / 1=回调（data 交后台）/ 2=指令**；`permission.type`：0 指定用户 / 1 仅管理员 / **2 所有人**。
- ⚠️ **自定义按钮属「内邀开通」能力**（模版按钮需「申请使用」）⇒ **未开通时可能发送失败**。
- 点击**回调按钮**触发 `INTERACTION_CREATE`（**Intent `INTERACTION (1<<26)`**，现有掩码不含）；事件体 `type=11`（消息按钮）、`data.resolved.button_data`（= 我们 `action.data` 的值）、`id`（interaction_id）；**必须** `PUT /interactions/{interaction_id}` 回应（`{code:0..5}`），否则客户端一直 loading。
- 来源：QQ 机器人官方文档「消息按钮」「互动事件」「互动事件响应」三页（见台账 notes 的引用）。

---

## §1 目标与非目标

**目标**：通道用户**在通道内**完成一次放行（临时提额），会话自动续跑；且**任何情况下**用户都能收到「发生了什么 + 怎么办」。

**非目标（本片不做）**：
- **不**建「出站 SSE 订阅面」（通道治理阶段 2.3，维持暂缓）——本片走**流内信号**（事实 #3），不需要它。
- **不**做文本口令（如「继续」字样触发动作）：与对话语义纠缠、易误判（用户真想说"继续"时会被吞）。
- **不**改桌面端卡片与放行链语义（复用 `POST /v1/cost/daily-budget/relief` 的**服务层** `applyRelief(input, targetSessionId)`；额度语义不变）。
- **不**覆盖 guard 挂起（放行不唤醒）与 `'loop'`（窗口预算）。

---

## §2 设计（三层，依赖方向全部向下）

### D1 文案对齐（A）——**两种出路分清**

| 场景 | 现状 | 本片 |
|---|---|---|
| **发送被拦**（闸门在轮首拒绝） | 通道回 `BUDGET_EXCEEDED_FAILURE`（说明原因 + 出路） | 保留；补一句「放行后**重发本条消息**即可继续」的**通道内**版本（有按钮时指向按钮） |
| **运行中被挂起**（长任务跑到一半撞限） | 助手 ⏸ 文案（桌面措辞）当普通文本投递 | 新增**通道侧挂起文案**（同一个 `finishReason` 判据，非字符串匹配）：说明"进度已保存 / 放行后**自动续跑、无需重发**"，并指向下方按钮（无按钮能力时说明去桌面端/用量中心） |

### D2 出站：挂起卡片（C2-out）

- **触发点**：`channels/routing/messageRouter.ts` 流式消费完成后，`finishReason === 'budget_exhausted'` 分支（**结构化判据**，守 CS02）。
- **发送**：新增 `channels/bridge/budgetReliefCard.ts`，与 `inboxChannelReply` **同构**：`channelRegistry` 取 outbound → `sendInteractive(target, card)` → 失败降级 `sendMarkdown` → `sendText`；`isReplyEnabled()` 同门控。
- **按钮**（两个）：`临时提额`（`kind='boost'`）、`今日解除`（`kind='unlock-today'`）；按钮载荷 `data` 为**自描述 JSON 字符串**：`{"a":"budget-relief","k":"boost","s":"<chatSessionId>"}`（**带上会话 = 唤醒收窄**，复用 v1.11 的 `sessionId` 口径）。
- **风险与降级（守 CS03）**：QQ 自定义按钮属内邀能力 ⇒ 带 `keyboard` 发送**若失败**，**自动以纯 Markdown 重发同一文案**（不静默、记 warn）⇒ 任何权限状态下用户都能收到消息。
- **去重**：同一 `sessionId + 事件` 不重复发卡（按会话维度的一次性标记；重启即清，属可接受语义）。

### D3 入站：按钮回调（C2-in）

- **QQ**：`QQEventType` 增 `INTERACTION_CREATE`；意图掩码增 `INTERACTION (1<<26)`；`switch (payload.t)` 增分支 → 新文件 `channels/qq/interactionEvents.ts`（仿 `inboundEvents.ts` 拆分风格）：
  1. 仅处理 `type===11`（消息按钮）与 `d.data.resolved.button_data`；
  2. 解析 `data`（必须能解析且 `a==='budget-relief'`，否则忽略并记 warn —— **不猜**）；
  3. 调**注入的动作端口**（见 D4）→ 得 `{code, toast?}`；
  4. **无论如何** `PUT /interactions/{id}` 回应（`{code}`）——否则客户端一直 loading。
- **校验（守边界）**：`button_data` 自带 `sessionId` ⇒ **服务端仍须复核**该会话**确实处于挂起态**（防伪造/陈旧按钮），且按 `kind` 走既有放行语义。
- **幂等**：重复点击 ⇒ 协调器已 release ⇒ `woken:[]`（既有 E2E-2 定案）⇒ 回应 `{code:3}`（重复操作）。

### D4 接缝：注入的动作端口（守住分层 R01-007）

`channels` **不得** import `query/**`（反向依赖）。故：

```ts
// channels/bridge/budgetReliefAction.ts（channels 内部）
export type BudgetReliefActionHandler = (req: {
  sessionId: string;
  kind: 'boost' | 'waive-once' | 'unlock-today';
}) => Promise<{ ok: boolean; code: 0|1|2|3|4|5; message?: string }>;
export function setBudgetReliefActionHandler(h: BudgetReliefActionHandler | null): void;
```

- **组合根**（`entrypoints` / `main.ts` / `bootstrap`）注册实现：内部读协调器 `isSuspended(sessionId)`（**复核**）→ `getDailyBudget().applyRelief({kind, ttlMs…}, sessionId)` → 返回 code。
- 未注册 ⇒ 记 warn 并回 `{code:1}`（**不静默**，守 CS03）。
- 先例：`ChatManager` 注入 `coordinator.setResumeHandler`、`ChatBootstrapDeps.installBudgetSuspendResume`。

---

## §3 边界与不做（如实）

1. **平台覆盖**：本片**只做 QQ**（用户实际在跑的通道；日志 `channels:1`）。飞书出站按钮**已实现**（`FeishuChannel.ts:569-578`），但其入站回调（`card.action.trigger`）**未做**；其它 11 个实现 `sendInteractiveMessage` 的通道同理。
2. **QQ 按钮依赖平台开通**（自定义按钮属「内邀」）：未开通时本片**降级为纯文案**（用户仍能看到出路，只是不能在通道内点）。
3. **真机端到端不可自动化**：按钮点击必须**真人在 QQ 客户端**点 ⇒ 本片交付到「单测（合成回调载荷）+ 协议合规发送」；真机验证需用户配合点一次。
4. **`guard` 挂起 / `'loop'` 窗口预算**不在本片入口覆盖面内。
5. **去重标记为进程内**：重启后同一挂起点可能再发一次卡（不影响正确性；若成为噪音再收敛）。

---

## §4 验收

| # | 判据 |
|---|---|
| 1 | 通道侧两态文案可断言（**发送被拦** vs **运行中被挂起**），且文案不含"重发"与"自动续跑"的混淆（挂起态**不得**要求重发） |
| 2 | `finishReason==='budget_exhausted'` ⇒ 发卡（带 2 个按钮、`data` 含 sessionId）；非该 finishReason **不发** |
| 3 | 带 `keyboard` 发送失败 ⇒ **纯 Markdown 重发**成功（负向自证：失败路径也必须让用户收到消息） |
| 4 | QQ `INTERACTION_CREATE(type=11)` ⇒ 解析 → 注入端口被调用（含 sessionId/kind）→ **回应** `PUT /interactions/{id}` |
| 5 | 非法/伪造 `button_data` ⇒ **不调**放行，但仍**回应**（不静默丢事件） |
| 6 | 未注册动作端口 ⇒ 回 `{code:1}` + warn（不静默） |
| 7 | 未挂起会话的按钮 ⇒ 不误放行（复核判据） |
| 8 | `lint:arch` 分层 0 违规（channels 无反向依赖） |
