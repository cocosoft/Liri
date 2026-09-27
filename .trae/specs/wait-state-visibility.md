# Spec：等待态可见性（长等待期间"还在干活"的状态呈现）

> 版本: 1.0 ｜ 创建: 2026-09-27 ｜ 状态: **已实施**（§6 三项裁决均取推荐项；实施记录见 §8）
> 立项缘由：`E:\PY\Downloads\chat-export-1790473520007.md`（2026-09-27 09:34–09:41 真机会话）。
> 用户原话（09:39:37）："**如果你在持续等待，其实可以给前端反馈（或显示）正在干活的状态，而不是仅仅完成当前已输出的情况。也就是说，前端的状态管理好像可以更优化一些。**"
> 关联：N-45（会话级 `yieldState`）/ N-48（让出轮次消息级承载被 store 丢弃）/ UI-1（零碎信息统一到浮动栏）/ `api-spec.md`（`/v1/sessions/{id}/streaming`）

---

## 1. 问题（Problem Statement）

### 1.1 导出文件的原始判断与**本轮复核结论**

导出会话（由 Liri 自身产出）把问题归为"**反馈链条三处断点**"：#1 活跃判据不含等待态、#2 已挂提示条不刷新、#3 心跳覆盖不到工具自阻塞。
本轮逐条读码复核，**三处方向成立，但其中一处机制判错**（见下表 ⑥），且**真正的缺口比导出所述更靠上游**：用户实际看到的是 `sleep_for` **自唤醒等待**，而该状态在**后端根本没有对外表达**。

### 1.2 取证（逐条文件:行，非推断）

| # | 事实 | 证据 |
|---|---|---|
| ① | 浮动栏活跃判据 = **三种"字节在流动"标志**，不含"等待" | `client/src/components/ChatArea/StatusFloatBar.tsx:175` `isActive = isSending \|\| isStreaming \|\| isUploading` |
| ② | 非活跃即卸载（无渐隐时），仅 PDCA/编排入口可常驻 | 同上 `:210` `if (!isActive && !fadingOut && !pdca?.visible && !orchestrate?.visible) return null` |
| ③ | 让出提示条**只在 `sessionId` / `isStreaming` 变化时拉一次**，其后冻结 | `client/src/components/ChatArea/YieldNoticeBar.tsx:41-61`（`useEffect` 依赖 `[sessionId, isStreaming]`，无轮询） |
| ④ | 后端该状态是**读时派生**且**成本受控**：`waiting` 取内存 registry；贵的事件尾查询仅在"非 waiting 且非 streaming"时发生 | `app/src/infrastructure/http/handlers/session-handlers.ts:329-335`（`deriveYieldState`）、`:343-361`（`lastTurnYielded`） |
| ⑤ | 接口只回 `{sessionId, streaming, yieldState?}` | `app/src/infrastructure/http/handlers/chat-handlers.ts:907-937`（`handleSessionStreamingStatus`） |
| ⑥ | **导出判错之处**：`sleep_for` **不阻塞**（登记唤醒后立即返回），真正发生的是"本轮 turn 结束 + 有待触发唤醒" | `app/src/tools/SelfWakeTool/SelfWakeTool.ts:95-118`、`app/src/tasks/selfwake/SelfWakeService.ts:54-96`（`sleepFor` 只 `save` + 可选 `setTimeout` 后 return） |
| ⑦ | `finishReason='yielded'` **仅**由 `sessions_yield` 路径写入（读 `YieldRegistry`）；`sleep_for` 不进该 registry | `app/src/chat/ChatManager.ts:4174-4198`；`app/src/session/yield/YieldRegistry.ts:8` |
| ⑧ | ⇒ `sleep_for` 等待期 `deriveYieldState` 返回 `undefined`：**既无假告警，也完全没有任何状态**（这正是用户所见"像答完了"） | 由 ⑥⑦ 推出；`session-handlers.ts:332-334` |
| ⑨ | `WakeStore` 已有**按会话读取**能力（单 JSON 文件），但**无按会话列举待触发**的对外面 | `app/src/tasks/selfwake/WakeStore.ts:81-92`（`load`）、`:115-131`（仅全量 `getAllPending`）、`app/src/tasks/selfwake/types.ts:32-55`（`ISelfWakeService` 仅 `getDueWakes`） |
| ⑩ | ⚠️ **潜伏数据丢失**：四处登记都调 `wakeStore.save(sessionId, [entry])`——`save` 是**整文件覆盖**，同会话存在未触发项时**静默丢弃旧项** | `SelfWakeService.ts:87 / :126 / :151`；`WakeStore.ts:64-79`（`save` 直接 `writeFileSync(entries)`） |

### 1.3 结论

- 用户观察到的场景（`sleep_for`/`sleep_until`/`wake_on_job` 等待）**在当前架构下前后端都没有这一态**：后端不表达（⑧）、前端无对应 UI 与判据（①②）。
- 纯前端改动**覆盖不到**该场景（导出建议 #1+#2 只解决 `sessions_yield` 分支），故本轮为**跨层**变更（用户已裁定「全链条修」）。
- 事实 ⑩ 与本轮"待触发列表"直接同路径（都用 `load`/`save`），且会导致**丢唤醒** ⇒ 同批处置。

---

## 2. 决策

| # | 决策 | 理由 |
|---|---|---|
| **D1** | 等待态的**唯一事实源在后端**：`GET /v1/sessions/{id}/streaming` 增加只读字段 `pendingWake?`（来自 `WakeStore`），与既有 `yieldState` 共同构成前端等待判据 | 数出同源（§1.5）：等待事实在 `selfwake/*.json`，前端不可自行推断 |
| **D2** | **不新增事件类型** | 本项不新增"模型可见输入"（不进模型请求）⇒ 无需触碰 §1.6 三处同步断言；等待事实已落盘在 WakeStore |
| **D3** | 前端抽**共享钩子** `useWaitState`，由 `ChatArea` 统一调用后下传两个子组件 | 避免两个组件各自轮询（双轮询/双真相）；沿用 `useThinkingPhase` 已确立的"共享钩子 + 浮动栏统一承载"范式（UI-1） |
| **D4** | 轮询策略**分级**：仅在"等待态"按 4s 轮询；`yieldState==='unresolved'` 或等待结束即停 | 事实 ④：`waiting` 走内存 registry（便宜）；`unresolved` 会触发 200 条事件尾查询（贵）⇒ 不得无脑长轮询 |
| **D5** | 等待态**并入浮动栏**，`YieldNoticeBar` 收敛为**仅 `unresolved`**（明确告知需用户介入） | 沿用 UI-1 既定方向："零碎信息统一到浮动栏"；避免同一信息两处展示（CS01）。等待期浮动栏显示"⏳ 等待中…"，`unresolved` 才出独立提示条 |
| **D6** | 等待期指示点用**静态点 + 中性色**（不沿用绿色脉冲） | 绿脉冲语义为"正在输出"，等待期用之会谎报运行态（与 `:264-274` 既有 PDCA 常驻同一口径） |
| **D7** | 文案只报**真实测量值**：`pendingWake.triggerAt` 存在 ⇒ "预计 X 后自动继续"（倒计时）；无 `triggerAt`（`wake_on_job`/`wake_on_event`）⇒ 只说"等待中"并给已等待秒数，**不猜剩余时间** | 沿用 P3-4 已确立口径："不跨事件拼接、不造假值" |
| **D8** | 顺带修事实 ⑩：四处登记改为**合并写**（`load` + 追加 + `save`） | 丢唤醒是真实数据丢失，且与本项"待触发列表"作为同一事实源 ⇒ 必须一起正确 |

---

## 3. 接口设计

### 3.1 后端（读端）

**(a) 服务层**（`app/src/tasks/selfwake/`）

```ts
// types.ts —— ISelfWakeService 增补（只读）
/** 按会话取"待触发"（pending|due）唤醒项（升序 by triggerAt，无 triggerAt 排后） */
getPendingBySession(sessionId: string): Promise<WakeEntry[]>;
```

```ts
// SelfWakeService.ts
async getPendingBySession(sessionId: string): Promise<WakeEntry[]> {
  const entries = await this.wakeStore.load(sessionId);
  return entries
    .filter((e) => e.status === 'pending' || e.status === 'due')
    .sort((a, b) => (a.triggerAt ?? Infinity) - (b.triggerAt ?? Infinity));
}
```

同时把四处 `save(sessionId, [entry])` 改为合并写（D8）：

```ts
private async appendEntry(entry: WakeEntry): Promise<void> {
  const existing = await this.wakeStore.load(entry.sessionId);
  await this.wakeStore.save(entry.sessionId, [...existing, entry]);
}
```

**(b) HTTP 层**（`chat-handlers.ts` `handleSessionStreamingStatus`）

响应新增（**仅在存在待触发项时出现**；CG3 未启动或查询异常 ⇒ 省略该字段，不阻断主响应）：

```jsonc
{
  "sessionId": "...",
  "streaming": false,
  "yieldState": "waiting",            // 既有，保持
  "pendingWake": {                    // 新增（可选）
    "kind": "timer",                  // timer | completion | event
    "triggerAt": 1790474000000,       // kind=timer 才有（Unix ms）
    "createdAt": 1790473800000
  }
}
```

- 多条待触发 ⇒ 取 `triggerAt` 最早的一条（`pendingWake` 为**单对象**，避免前端做无谓排序；如需明细后续再扩数组）。
- 成本：`WakeStore.load` = 读 1 个 JSON 文件；`getCg3SelfWakeService()` 为同步取单例。

### 3.2 前端

**(a) 取数**（`client/src/services/sessionService.ts`）

```ts
export interface SessionRuntimeStatus {
  streaming: boolean;
  yieldState?: "waiting" | "unresolved";
  pendingWake?: { kind: "timer" | "completion" | "event"; triggerAt?: number };
}
```

**(b) 共享钩子**（新建 `client/src/components/ChatArea/useWaitState.ts`）

```ts
export type WaitReason = "yield" | "selfwake";
export interface WaitState {
  waiting: boolean;
  reason?: WaitReason;
  unresolved: boolean;        // yieldState === 'unresolved' ⇒ 需用户介入（交由 YieldNoticeBar）
  triggerAt?: number;
  seconds: number;            // 已等待秒数（本地计时，1s tick）
}
export function useWaitState(sessionId?: string, isStreaming = false): WaitState;
```

- 拉取时机：`sessionId` / `isStreaming` 变化时即时拉一次（沿用既有语义）；
- 轮询：`waiting === true` 时 `setInterval(4000)`；`unresolved` 或 `waiting === false` ⇒ 清定时器；
- 纯函数 `deriveWaitState(status, isStreaming)` 单独导出以便单测（对齐 `deriveThinkingPhase` 范式）。

**(c) 展示**

| 位置 | 变更 |
|---|---|
| `StatusFloatBar.tsx` | 新增可选 prop `wait?: WaitState`；`:210` 常驻条件追加 `wait?.waiting`；`getStatusText()` 在 `executionPhase` 分支之后、深度思考之前插入等待分支；`:264-274` 指示点：`waiting && !isActive` ⇒ 静态中性点 |
| `YieldNoticeBar.tsx` | 移除自身一次性拉取与 `waiting` 文案，改为**仅**渲染 `unresolved`（数据由 `ChatArea` 传入）；`waiting` 文案迁移至浮动栏 |
| `ChatArea.tsx` | 调用 `useWaitState(currentSession?.id, isStreaming)`，把结果下传两组件 |

**文案（i18n zh/en 同步）**

| key | zh | en |
|---|---|---|
| `chat.waitingSelfwakeCountdown` | `等待中，预计 {{seconds}} 秒后自动继续` | `Waiting — resuming in ~{{seconds}}s` |
| `chat.waitingSelfwake` | `等待中（{{seconds}} 秒），条件满足后自动继续` | `Waiting ({{seconds}}s) — will resume automatically` |
| `chat.waitingYield` | `等待子任务结算中（{{seconds}} 秒）` | `Waiting for subtask settlement ({{seconds}}s)` |
| `chat.yieldUnresolved` | 沿用既有 `YIELD_HINTS.unresolved`（迁移到 i18n） | 同 |

---

## 4. 影响文件

| 文件 | 变更 |
|---|---|
| `app/src/tasks/selfwake/types.ts` | `ISelfWakeService` 增 `getPendingBySession` |
| `app/src/tasks/selfwake/SelfWakeService.ts` | 新增 `getPendingBySession`；四处登记改**合并写**（D8） |
| `app/src/infrastructure/http/handlers/chat-handlers.ts` | `handleSessionStreamingStatus` 增 `pendingWake` |
| `client/src/services/sessionService.ts` | 响应类型加 `pendingWake` |
| `client/src/components/ChatArea/useWaitState.ts`（新建） | 共享等待态钩子（含 `deriveWaitState` 纯函数） |
| `client/src/components/ChatArea/StatusFloatBar.tsx` | 第 4 态 + 文案 + 指示点 |
| `client/src/components/ChatArea/YieldNoticeBar.tsx` | 收敛为仅 `unresolved`，数据改由 props 传入 |
| `client/src/components/ChatArea/ChatArea.tsx` | 调用钩子并下传 |
| `client/src/i18n/locales/zh.ts` / `en.ts` | 新增 3 条等待文案（zh/en 同步） |
| `.trae/docs/api-spec.md` | §1.6.1 红线：补 `pendingWake` 行（对齐 `yieldState` 既有写法） |
| `app/tests/…`、`client/src/tests/…` | 见 §5 |

---

## 5. 验证

| 层 | 用例 | 通过标准 |
|---|---|---|
| 后端单测 | `SleepFor` 二次登记 ⇒ **两条都在**（D8 回归，原实现会丢 1 条）；`getPendingBySession` 过滤 `fired`、按 `triggerAt` 升序；无文件 ⇒ `[]` | 全绿；**突变验证**：还原 `save([entry])` ⇒ 二次登记用例转红 |
| 后端契约 | `handleSessionStreamingStatus`：有待触发 ⇒ 含 `pendingWake`；CG3 未启动/无待触发 ⇒ **不含该字段**且仍 200 | 全绿 |
| 前端单测 | `deriveWaitState`：`pendingWake` 有/无 `triggerAt`、`yieldState==='waiting'`、`unresolved`、流式中 ⇒ 各分支 | 全绿 |
| 前端组件 | `StatusFloatBar` 传 `wait.waiting` ⇒ **仍渲染**且文案含"等待中"；`YieldNoticeBar` 仅 `unresolved` 时渲染 | 全绿 |
| 覆盖率 | `bun run test:coverage` | **EXIT=0**（新文件纳入逐文件门槛，按实测设棘轮） |
| 回归 | `bun run typecheck` / `eslint` / `bun test tests/` / `bun run build` | 全绿、0 problem |
| 门禁 | `bun run lint:arch` | 0 错 0 警（`infrastructure/http → @modules/tasks` 已有先例：`pdca-handlers.ts:40`） |

---

## 6. 裁决结果（2026-09-27 用户确认，三项均取推荐项）

| # | 待确认 | **裁决** | 落地 |
|---|---|---|---|
| 1 | 等待期**指示点样式** | **静态中性点** | `StatusFloatBar` 在 `isActive=false && isWaiting=true` 时用静态蓝点（`bg-sky-500`，无 `animate-ping`）—— 绿脉冲语义为"正在输出"，等待期用之谎报运行态 |
| 2 | `YieldNoticeBar` 的 `waiting` 文案**迁入浮动栏** | **迁入** | `YieldNoticeBar` 收敛为**仅 `unresolved`**（需用户介入的告警）；等待期文案由 `StatusFloatBar` 承担（对齐 UI-1"零碎信息统一到浮动栏"，并避免同一信息两处展示） |
| 3 | 同批修 `save()` 覆盖导致的**唤醒丢失** | **同批修** | `SelfWakeService` 新增私有 `appendEntry`（load → 追加 → save），四处登记改用它；回归守卫 + 突变验证见 §8.3 |

---

## 7. 合规

| 规则 | 结论 |
|---|---|
| CS01 归一化检查 | 复用 `WakeStore.load` / `useThinkingPhase` 范式 / 既有 `yieldState` 通道与 `StatusFloatBar` 承载位；**不新增**轮询通道、不新增事件类型 |
| CS03 回退/复杂度最小 | CG3 未启动 ⇒ 省略 `pendingWake`（不造假值）；无 `triggerAt` ⇒ 不猜剩余时间；轮询按状态分级启停 |
| CS04 Mock 零容忍 | 后端用例用真实 `WakeStore`（临时目录）+ 真实 `SelfWakeService`；前端用例用结构合法响应对象（沿用既有 SCENARIO 写法） |
| CS05 根因优先 | 修到"该状态在架构中不存在"这一层（后端表达 + 前端判据 + UI 三段同批），而非只给提示条加轮询 |
| §1.6 红线 | **不新增**"模型可见输入" ⇒ 无需新增事件类型（D2） |
| §1.6.1 接口清单 | 修改既有端点响应 ⇒ **必须**同步 `.trae/docs/api-spec.md`（§4 已列） |
| 分层合规 R00-001 | `infrastructure/http → @modules/tasks` 已有先例（`pdca-handlers.ts:40`、`task-handlers.ts:33`） |

---

## 8. 实施记录（2026-09-27）

### 8.1 交付物对照

| 交付物 | 状态 |
|---|---|
| `app/src/tasks/selfwake/types.ts` | ✅ `ISelfWakeService` 增 `getPendingBySession`（含契约注释：只读、无记录 ⇒ `[]`） |
| `app/src/tasks/selfwake/SelfWakeService.ts` | ✅ 新增 `getPendingBySession`；新增私有 `appendEntry`（合并写），四处登记改用 |
| `app/src/infrastructure/http/handlers/sessionWaitFields.ts`（新建） | ✅ `resolvePendingWake`（`undefined` = 无/CG3 未启动/读取异常）；独立小模块 ⇒ 既留出可测缝，也不让 `chat-handlers.ts` 继续长个 |
| `app/src/infrastructure/http/handlers/chat-handlers.ts` | ✅ `handleSessionStreamingStatus` 响应增 `pendingWake`（无则不出现该字段） |
| `client/src/services/sessionService.ts` | ✅ 导出 `SessionRuntimeStatus`；解析并校验 `pendingWake`（`createdAt` 缺失视为非法条目整条丢弃） |
| `client/src/components/ChatArea/useWaitState.ts`（新建） | ✅ `deriveWaitState` 纯函数 + `useWaitState`（4s 条件轮询；`unresolved`/非等待态即停） |
| `client/src/components/ChatArea/StatusFloatBar.tsx` | ✅ 新增 `wait?: WaitState`；`keepVisible = isActive \|\| isWaiting`（等待期不卸载、不渐隐）；等待文案分支；静态蓝点 |
| `client/src/components/ChatArea/YieldNoticeBar.tsx` | ✅ 收敛为**仅 `unresolved`**（数据经 props 传入，去掉自身一次性拉取） |
| `client/src/components/ChatArea/ChatArea.tsx` | ✅ 单一拉取点 `useWaitState(currentSid, isStreaming)` → 下传两组件 |
| `client/src/i18n/locales/zh.ts` / `en.ts` | ✅ 新增 4 键（`waitingSelfwakeCountdown` / `waitingSelfwake` / `waitingYield` / `yieldUnresolved`），zh/en 同步 |
| `client/vite.config.ts` | ✅ `coverage.include` 增列 `useWaitState.ts` + 逐文件棘轮（100/95/100/88，取自实测） |
| `.trae/docs/api-spec.md` | ✅ `/v1/sessions/{id}/streaming` 下补 `pendingWake` 行（对齐 `yieldState` 既有写法） |

### 8.2 相对 §3 原稿的偏离（均为对齐既有约定的调整）

| # | 偏离 | 理由 |
|---|---|---|
| 1 | `resolvePendingWake` **不放在** `chat-handlers.ts` 内，独立为 `sessionWaitFields.ts` | ① 可单测（不导出"仅测试用"的内部函数）；② `chat-handlers.ts` 已属大文件，不再追加 |
| 2 | `YieldNoticeBar` 的 `Yielding` 提示样式随之只剩 amber（原 sky 分支不再需要） | `waiting` 迁出后该组件只表达"告警"，保留双色会产生死分支 |
| 3 | 测试断言的"空闲不渲染"改为"空闲进入渐隐（`opacity-0`）" | 实测：`fadingOut` effect 在挂载后即置 true ⇒ 空闲态**先以 `opacity-0` 渲染 2s** 再卸载（N-49 既定语义，非本次引入）。真正要锁的是"**等待期不渐隐**" |

### 8.3 验证（实测数字）

| 层 | 结果 |
|---|---|
| 后端 selfwake | `bun test tests/tasks/selfwake/SelfWake.test.ts` ⇒ **18 pass / 0 fail**（新增 4 例：2 例合并写 + 2 例 `getPendingBySession`） |
| **突变验证（D8）** | 把 `appendEntry` 还原为 `save(sessionId, [entry])` ⇒ **恰 3 例转红**（两次登记 / 混用登记 / pending 列表），还原后全绿 |
| 后端契约 | `bun test tests/http/session-pending-wake.test.ts` ⇒ **5 pass / 0 fail**（无记录 ⇒ undefined / timer 带真实 triggerAt / 多条取最早 / `wake_on_job` 不伪造 triggerAt / 仅 fired ⇒ undefined）；用**真实** `WakeStore`（临时目录）+ 真实 `SelfWakeService`，`mock.module` **零使用** |
| 前端单测 | `waitState.test.ts` **7 例**（含"不伪造 triggerAt""unresolved 优先于 pendingWake"）+ `waitStateBars.test.tsx` **8 例** + `useWaitState.test.ts` **8 例**（轮询/停止/秒数/失败回落） |
| app 全量 | `bun test tests/` ⇒ **3598 pass / 9 skip / 0 fail**（3607 tests / 393 files / 102.86s） |
| client 全量 | `bun run test` ⇒ **447 pass / 0 fail**（44 files） |
| client 覆盖率门槛 | `bun run test:coverage` ⇒ **EXIT=0**；`useWaitState.ts` 实测 96.22/89.65/100/100，`All files` 96.53/90.35/99.35/98.27 |
| 其它门禁 | `typecheck`（app/client）0 · `eslint`（app/client）0 error · `lint-architecture` 0 错 0 警 · `lint-file-size` 0 错 · `bun run build`（client，vite 7）✓ |

### 8.4 未覆盖 / 待跟进（如实记录，不粉饰）

1. ~~**未做真机端到端复现**~~ → **✅ 2026-09-27 已完成，见 §8.5**（真实后端 + 真实工具 + 真实浏览器）。
2. `yieldState='unresolved'` 与 `pendingWake` **并存**时的语义按"unresolved 优先"处理（`deriveWaitState` 分支顺序）；该组合在真实数据里**未见样本**，属按"需用户介入优先"的保守判定。
3. 轮询间隔 4s 为常量（未做成配置）；若后续发现长等待下仍不够"有动感"，可再评估是否引入"已等待秒数本地跳动"（当前本地秒数**已在跳动**，故暂不做）。

### 8.5 真机端到端复现（2026-09-27，用户要求执行）

**环境**：真实数据目录 `~/.pyapp/data`；后端 = `bun run src/main.ts daemon --http-port 18990`（`startCg3: ready`，CG3 已装配）；前端 = 已在运行的 vite dev server `http://localhost:1420`（proxy → 18990）。

#### (1) 事故档案的**真实数据**证据（修复前就存在）

`~/.pyapp/data/selfwake/session_muj5asu8g825d0rgqt.json` 原始内容（1 条）：

| 字段 | 值 | 含义 |
|---|---|---|
| `kind` / `status` | `timer` / `fired` | 定时唤醒，已触发 |
| `createdAt` | 1790473013471（本地 09:36:53） | 登记时刻（用户在 09:36:25 要求"持续跟踪"之后 28s） |
| `triggerAt` | 1790473163471 | = createdAt + **150s** ⇒ 真实发生过一次 `sleep_for(150)` 长等待 |
| `firedAt` | 1790473163479 | **准点触发（+150.008s）** ⇒ 续跑通路本身正常，缺的只是"等待期可见" |

⇒ 与导出的会话时间线（09:36:25 → 09:39:23 用户感到"像答完了"）**精确对齐**：诊断成立。

#### (2) 后端：真实工具 + 真实端点

```
POST /v1/tools/sleep_for/execute  {"sessionId":"session_muj5asu8g825d0rgqt","arguments":{"seconds":1800}}
→ {"success":true,"data":{"wakeId":"48c28824-…","triggerAt":1790478217525,"status":"pending"}}

GET /v1/sessions/session_muj5asu8g825d0rgqt/streaming
→ {"sessionId":"…","streaming":false,"pendingWake":{"kind":"timer","triggerAt":1790478217525,"createdAt":1790476417525}}
```

- **修复前同一端点**（旧代码）返回 `{"sessionId":"…","streaming":false}` —— **无任何等待信息**（正是"看起来答完了"的根因）。
- 顺带在**真实数据**上验证 D8：登记后该文件为 **2 条**（原 `fired` + 新 `pending`）；旧覆盖写实现会丢掉 1 条。

#### (3) 前端：真实浏览器（含截图取证）

在 `http://localhost:1420` 打开会话「**Liri v0.4.51 打包状态检查**」（= 事故会话，前端默认打开的其实是另一个会话，已手动切换）：

| 观测项 | 实测 |
|---|---|
| 浮动栏是否仍在 | **在**（未随流式结束消失/渐隐） |
| 文案（原文） | `⏳ 等待中，预计 1699 秒后自动继续` |
| 倒计时是否走动 | **是**：1737 → 1729 → 1720 → 1714 → 1713 → 1699（多次采样递减） |
| 指示点 | `bg-sky-500` **静态蓝点**，容器内**无** `animate-ping`（不谎报"正在输出"） |

#### (4) 清理（未污染真实数据）

- 删除本次注入的 `pending` 条目 ⇒ 该文件回到原始 1 条（`fired`）；端点复核回到 `{"streaming":false}`（不再有 `pendingWake`）。浮动栏随之消失为**推定**（下一轮 4s 轮询取不到 `pendingWake` ⇒ `waiting=false` ⇒ 渐隐卸载；该轮询/停止路径已由 `useWaitState.test.ts` 覆盖），**未**为此再截一次图。
- **刻意未触发续跑**：选 `sleep_for(1800)`（> CG3 tick 300s ⇒ 不创建 setTimeout），且该 daemon 的 `wireSelfWake: cron not started`（cron 未接线）⇒ 验证期间**不会**自动续跑，**不产生任何模型调用与费用**。
- 副作用说明（如实）：为让新代码生效曾重启该后端 daemon（原进程亦为 AI 侧此前的后台任务，非用户手工启动）；浏览器步骤把当前会话切到了事故会话（用户可自行切回）。
