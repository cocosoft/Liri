# Spec：通道侧「就地放行」——预算挂起卡片与按钮回调

> 版本: **1.2** ｜ 创建: 2026-10-17 ｜ 状态: **已批准（用户裁定「A + C2，先 QQ」；v1.1 扩第二平台：飞书入站；v1.2 收尾去重）** ｜ 证据：`.trae/architecture/fix-evidence-registry.json` **`CHANNEL-BUDGET-INLINE-RELIEF`** · **`CHANNEL-RELIEF-BUTTON-GATE`** · **`CHANNEL-RELIEF-CARD-COPY-DEDUPE`**
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
| 11 | **飞书出站按钮已实现**（`value: {key:'action', value:<载荷>}`），但**入站只处理消息事件**（`im.message.receive_v1` / `type==='event_callback'`）—— WS 与 webhook 两条路都**没有**卡片回传分支 | `channels/feishu/FeishuChannel.ts`（`handleWsMessage` / `startWebhook`） |
| 12 | 飞书默认走 **webhook**（`useWebSocket:false`，端口 8083）⇒ 卡片回传落在**同地址**的 HTTP 回调上 | `channels/feishu/config-schema.ts` |

**飞书官方协议（外部权威，v1.1 落地依据）**：
- **新版回调** `card.action.trigger`：体 = `{schema:'2.0', header:{event_type:'card.action.trigger', token, app_id…}, event:{operator, token, action:{value,tag}, context:{open_message_id, open_chat_id}}}`；`action.value` 类型 = **string 或 object**（开发者自定义）。
- **旧版回调** `card.action.trigger_v1`：体 = **扁平**（**无** `type`/`event` 包裹）：`{open_id, user_id, tenant_key, token, open_message_id, action:{value,tag,…}}`。
  ⚠️ 本仓飞书**出站卡片用旧版结构**（`header/elements/action/actions`）⇒ **两版体都必须认**（只按新版写会收不到本仓自己的卡片点击）。
- **响应**：业务端须在 **3 秒内** HTTP **200** 响应，**不得**用 3xx；响应体 = `{toast:{type,content}}`（不回 `card` ⇒ **保持原卡片**）。
- 来源：飞书开放平台「卡片回传交互回调」（`open.feishu.cn/document/feishu-cards/card-callback-communication`，最后更新 2026-05-09）与「旧版回调结构」（`open.larkoffice.com/document/deprecated-guide/message-card/configuring-card-callbacks/card-callback-structure`）。

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
- **按钮按「入站已接线」白名单给**（2026-10-17 收口，台账 `CHANNEL-RELIEF-BUTTON-GATE`）：`BUTTON_CAPABLE_CHANNELS`（当前 = `qq` / `feishu`）**之外**的通道**不建卡**，改发**无按钮**文案（含桌面端出路）。理由：实现 `sendInteractive` 的通道有 12 个，而**入站回调已接线**的只有白名单内那些 ⇒ 对「出站能发、入站没接」的通道给按钮 = 用户点了**毫无反应**（**比没有按钮更糟**）。新增通道须**同时**接完出站与入站后再把 id 加进来（守 CD05 次序）。
- **正文与卡片去重，且纯文本不露 Markdown**（v1.2，台账 `CHANNEL-RELIEF-CARD-COPY-DEDUPE`）：内核在挂起收尾时会把 `⏸ …` 提示块**追加到正文**（`ReActToolLoop.resolveTerminationOutput`），与本卡文案同源 ⇒ 真机（QQ 2026-10-17 09:56）同一条说明发了**两遍**，且纯文本路径把 `**` 星号明文露出。故出站顺序改为「**先发卡**，再决定文本」：
  - 卡片**投递成功** ⇒ 用 `splitSuspensionNotice`（只认**行首 `⏸` / `\n\n⏸` 结构标记**，不解析文案，守 CS02）剥掉提示块，只投递模型正文；正文为空 ⇒ **跳过文本投递**（`[TRACE]` 留痕）。
  - 卡片**未投出**（通道不支持 / 发送失败 / 同会话已发过去重）⇒ 文本必须承载出路，并用 `stripBoldMarkers` 去掉 `**`（QQ `sendText` 不渲染 Markdown）。
  - ⚠️ 契约：内核提示块的**行首 `⏸`** 是分割标记（`SUSPENSION_NOTICE_MARKER`）；改文案时不得删。

### D3 入站：按钮回调（C2-in）

- **QQ**：`QQEventType` 增 `INTERACTION_CREATE`；意图掩码增 `INTERACTION (1<<26)`；`switch (payload.t)` 增分支 → 新文件 `channels/qq/interactionEvents.ts`（仿 `inboundEvents.ts` 拆分风格）：
  1. 仅处理 `type===11`（消息按钮）与 `d.data.resolved.button_data`；
  2. 解析 `data`（必须能解析且 `a==='budget-relief'`，否则忽略并记 warn —— **不猜**）；
  3. 调**注入的动作端口**（见 D4）→ 得 `{code, toast?}`；
  4. **无论如何** `PUT /interactions/{id}` 回应（`{code}`）——否则客户端一直 loading。
- **飞书**（v1.1，第二平台）：新增 `channels/feishu/cardActionPayload.ts`（**纯函数**：识别体式 + 取载荷 + 造回执）：
  1. **两版回调体都认**（本仓出站卡片是**旧版结构** ⇒ v1 必认）：新版 `header.event_type==='card.action.trigger'`（含长连接帧内 `data.type` 同值形态）/ 旧版**扁平**体（判别锚点 = 顶层 `open_message_id`）；**不抢**消息事件与 URL 校验路径（单测覆盖 7 类反例）。
  2. 载荷取法：平台允许 `value` 为 string **或** object ⇒ 本仓出站形态（`{key:'action', value:<载荷>}`）取**内层**；其余对象 `JSON.stringify` 后交**同一**解析入口（宁拒不猜）。
  3. **Webhook（飞书默认模式）**：同地址**先分流**，3 秒内回 HTTP **200** + `{toast}`（**不回** `card` ⇒ 保持原卡），禁 3xx。
  4. **长连接帧**：只**应用动作**、帧内**不回** toast —— 原始 WS 帧的应答契约未获权威文档 ⇒ **不伪造 ack**（如实边界；代价 = 客户端可能提示超时，但放行已生效）。
  5. 复用**同一** `handleBudgetReliefAction` 端口（与 QQ 同源，不各平台各写一套放行逻辑）。
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

1. **平台覆盖**：QQ（真机跑通过入站链路）+ 飞书（v1.1 接线，**单测级**）两台已「出站 + 入站」都接完并进 `BUTTON_CAPABLE_CHANNELS`；其余 **10** 个实现 `sendInteractiveMessage` 的通道**未做** ⇒ 白名单外**不发按钮**，只发**无按钮**文案。
2. **飞书验证级别与残留风险**：本机飞书**未配置/未启用** ⇒ v1.1 证据 = 单测级（两版回调体识别 + **不抢**消息路径 + 回执体 + 与 QQ 同源），`e2eVerified=false`。长连接模式的**帧应答契约**无权威文档 ⇒ 该模式只应用动作、不回 toast（见 D3-4）。⇒ 若日后真机出现「点了没反应」，**先**核对该应用订阅的回调版本与接收模式（webhook / 长连接），再改代码。
3. **QQ 按钮依赖平台开通**（自定义按钮属「内邀」）：未开通时本片**降级为纯 Markdown 重发**（用户仍能看到出路，只是不能在通道内点）。
4. **真机端到端不可自动化**：按钮点击必须**真人在客户端**点 ⇒ 交付到「单测（合成回调载荷）+ 协议合规发送」；真机验证需用户配合点一次。
5. **`guard` 挂起 / `'loop'` 窗口预算**不在本片入口覆盖面内。
6. **去重标记为进程内**：重启后同一挂起点可能再发一次卡（不影响正确性；若成为噪音再收敛）。

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
| 9 | 飞书**两版回调体**（v2 `header.event_type` / v1 **扁平** / 长连接帧两形）均能取出载荷；且**不抢**消息事件与 URL 校验（7 类反例 ⇒ 全 `null`） |
| 10 | 飞书回执体 = `{toast}` 且**不含** `card`（保持原卡片）；成功/失败文案**如实**（失败含端口给出的原因） |
| 11 | 飞书按钮载荷 ⇒ 走**同一** `handleBudgetReliefAction` 端口（与 QQ 同源）；非本动作载荷 ⇒ 非零码且**不调用**端口 |
| 12 | `BUTTON_CAPABLE_CHANNELS` 之外（如 `slack`）⇒ 发**无按钮**文案、**零** `sendInteractive` 调用（防「假按钮」） |
| 13 | 挂起且**卡片投递成功** ⇒ 正文里的 `⏸ …` 提示块被剥掉；若正文只剩提示块 ⇒ **不再投递文本**（同一条说明不发两遍） |
| 14 | 挂起且**卡片未投出** ⇒ 文本兜底保留完整出路，且**不含** `**`（纯文本通道不渲染 Markdown） |

---

## §5 变更记录

| 版本 | 日期 | 变更 | 依据 |
|---|---|---|---|
| **v1.2** | 2026-10-17 | 出站改为「先发卡、再定文本」：卡片成功 ⇒ 剥 `⏸` 提示块/空则跳过文本；失败 ⇒ 去 `**` 保留出路；新增 8 例单测 | 用户上传 QQ 真机截图（同一条说明发两遍 + 星号外露）⇒ 台账 `CHANNEL-RELIEF-CARD-COPY-DEDUPE` |
| v1.1 | 2026-10-17 | 飞书入站接线（两版回调体 + `{toast}` 回执 + 白名单扩充） | 台账 `CHANNEL-RELIEF-FEISHU-INBOUND` / `-WEBHOOK-INTEG` |
| v1 | 2026-10-17 | 初版（文案两态 + 挂起卡片 + QQ 按钮回路） | 用户裁定「A + C2，先 QQ」 |
