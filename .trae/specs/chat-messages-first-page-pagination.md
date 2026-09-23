# Spec：聊天消息首屏分页（压缩 `GET /v1/sessions/:id/messages` 响应体）

- **状态**：**已实施并验证**（2026-09-20 立项 → 同日第 1 步复核定案 → 实施 → 三轮端到端验证）
- **关联台账**：N-55（长会话读性能）、N-56（分页结果污染会话缓存）、N-57（`_paginateMessages` 两处缺陷）、N-58（刷新恢复路径未分页）
- **触发背景**：N-52 修复后读源切为事件派生，实测长会话响应体 **742,306 B**（192 条消息）；客户端端到端 38–82ms 中，服务端业务逻辑仅 ~5–9ms，**残余主要在传输 + 客户端解析**。

## 1. 已核实证据（实施前必须成立的前提）

| 事实 | 证据 |
|------|------|
| 后端分页**已具备** | `CoreAPIImpl._paginateMessages(messages, {limit, before})`：`key = lastEventSeq ?? timestamp`；`hasMore = filtered.length > limit`；`page = slice(length - limit)` |
| 前端截断**不减响应体** | `MAX_INLINE_RESULT_LENGTH = 2000` 仅在 `client/src/stores/chat/chat-message-shared.ts` 定义，消费方为 `chat-message-set-messages.ts:249`、`deriveConversationBlocks.ts:471`（渲染层 + `_hasFullResult` 标记） |
| 体积结构 | 192 条 / 742,306 B；最大 `assistant` **84,389 B / 168 blocks**；`tool` 单条 **57,805 B**；**块文本合计仅 42,261 B、最大单块 4,564 B** ⇒ 体积 = 块数量 × 每块结构开销 + 少量超大工具结果 |
| 前端 `getMessages` 调用点（4 处） | `hooks/useNotificationSSE.ts:25`、`services/sessionService.ts:765`（内部兜底）、`components/ChatArea/InboxBlock.tsx:94`、`components/ChatArea/SessionHeader.tsx:212` |

### 1.1 第 1 步复核结论：聊天主链路取数入口（2026-09-20 定案）

```
用户点侧栏会话
  → switchChatSession()                        sessionSlice.ts:945
    ├─ chatCoordinator.stopAndFlush()          :970
    ├─ sessionService.switch(id)               :988
    ├─ _getCachedMessages(id)                  :1006   ← 缓存命中分支
    │   └─ sessionService.loadConversation(id) :1013   ← 原未传 limit（缺口 G1）
    └─ chatCoordinator.loadMessages(msgs)      :1032 → chat store setMessages

整页刷新后自动恢复当前会话
  → loadChatSessions() 补拉分支                 sessionSlice.ts:660-691
    └─ sessionService.loadConversation(id)     :670    ← 原未传 limit（缺口 N-58，实施中追加）
```

**原 Spec 假设"前端分页链路缺失"经核对不成立** —— 分页能力（service 透传 / `MESSAGE_PAGE_LIMIT` / `loadOlderMessagesImpl` / 顶部按钮）**均已存在**；真正缺的是**两条加载路径都没有传 `limit`**，且主链路**从不设置 `hasOlder`**。

## 2. 目标与非目标

**目标**：会话打开（切换 / 刷新恢复）只取最近一页，使长会话首屏响应体大幅下降；用户可加载更早，**信息不丢失**。

**非目标**：不改后端分页**语义**（但修了实现缺陷，见 §4）；不改派生缓存（N-55）逻辑；不做服务端结果截断（另一方向，未采用）。

**分页尺寸决策**：复用既有常量 `MESSAGE_PAGE_LIMIT`（**不新增** `FIRST_PAGE_SIZE`），两条加载路径统一用它，改尺寸只需改这一处（CS01 归一化）。**取值 30**（2026-09-20 由原值 100 下调：100 条首屏仍达 380KB，30 条为 120KB；代价是更长会话需多次"加载更早"，属有意取舍）。

## 3. 改动方案（实际落地，4 处）

1. **G1 + G2** `client/src/stores/root-store/sessionSlice.ts` `switchChatSession`：
   - 缓存未命中：`loadConversation(id, { limit: MESSAGE_PAGE_LIMIT })` + **在 `loadMessages` 之前** `setHasOlder(hasMore)` / `setOldestSeq(messages[0].lastEventSeq)`
   - 缓存命中：`setHasOlder(false)` / `setOldestSeq(null)`（缓存仅存完整会话，见第 3 条）
2. **N-58** 同文件 `loadChatSessions` 补拉分支：同样传 `limit`，并同步 `hasOlder` / `oldestSeq`（缓存命中分支置 `false` / `null`）
3. **N-56** 缓存只存完整会话：
   - `client/src/services/sessionService.ts`：`setSessionCache` 仅当 `options?.limit == null` 时执行
   - `client/src/stores/chat/chat-message-set-messages.ts`：缓存写入增加 `!get().hasOlder` 守卫
4. **分页游标**（实施中追加的关键修正）：`MessageSlice` 新增 `oldestSeq: number | null`（**后端分页边界**），`loadOlderMessagesImpl` 改用它作为 `before`，并在前插后更新为更早那页的首条；前插前按 id 去重。
   - **为何必须新增字段**：原先用 `store.messages[0].lastEventSeq`，但 store 列表经 tool 结果吸收（进 blocks）与连续 assistant 合并后，首条已不是后端第一页的首条 —— 实测游标偏后（发 `2193` 而非 `1477`），导致"更早一页"与当前页大面积重叠且 `hasMore` 恒 true。

**不动**：流式/新消息路径、后端 `limit` 语义、其他全量调用点（4 处 `getMessages` 与 `loadConversation` 的 legacy 兜底均不传 limit）。

## 4. 实施中发现并修复的相邻缺陷

| 编号 | 缺陷 | 修复 |
|------|------|------|
| N-57 | `_paginateMessages` ①`filtered.length <= limit` 时 `slice(负数)` 只回尾部若干条（实测 92 条只回 8 条、hasMore=false ⇒ 84 条永久不可达）；②排序键 `lastEventSeq` 有重复值（同轮多消息共享 seq，实测 3 对）时用 `<` 会丢条 | ① `hasMore ? slice(len - limit) : filtered`；② 改 `<=`（保证不丢），边界重复 1 条由前端按 id 去重消除 |
| N-56 | 分页结果被写入会话缓存 ⇒ 切走再切回命中残缺列表、更早历史不可达 | 缓存语义收敛为"仅完整会话"（2 处守卫） |
| N-58 | 刷新后自动恢复会话的主路径不传 limit ⇒ 刷新首屏仍全量 | 补拉分支与切换路径统一传 limit |

## 5. 验证结果（2026-09-20，全部通过）

- **V1 体积**：长会话 `session_mtsohqjn2l3r2oj1lj9`（192 条）首屏 **`?limit=30` → 30 条 / 123,175 B**（相对 `limit=100` 时的 380,426 B 再降 67.6%，相对全量 742,528 B 降 **83.4%**）、`hasMore=true`；7 页拉全（30×6 + 18 条）。
- **V2 正确性（数出同源）**：分页拉全后累计 **192 = 全量 192**，`unique=192`、`onlyInFull=0`、`onlyInAcc=0`、**`orderDiff=0`**（`limit=100` 与 `limit=30` 各验一次；后者 7 页、`rawAcc=198` ＝ 192 + 6 条边界重复，去重后吻合）；边界场景 `limit=188/189/190/191`（游标落在同 seq 对处）同样 `final=192 / orderDiff=0`。
- **V3 交互（浏览器只读实测）**：
  - （`MESSAGE_PAGE_LIMIT=100` 阶段）首屏请求 `GET …/messages?limit=100`，`count=100 / hasMore=true`，顶部出现「↑ 加载更早消息」；
  - （同上阶段）点击后发出 `?limit=100&before=1477`（＝后端第一页首条 seq），返回 93 条（含边界 1 条 ⇒ `overlap=1`）、`hasMore=false`、**按钮消失**（元素计数 0）、DOM 无重复 id、`100+93-1=192` 吻合；
  - 切走再切回：不再命中残缺缓存（改走分页首屏），按钮与消息均正常（N-56 回归通过）；
  - **连续加载（`limit=30`，192 条需 7 页）**：`before` 严格递减 `2990 → 2369 → 1890 → 1316 → 465 → 60`，无重复 URL、无死循环，第 6 次点击后 `hasMore=false` 且按钮消失（元素计数 1→0）；`30×6+18 = 198`，逐页边界各重复 1 条（共 6）⇒ `198-6 = 192` 口径闭合；已挂载 DOM 节点无重复 id（虚拟化限制：任一时刻仅 13–22 节点挂载）。
- **V5 边界**：短会话（2 条）/ 空会话（0 条）`hasMore=false`，无"加载更早"入口。
- **V4 回归**：app `typecheck` **EXIT=0**、全量 `bun test` **2856 pass / 19 skip / 0 fail**；client `typecheck` **EXIT=0**、vitest **26 文件 / 244 例全通过**（含同步补齐测试替身 `setHasOlder` / `setOldestSeq`）。

## 6. 回滚

- 去掉两条加载路径的 `limit` 传参即恢复"全量加载"行为（`oldestSeq` / `hasOlder` 守卫可独立保留，非分页路径下与修复前等价）。
- N-57 的后端两处修复**不应回滚**（`<` + 负索引会丢条）。

## 7. 已知残留（如实登记）

1. `_paginateMessages` 无单测（private + 无测试先例），回归保护由 §5 的接口层脚本（5 组 limit 比对）承担。
2. 分页路径每次切换会话都会重新拉首页（因分页结果不入缓存）—— 这是 N-56 方案选择的既定取舍：**正确性优先于缓存命中率**。若后续要恢复命中率，需让缓存携带 `hasOlder` / `oldestSeq`。
3. `<=` 会使每页多返回 1 条边界消息（由前端去重消除）—— 实测 `limit=30` 拉全 192 条共多传 **6 条**；若边界恰为超大工具结果（KB 级），存在微小传输浪费，未优化。
4. 页大小 30 的取舍：首屏体积降 83.4%，但 192 条的会话需 6 次"加载更早"；若要减少点击次数，上调 `MESSAGE_PAGE_LIMIT` 一处即可（两条加载路径同步生效）。
5. 浏览器验证中观察到 `模型 … 的供应商未找到或未启用`（与本 Spec 无关，已登记 **N-59**），以及首屏加载疑似出现两条 `before=null` 的 `loadConversation` 日志（间隔 23ms，网络层未确认，已登记 **N-60**）。
