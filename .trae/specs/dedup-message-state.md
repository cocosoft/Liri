# Spec：Dedup 消息处理态模型（PR4 子 spec）

> 版本 1.1 ｜ 创建 2026-10-09 ｜ 状态：**S1 已实施；①处理态落盘（⑨）已补齐**
> **来源**：`dev_docs/20261009/任务计划.md` §3-B4（PR4）· 主 spec `.trae/specs/execution-lifecycle-ownership.md`（§3-PR4 / §8-PR4）
> **关联规则**：GR15（Spec-Driven）· CS01（归一化先查已有）· CS02（状态禁字符串匹配）· CS03（回退最小化）· CS05（根因优先）· `project_rules.md` §1.6（Write-Ahead / 可重建）

---

## 1. 问题（根因）

去重模块（`app/src/channels/dedup/index.ts`）用**两个互相重叠的结构**表达"消息是否已处理"：

| 结构 | 语义（实际） | 缺陷 |
|---|---|---|
| `inflightMessages: Set<messageId>` | 正在处理占用（claim 锁） | 无 TTL（崩溃后永久残留） |
| `processedMessages: Map<messageId, expiresAt>` | "已处理"（**仅成功时写入**） | **boolean 语义**，把"已接收"与"已完成"混为一谈 |

**根因（CS05）**：因为"已处理"只在成功后写入，**超时**（未成功）无法用真实语义表达，只能**伪造**为"已处理"
（`messageRouter.ts` 的 `markMessageProcessed`@timeout，E3）。这既是 CS02（用 bool 状态替代枚举语义）的表现，
也让"接收态"与"执行完成态"无法解耦（PR2 遗留项因此一直挂着 `TODO: CS05-ROOTFIX`）。

**证据**：`dedup/index.ts:56/59`（两结构）；`messageRouter.ts:1162`（超时补标记）；任务计划 §1-E3/E12。

---

## 2. 范围决策（§2）

- **做**：把消息处理态收敛为**单一状态图** `RECEIVED / ADMITTED / REJECTED`，删除超时处的"伪造已处理"补标记。
- **不做**：**持久化**（DB / 重启恢复）——属 **PR5 Durable Execution**（验收 ⑨ 依赖它）。本子 spec 仅收敛**内存语义模型**。
- **不做**：重命名/新增对外行为——本改动**行为等价**（见 §3 对照表），仅语义更准确。

---

## 3. 设计

### 3.1 状态（唯一事实源）

```ts
export const MESSAGE_PROCESSING_STATES = ['RECEIVED', 'ADMITTED', 'REJECTED'] as const;
export type MessageProcessingState = (typeof MESSAGE_PROCESSING_STATES)[number];
```

单一存储：`messageStates: Map<messageId, { state: MessageProcessingState; expiresAt: number }>`（替代原两结构）。

| 状态 | 含义 | 去重（claim 再入）判定 |
|---|---|---|
| `RECEIVED` | 已接收并认领，**处理中**（未出结果） | `inflight` |
| `ADMITTED` | 已接收且**成功**处理完成 | `duplicate` |
| `REJECTED` | 已接收但**未成功**（超时等），保留 TTL 窗口内**阻断重传**（防重复计费） | `duplicate` |

> **阻断集 = {RECEIVED, ADMITTED, REJECTED}**（任一存活记录都阻断同一 `messageId` 的再入）。
> 语义澄清：Dedup = "这条 inbound Message 是否**已接收**"（含其已知结局），≠ "Agent 是否成功完成"。

### 3.2 API 与映射（行为等价）

| API | 原实现 | 新实现 | 行为差异 |
|---|---|---|---|
| `claimMessage(id)` | `isMessageProcessed` + `tryBeginProcessing` | 查存活记录：`RECEIVED`→`inflight`；`ADMITTED`/`REJECTED`→`duplicate`；无→写 `RECEIVED` 并 `claimed` | **等价**（原 `inflight` 集合无 TTL ⇒ 现 `RECEIVED` 有 TTL，属**改进**：崩溃残留可过期） |
| `finalizeMessage(id, claimHeld)` | 写 `processedMessages` + 删 `inflight` | 置 `ADMITTED` | **等价** |
| `releaseProcessing(id)` | 删 `inflight` | **删记录**（释放 claim，允许后续重试） | **等价** |
| `markMessageProcessed(id)` | 写 `processedMessages` | 置 `ADMITTED`（仅 `finalizeMessage` 内部使用） | **等价** |
| **`rejectMessage(id)`（新增）** | —（原以 `markMessageProcessed` 冒充） | 置 `REJECTED` | **取代**超时补标记（E3 根修） |
| `isMessageProcessed(id)` | 查 `processedMessages` | 查**存活记录**（任意状态） | 等价（内部/兼容用） |
| `getDedupStats()` | `processed`/`inflight`/`expired` | `processed`=ADMITTED+REJECTED；`inflight`=RECEIVED；`expired` 不变 | 语义更准 |

### 3.3 调用点接线（`messageRouter.ts`）

| 路径 | 现 | 新 |
|---|---|---|
| 成功 | `finalizeMessage(id, true)` | 不变（→ `ADMITTED`） |
| 内容去重 / 限流 | `releaseProcessing(id)` | 不变（释放 claim） |
| 通用异常（含 LLM 错误） | `releaseProcessing(id)` | 不变（**保留既有"允许重试"行为**） |
| **空转超时** | `markMessageProcessed(id)`（**伪造已处理**） | **`rejectMessage(id)`**（真实语义：已接收、未成功、阻断重传） |

> **为什么不是"claim 即永久阻断"**：本版刻意**不改变**通用异常路径的"允许重试"行为（CS03：不静默改变既有行为）。
> 仅把**超时**从"伪造已处理"改为"真实 REJECTED"——两者对**阻断**的效果一致（行为等价），但语义不再说谎。

---

## 4. 规则合规 Checklist

| 规则 | 落点 |
|---|---|
| CS01 归一化 | 复用既有 dedup 模块单例；**不新建**第二套去重；两结构收敛为一 |
| CS02 禁字符串/布尔状态 | 处理态由 `boolean`（伪装）→ **枚举**；超时不再靠"是否已处理"暗示 |
| CS03 回退最小化 | 通用异常路径**保持**"允许重试"；不新增兜底 |
| CS05 根因优先 | 直接消除"已接收 vs 已完成"混淆（E3 根因），非贴补丁 |
| GR15 Spec-Driven | 本子 spec 先于实现 |
| §1.6 可重建 | ⚠️ 本版仍为**内存态**；持久化（可重建）属 PR5，本 spec 不声称满足 ⑨ |

---

## 5. 验收

- **A1 行为等价**：成功 ⇒ `ADMITTED`；超时 ⇒ `REJECTED`；两者在 TTL 内均阻断同 `messageId` 重传；通用异常 ⇒ 无记录（可重试）。
- **A2 E3 根修**：`messageRouter` 不再调用 `markMessageProcessed` 于超时路径；改 `rejectMessage`。
- **A3 单测**：状态转移（claim→RECEIVED；finalize→ADMITTED；reject→REJECTED；release→删）+ 再入判定（RECEIVED→inflight；ADMITTED/REJECTED→duplicate）。
- **A4 回归**：`tests/channels` 全绿（含既有 PR1/PR2/PR4 用例）。

> ⑨（重启后 `messageId` 不重复执行）**已于 2026-10-09 随 PR5 完成后补齐**（见 §7）。

---

## 6. 实施记录（2026-10-09）

| 交付 | 落点 |
|---|---|
| `MESSAGE_PROCESSING_STATES` / `MessageProcessingState`；两结构 → 单一 `messageStates` | `app/src/channels/dedup/index.ts` |
| `rejectMessage(id)` 新增；`claimMessage`/`finalizeMessage`/`releaseProcessing`/`isMessageProcessed`/`getDedupStats` 按 §3.2 重写 | 同上 |
| 超时路径 `markMessageProcessed` → `rejectMessage`（移除该 import） | `channels/routing/messageRouter.ts` |
| 单测（状态转移 + 再入判定） | `app/tests/channels/DedupState.test.ts` |

**验证**：`typecheck` ✅ · `lint:arch` ✅（0 错）· `lint:doc-code` ✅ · `tests/{channels,execution}` ✅ · `tests/{chat,session}` ✅。

---

## 7. 遗留-⑨ 补齐：处理态落盘（2026-10-09）

**动机**：§2 原将 ⑨（重启后 `messageId` 不重复执行）列为"不做"，因其依赖 **PR5 Durable Execution**。PR5 完成后该依赖解除 ⇒ 本批补齐。

**设计**（沿用仓内 DB 模式；**仅新增表**，`project_rules §1.5`）：

| 交付 | 落点 |
|---|---|
| `DedupStore`（表 `channel_message_states`：`message_id` PK / `state` / `expires_at` / `updated_at` + 索引；单例 + 惰性 `CREATE TABLE IF NOT EXISTS`）；`upsert` / `remove` / `loadLive` / `purgeExpired` | `app/src/channels/dedup/DedupStore.ts` |
| 去重模块**可选持久化**：`attachDedupStore()`（opt-in，未接入=纯内存、零行为变更）· `hydrateFromDedupStore()`（启动期恢复未过期态 + 清过期）· `resetDedupState()`（仅测试）；`setState`/`releaseProcessing` 旁路 best-effort 写盘 | `app/src/channels/dedup/index.ts` |
| 启动接线（`wrapInit('Recovery')` 内，与 Execution 恢复同相） | `app/src/main.ts` |
| 单测 4 条（写盘 / hydrate 后仍 `duplicate` / release 删行 / purge 过期 / 未接入=纯内存） | `app/tests/channels/DedupPersistence.test.ts` |

**验收 ⑨**：`claim`+`finalize` 落盘 → 解绑并清内存（模拟重启）→ `hydrateFromDedupStore()` → 同 `messageId` 再入判 **`duplicate`** ✅。

**验证**：`typecheck` ✅ · `lint:arch` ✅（0 错）· `lint:doc-code` ✅ · `tests/{channels,execution,core}` **314 pass / 0 fail**。

## 8. 去重键**作用域**收敛（R4，2026-10-09）

**问题（第九轮审查 §3.1-⑥）**：`claimMessage()` 的键**仅 `messageId`** ⇒ **不同账号/通道使用相同 ID** 时，第二个被误判为 `inflight`/`duplicate`（**跨账号误去重**，消息被静默丢弃）。

**设计**：键由**裸 `messageId`** 收敛为**作用域键** `渠道:发送者:messageId`
（`message.channelId || channelName` : `message.senderId` : `message.messageId`），与**内容级去重**的维度（渠道:会话:发送者:内容，DEEP-7/PR4）**同源同径**。

| 交付 | 落点 |
|---|---|
| `dedupKey` 单点计算 + 全链同键（`claimMessage` / `releaseProcessing` / `finalizeMessage` / `rejectMessage`） | `app/src/channels/routing/messageRouter.ts` |
| `TextApprovalInput.dedupKey`（审批完成与"消息处理完成"落到**同一条**记录） | `app/src/channels/routing/textApproval.ts` |
| 契约用例 6 条（并发一次副作用 / 取消不判成功 / 断网可重试 / 出站恰好一次 / 帧校验短路 / **跨账号不误去重**） | `app/tests/channels/messageRouterContract.test.ts` |

**语义边界（如实）**：
- **同渠道同账号同 ID 的重传仍去重**（平台重传检测不受影响）；
- 本模块**只做键的存取、不规定作用域**（JSDoc 已注明）；`FeishuChannel` 仍传裸 `messageId`（**未纳入本次收敛**，属后续统一项）。

**验证**：`tests/channels` **137 pass / 0 fail** · 全量 **5206 pass / 42 skip / 0 fail** · `typecheck` 0 · `lint` 0。
