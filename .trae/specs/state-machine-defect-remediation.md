# 状态机缺漏修复方案（2026-11-24）

> **状态**：✅ 已实施（5 批全部落地，见 §9；剩余 2 项待拍板见 §5 #5/#6 与 §9.3）
> **来源**：三路并行审查 —— 后端（app/packages）、前端 store（client/src/stores）、展示层派生（components/utils/hooks）
> **范围**：Liri 会话 / 工具 / 审批 / 唤醒 / 任务卡 / 编排等状态机
> **原则**：先复核证据 → 单批实施 → 单测 + 真机复核 → 独立提交（遵循 `code-deletion.md` CD05/CD06）

---

## §1 结论

同类缺漏确实存在，共 **13 条**，分为：

| 级别 | 数量 | 判据 |
|---|---|---|
| P0 | 4 | 状态会**永久卡死**或**丢失唤醒/恢复** |
| P1 | 6 | 用户可见的**状态残留/显示矛盾** |
| P2 | 3+ | 潜在缺陷、重复定义、死代码 |

**交叉根因（优先于单点修复）**

1. **状态双轨**：布尔 flag（如 `pendingApproval`）与 `status` 字符串各自维护，写入点分散 ⇒ 一边进终态、另一边没清。
2. **缺单一派生函数**：「工具结果态」「是否 await 审批」各有 3–4 套判据，组件各自解释。
3. **缺终态统一回调与启动对账**：异常 / 重启 / 分页后只能等某个事件来收尾。

---

## §2 缺陷清单

> `复核` 列：✅ 已亲自复核；⏳ 子代理取证，**实施前必须复核**（CS06）。

| ID | 级别 | 问题 | 证据 | 复核 | 批次 |
|---|---|---|---|---|---|
| A1 | P0 | 审批 CAS 到 `processing` 后写失败不回滚；过期扫描只扫 `pending` ⇒ 卡永久不可处理 | `packages/service/src/runtime/inboxApproval.ts:208-226`、`InboxManager.ts:1320` | ✅ | 1 |
| A2 | P0 | PDCA 审批续跑有界退避后放弃，无重试标记 / 不转 abort；幂等键锁死 ⇒ 同会话新任务恒返回旧 taskId | `inboxApproval.ts:754-802`、`:881-912` | ⏳ | 1 |
| A3 | P0 | `wake_on_job`/`wake_on_event` 无 `triggerAt/expiresAt` ⇒ 永不超时；`fire()` 先置 `fired` 再续跑，失败不回滚 | `app/src/tasks/selfwake/SelfWakeService.ts:125-173`、`:250-305` | ✅ | 2 |
| A4 | P0 | 检查点 `inboxState.pendingInboxItems` 仅 `reset()` 清空 ⇒ 卡已 dismissed/expired 后 durable resume 永久跳过 | `packages/query/src/query/TAORLoop.ts:1983`、`app/src/.../bootstrap.ts:512-526` | ⏳ | 1 |
| B1 | P1 | `pausedStreams` 无 TTL、切会话不清；`pauseStream` 只重算 `isStreaming`，`isSending/executionPhase` 残留 | `client/src/stores/chat/chat-message.slice.ts:443-475`、`chatCoordinator.ts:41-46` | ⏳ | 3 |
| B2 | P1 | `mergeRefreshedMessages` 整表重算固定写 `streamingStatus:""/executionPhase:null`；inbox SSE 可能在流式中触发 ⇒ 状态栏闪断 | `chat-message-set-messages.ts:895-900`、`useNotificationSSE.ts:64-71` | ✅（清空处） | 3 |
| B3 | P1 | 「工具无终态」有 4 套判据 ⇒ 同一调用在组头/工具行/LogTab/日志工具显示 完成/中断/未知 三种结论 | `ToolExecutionGroup.tsx:146-160`、`ToolCallGroup.tsx:175-186`、`LogTab.tsx:143-145`、`sessionLog.ts:117-119` | ⏳ | 4 |
| B4 | P1 | `awaiting_approval` 有 3 套判据；`ChatMessage` 只认 `terminationReason` ⇒ 浮动栏说「等待审批」、正文却插「生成中断」 | `chat-message-shared.ts:154-171,314-318`、`ChatMessage.tsx:1413-1416` | ⏳ | 4 |
| B5 | P1 | 流中断后 `tool_call` 停在 `running`（归一化只在重载时做）⇒ 卡片一直转圈 | `chat-message-stream.ts:830-857`、`set-messages.ts:70-76` | ⏳ | 4 |
| B6 | P1 | 实时 `plan:task_card` 丢弃 `acceptance` ⇒「待验收」徽标实时不出现；`ToolInlineTags` 无"审批已落定/中断"分支，一律 `✓` | `client/src/stores/chat/index.ts:129-141`、`ToolInlineTags.tsx:39-45` | ✅ | 4 |
| C1 | P2 | 审批档位三份清单：`InlineApprovalActions` 白名单 vs `InboxBlock` 全量渲染 ⇒ 后端新增档位时就地按钮静默消失 | `InlineApprovalActions.tsx:35-49,68-70,90-93`、`InboxBlock.tsx:48-61,362-367` | ⏳ | 5 |
| C2 | P2 | 状态图标/颜色表 5 处重复（TaskCard / StatusFloatBar / ProgressCard / DAG×2），新增状态易漏 | 各文件头部常量表 | ⏳ | 5 |
| C3 | P2 | `sessionLog.extractToolCalls/buildLogEvents` **无生产消费者**（LogTab 实际用 `buildLogEventsFromEvents`）；PDCA 终态仍渲染运行脉冲、DocWorkflow 同阶段"进行中/等待确认"矛盾 | `sessionLog.ts:49,204`、`PdcaWorkflowCard.tsx:71-115`、`DocWorkflowProgress.tsx:164-219` | ✅（死代码）/ ⏳（UI） | 5 |

---

## §3 分批方案

### 批次 1：后端恢复性（P0-1 / P0-2 / P0-4）

**目标**：任何异常退出后，审批卡与续跑都能被"对账"救回，不出现永久卡死。

1. **processing 回滚**
   - `inboxApproval.ts`：`reply()` 返回空 ⇒ best-effort `tryUpdateStatus(id, PROCESSING → PENDING)`；回滚失败写审计日志（不吞）。
2. **过期扫描覆盖 processing**
   - `InboxManager` 过期 SQL 拆两条：`status='pending'`（原有）与 `status='processing' AND updatedAt < now - PROCESSING_TIMEOUT`。
   - `PROCESSING_TIMEOUT` 默认 10min（见 §5 待拍板）。
3. **PDCA 续跑放弃兜底**
   - 放弃前写"待恢复"标记（沿用已有 LRO checkpoint 字段，不新增表）；启动时扫描 `stage_awaiting_approval` 且无 pending 审批的任务 → 转 abort 或按策略重试。
   - 幂等键：释放前确认不再以旧 taskId 响应新任务。
4. **检查点恢复前实时复查**
   - `bootstrap.ts` 跳过恢复前用 `inboxManager.list({status:'pending', limit:1})` 实时复查；`inboxState.pendingInboxItems` 在终态回调中同步清空。
5. **终态回调统一**
   - `dismissBySession` 与 expiry 走同一个 `finalizeInboxItem()`，统一触达 `expiredListeners` / PDCA abort。
   - `goalStartupResume` 的 `limit:5 + .some()` 改为精确计数查询。

**改动文件**：`packages/service/src/runtime/{inboxApproval.ts,InboxManager.ts}`、`packages/query/src/query/TAORLoop.ts`、`app/src/.../bootstrap.ts`、`goalStartupResume.ts`
**测试**：processing 回滚、过期扫描覆盖 processing、dismiss 触发回调、checkpoint 复查跳过/不跳过、PDCA 放弃后可恢复
**验收**：制造"reply 写失败""卡在 processing""卡已 expired 但 checkpoint 非空"三种注入，重启后可自愈
**风险/回滚**：改 SQL 条件与回滚路径，风险中；每步独立提交，可单独 revert

---

### 批次 2：selfwake 唤醒可靠性（P0-3）

1. `wakeOnJob/wakeOnEvent` 写入 `expiresAt`（默认 24h，见 §5）。
2. `WakeStore` 增加过期扫描：`pending && expiresAt < now → expired`（新状态枚举，需同步前端 `useWaitState` 的 waiting 判定）。
3. `fire()` 顺序改为：**执行 resume → 成功才 `markFired`**；失败回 `pending` 并 `attempts+1`，超过 3 次转 `failed` + 审计。
4. 并发 fire 用 CAS（pending→firing）防双续跑。

**测试**：过期扫描、失败回滚、重复 fire 幂等、超过重试上限转 failed
**验收**：模拟 resume handler 失败 3 次 → 状态可观测且不再无限重试；job 永不完成 → 24h 后过期
**风险**：状态枚举新增需前后端同步；建议单独提交并先加前端兼容（未知状态按 waiting 处理）

---

### 批次 3：前端运行态残留（P1-1 / P1-2）

1. `pausedStreams` 增加 `pausedAt` + TTL（默认 30min，见 §5）；切会话只清理**超时项**（保留有效挂起流语义）。
2. `pauseStream` 同点结算 `isStreaming / isSending / executionPhase / streamingStatus`。
3. `mergeRefreshedMessages`：流式中**保留运行态字段**（不清空），并拒绝用后端旧快照覆盖本地进行中消息（Phase 1.5 已有去重，此处补运行态守卫）。
4. （可选，低优先）`switchState.lock` 布尔锁 → 计数/令牌，防并发 `setMessages` 互解锁。

**测试**：paused TTL 清理、pause 后三字段归零、流式中 SSE 刷新不闪断
**验收**：真机在流式中触发 inbox 刷新，状态栏与秒表不中断
**风险**：低（不改变数据模型）

---

### 批次 4：前端派生统一（P1-3 / P1-4 / P1-5 / P1-6）

1. 新增 **`client/src/stores/chat/toolOutcome.ts`**：
   ```ts
   deriveToolOutcome(toolCall, resolvedInboxIds) =>
     'pending_approval' | 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown'
   ```
   判定顺序：待审批（未落定）> running > failed > completed > interrupted > unknown。
2. 所有展示/统计点改用它：`ToolExecutionGroup`（组头与 `aggregateStats`）、`ToolCallGroup`、`ToolInlineTags`、`LogTab`/`sessionLog`。
3. `ChatMessage` 的中断提示改用现有的 `isAwaitingApprovalTurn`（shared 单一来源）。
4. 流中断收尾时把 `running` 工具迁移为终态（`failed` 或 `interrupted`，与 `deriveToolOutcome` 对齐），不再只追加提示块。
5. `plan:task_card` 透传 `acceptance`，`upsert` 改为合并而非整体覆盖。

**测试**：`deriveToolOutcome` 表格驱动（6 态 × 边角）、行内标签与组头一致、中断提示不误报、待验收徽标实时可见
**验收**：同一调用在浮动栏 / 组头 / 工具行 / 日志面板结论一致
**风险**：中（影响多个展示面）；建议先落地派生函数 + 单测，再逐个替换消费点

---

### 批次 5：清理与收敛（P2）

1. **审批档位单一来源**：以**后端返回的 options** 为准，前端只做展示映射；`InlineApprovalActions` 去掉白名单硬过滤（或白名单改为共享常量）。
2. **状态图标/颜色表**收敛为 `client/src/constants/taskStatus.ts`，五处引用替换。
3. **死代码**：`extractToolCalls/buildLogEvents` 先标注 `@deprecated` + 注释「无生产消费者，仅测试使用」，观察后再删（CD05/CD06，不在本批直接删）。
4. PDCA `hasLive` 过滤终态；DocWorkflow「等待确认」文案统一（需产品确认，见 §5）。

**测试**：档位渲染快照、图标表映射单测
**验收**：新增一个审批档位时，两处入口同时出现且文案一致

---

## §4 实施顺序与依赖

```
批次 1（后端恢复性）──┬─→ 批次 4（前端派生统一）
批次 2（selfwake）   ─┘        ↑
批次 3（前端运行态）───────────┘（可并行）
批次 5（清理收敛）── 依赖 1/4 落地后执行
```

- 每批**独立提交**（可单独 revert）；
- 批次 1 的 SQL / 状态枚举改动需先补测试再改；
- 批次 2 新增状态需前后端同一提交内兼容（未知状态按 waiting 处理）。

---

## §5 待拍板事项

| # | 事项 | 推荐值 | 影响 |
|---|---|---|---|
| 1 | `processing` 超时阈值 | 10 分钟 | 过期扫描频率与误杀风险 |
| 2 | selfwake job/event TTL | 24 小时 | 长任务等待 vs 无限挂起 |
| 3 | selfwake 新增 `expired` 状态是否对外暴露 | 仅内部 + 前端按 waiting 展示 | 需同步 `useWaitState` |
| 4 | `pausedStreams` TTL | 30 分钟（或对齐后端 attach 窗口，实施前查常量） | 切会话清理策略 |
| 5 | 流式中整表合并策略 | **保留运行态字段 + 拒绝覆盖进行中消息**（改动小） | 状态栏闪断 |
| 6 | DocWorkflow「等待确认」语义 | 需产品确认：改为「进行中」还是补等待信号 | P2，可延期 |
| 7 | 死代码处理 | 先 `@deprecated` 标注，观察期后再删 | 遵循 CD05/CD06 |

---

## §6 验证与门禁（每批必做）

1. 相关单测 + `client` 全量 vitest（154 文件）/ `app` 全量 `bun test`（后端批次）。
2. `tsc --noEmit`（client / app）、ESLint、Prettier、`lint:locale`（涉 i18n 时）。
3. 真机复核会话：
   - `session_mwr473pd502e995dd1`（审批 + 存量投影）
   - `session_mwpj4amge75a67ec4f`（审批过期）
   - `session_mwrf18pu00456e0f2b`（长会话 / 多审批 / 思考树）
4. 后端批次补充注入脚本：reply 写失败、processing 残留、checkpoint 非空但卡已终态。

---

## §7 边界（本方案不做）

- 不重构 LRO / 审批整体架构，不改持久化表结构（必要字段/索引需单独立项评估）。
- 不删除任何"可能由配置 / 运行时发现"的模块（`code-deletion.md` CD07）。
- 不改动审批业务语义（档位、风险分级、白名单策略）。

---

## §8 变更记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-11-24 | 初版：三路审查汇总 + 5 批修复方案 + 待拍板事项 | AI |
| 2026-11-24 | 5 批全部实施并独立提交（§9）；补充实施偏差与遗留项 | AI |

---

## §9 实施记录（2026-11-24）

### §9.1 提交清单（每批独立提交）

| 批次 | 提交 | 内容 |
|---|---|---|
| 方案 | `1b6adde31` | 本文件落盘 |
| 1 | `68c1fc74f` | A1 processing 回滚 + 过期扫描覆盖 processing；A4 断点恢复实时复查；A5 过期审批精确计数 + dismiss 终态回调 |
| 2 | `1bfa21fa0` | A3 selfwake 状态机补全（CAS / 失败重试 / expiresAt / 启动复位）；登记 `selfWake` 状态机目录 |
| 3 | `160a4b864` | B1 挂起 TTL + 挂起即结算运行态；B2 流式中刷新不回退正文、不清运行态 |
| 4 | `5ed4acb50` | B3 工具结果态单一派生（`toolOutcome`）；B4 `isAwaitingApprovalTurn`；B5 流结束迁移 running；B6 acceptance 透传 + upsert 合并 |
| 5 | `d421db59f` | C1 档位单一来源（`inboxReplyTiers`）；C2 状态展示表收敛（`constants/taskStatus`）；C3 死代码 `@deprecated` + PDCA 终态停脉冲 |

### §9.2 实施偏差（如实记录）

1. **A2 否决（未改代码）**：PDCA 已有启动对账 `scanAndAbortStalePdcaTasks`（`app/src/infrastructure/http/handlers/pdca-handlers.ts`，`app/src/main.ts` 启动调用）⇒ 「放弃后永久卡死」路径不可达；仅在批次 1 中保留 A4/A5 的恢复口径加固，未新增"进程内兜底"（避免误杀仍在推进的任务）。
2. **A4 的 `pendingInboxItems` 同步清空未做**：`addPendingInboxItem` 全仓零调用者（检查点从未写入该数组）⇒ 无可清空的写入点；改为恢复前**实时查库**复查（`bootstrap.ts#countLivePendingApprovals`）。是否"接线或删除"该 API 属独立立项（涉及 CD01–CD07）。
3. **R04-001 例外**：`InboxManager.ts` 由 1999 → 2068 行，按规则登记 `FSZ-006`（`scripts/layer-exceptions.json`，含拆分计划与 2026-12-31 到期）。
4. **状态机目录登记**：批次 2 新增 `selfWake` 条目（`packages/infra/src/state/engine/stateMachineCatalog.ts`）并重生成实参基线；`firing/expired` 等词汇因此进入棘轮观测面。
5. **`firing` 崩溃残留**：方案未列，实施时补了启动期 `recoverStaleFiring()`（否则 CAS 中间态无人复位，唤醒永久丢失）。
6. **重试耗尽**：`session/wake` 载荷是闭集，未扩事件类型；耗尽时仍记 `resume_failed`，`error` 前缀 `exhausted(3):` 以区分"已放弃"。

### §9.3 遗留 / 待产品确认

- **DocWorkflow「等待确认」语义**（§5 #6）：仍需产品裁定（改为「进行中」还是补等待信号），本批未动文案。
- **死代码删除**：`extractToolCalls` / `buildLogEvents` / `resolveGroupStatus` 已标 `@deprecated`，观察期后按 CD05/CD06 独立删除。
- **`FSZ-006`**：InboxManager 拆分计划到期前需落地（或按同口径续期）。

### §9.4 验证

- `app`：`bun test` 全量 **13794 pass / 0 fail**（1637 文件）；`bun run typecheck` 通过；`lint:consts` / `lint:state-ratchet` 通过。
- `client`：`vitest run` 全量 **1125 pass / 0 fail**（158 文件）；`tsc --noEmit` 通过；ESLint 通过。
- 新增测试：`inboxApprovalReplyRollback` / `selfWakeLifecycle` / `toolOutcome` / `planTaskStoreUpsert` / `inboxReplyTiers` / `taskStatus`。
