# Spec：自唤醒**重启后恢复**（长等待唤醒的重发链路修复）

> 版本: 1.0 ｜ 创建: 2026-10-09 ｜ 状态: **已实施（2026-10-09，方案 A；实施记录见 §7）**
> 立项缘由：第九轮外部审查 §4（`dev_docs/20261009/google ai 建议.md` 第 1 条）—— 质疑"长等待把协程常驻挂起、重启后 Promise 链断裂、缺脱水/再水化状态机 ⇒ 长任务死锁"。
> 关联：`wait-state-visibility.md`（同域，等待态**可见性**，已实施）· `session-lineage-restart-rebuild.md`（重启重建，另一域）· `tasks/selfwake/**` · `chat/manager/recovery.ts`。

---

## 1. 问题（Problem Statement）

### 1.1 外部论断 vs 实测

| 外部论断 | 实测判定 |
|---|---|
| ① `sleep_for`/`sleep_until` 把**协程常驻挂起**在守护进程内存 | ⚠️ **部分不成立**：`sleepFor` **不持有** Promise；`≥ tickInterval(默认 300s)` 的等待**根本不建 timer**，仅**登记到磁盘** + 由 `CronScheduler.extraTick` 周期扫盘（`Cg3Bootstrap.ts:113-138`）。只有 `< 300s` 的短等待用内存 `setTimeout`（`SelfWakeService.ts:88-99`） |
| ② 重启后"缺**脱水/再水化**（重建协程调用栈现场）" ⇒ 长任务断裂死锁 | ⚠️ **方向对、定性错**：本仓**有意**采用"到期**重发**续跑"（`recovery.ts:345-398`：注入 `systemResume` 提示让会话续跑新一轮），**不复活 Promise 链** ⇒ **属设计选择，非缺陷**（见 §2）。但 **[真缺口]**：重启后"重发链路"本身**失效** —— 见 §1.2 |

### 1.2 真缺口：重启后 `fire()` 既不续跑、也不落 `fired`（取证 + 复现）

**根因**：`WakeStore` 用**内存索引** `wakeToSession: Map<wakeId, sessionId>` 做 `wakeId → sessionId` 反查，**仅由 `save()` 填充**（`WakeStore.ts:28,72`）；`load()` **不填充**。重启后索引为空。

| 环节 | 代码 | 重启后表现 |
|---|---|---|
| 扫盘发现到期 | `getDueWakes()` 直接读盘（`WakeStore.ts:134-153`） | ✅ **能发现**持久化的 `pending/due` |
| 反查条目 | `SelfWakeService._findEntry` → `getSessionFor`（`SelfWakeService.ts:293-298` / `WakeStore.ts:190-192`） | ❌ 索引空 ⇒ 返回 `null` |
| 标记 fired | `WakeStore.markFired` → `wakeToSession.get`（`WakeStore.ts:95-97`） | ❌ 索引空 ⇒ **提前 return，不落 `fired`** |
| 续跑 | `fire()` 因 `entry===null` 走 `fire:entry_not_found` 分支（`SelfWakeService.ts:215-220`） | ❌ **不调用 resume handler** |

**复现（本仓实测，临时脚本已删）**：写入 `pending`（`triggerAt` 已过）→ 新建 `WakeStore/SelfWakeService`（模拟重启）→

```
getDueWakes 数量 = 1                 （扫盘可发现持久化 pending ✓）
getSessionFor = undefined            （重启后内存索引为空）
fire:entry_not_found {"wakeId":"wake-1"}
fire 后 status = pending             （期望 fired；仍 pending ⇒ 未落 fired）
```

**后果**：每个 Cron tick 都会再次 `getDueWakes()` 命中同一条 ⇒ `fire()` 每次空转 `entry_not_found` ⇒ **长等待唤醒重发链路不可用**（不续跑、不收敛），并可能**无界重试**（`gc()` 只清理 `fired`，`pending` 永留）。

### 1.3 `fired` 幂等性判定

- **同进程内**：幂等 ✅（`getDueWakes` 只返回 `pending|due`，`fire` 后置 `fired` ⇒ 不再被扫到）。
- **跨重启**：**不幂等** ❌（`markFired` 空转 ⇒ 重复 fire / 永不收敛）。**触发条件是重启**，故属真实缺陷。

---

## 2. 设计判定：「脱水/再水化」是**设计选择**（不做调用栈级再水化）

本仓对"长等待"的既定语义是**登记 → 到期重发**（`systemResume` 注入，让会话**开新一轮**），**不是**"序列化并复活原 Promise 调用栈"。

- **理由**：Agent 循环本就是"轮次驱动"（每轮由模型重新规划），复活旧调用栈既无必要也脆弱；重发更贴合"模型重新看到上下文再决定"的既有模型（N-26 修复即此方向）。
- ⇒ **不立项**"调用栈级脱水/再水化"。外部该建议**降级为设计选择**。
- ⇒ 本 Spec **只修 §1.2 的真缺口**（重启后重发链路失效）。

---

## 3. 修复方案（根因优先）

**根因**：`wakeId → sessionId` 的反查**依赖易失内存索引**，而该信息**在磁盘文件名里**（`{sessionId}.json`）。⇒ 让反查**不依赖易失状态**。

**方案（二选一，取 A）**：

- **A（推荐，最小）**：`WakeStore` 增 **`rebuildIndex()`**（扫描 `selfwake/*.json`，`load` 全部条目并填充 `wakeToSession`）；在 `getSessionFor`/`markFired` **未命中时惰性重建一次**（或在 `Cg3Bootstrap` 启动时显式调用一次）。
  - 优点：不动调用方；`fire()`/`markFired` 语义不变；幂等由既有 `pending|due` 过滤保证。
  - 成本：未命中时一次目录扫 + 逐文件读（N 小；且只在重启后首次命中前发生）。
- **B**：`getDueWakes()` 已返回完整 `WakeEntry`（含 `sessionId`）⇒ 让 `fire(entry)` 直接吃条目，避免反查。改动面更大（`fire` 签名/调用方），且不修 `markFired` 的同类脆弱性。

**附加（幂等加固，SHOULD）**：`markFired` 前置检查"已是 `fired` ⇒ 跳过写"，并让 `fire()` 对"已 fired"条目**短路**（防同一 `wakeId` 被并发/重复触发导致**双续跑**）。

---

## 4. 影响文件（预期）

| 文件 | 变更 |
|---|---|
| `app/src/tasks/selfwake/WakeStore.ts` | 新增 `rebuildIndex()`；`getSessionFor` / `markFired` 未命中时惰性重建（+ `markFired` 幂等短路） |
| `app/src/tasks/selfwake/SelfWakeService.ts` | （若取 A）无改动；若取 B 则 `fire` 改签名 |
| `app/tests/tasks/selfwake/*` | 新增"重启后 fire ⇒ 落 fired + 调 resume handler"用例（见 §5） |

---

## 5. 验证（计划）

| 层 | 用例 | 通过标准 |
|---|---|---|
| 后端单测 | 写入 `pending`（过期）→ 新 `WakeStore`（模拟重启）→ `fire(id)` ⇒ **`status==='fired'`** 且 **resume handler 被调用一次** | 全绿；**突变验证**：去掉 `rebuildIndex` ⇒ 该用例转红（复现 §1.2） |
| 幂等 | 同一 `wakeId` 连续 `fire` 两次 ⇒ handler **仅调用一次**（第二次短路） | 全绿 |
| 回归 | `bun run typecheck` / `bun run lint` / `bun test tests/` / `bun run lint:arch` | 全绿、0 error |

---

## 6. 合规

| 规则 | 结论 |
|---|---|
| CS01 归一化 | 复用既有 `WakeStore.load` / `save` 与 `wakeToSession` 索引；**不新增**第二份索引/第二套状态机 |
| CS03 回退最小 | 惰性重建仅在"索引未命中"时发生；不做"以防万一"的每次全量扫描 |
| CS04 Mock 零容忍 | 用例用**真实** `WakeStore`（临时目录）+ 真实 `SelfWakeService`（沿用 `wait-state-visibility.md` 的装置） |
| CS05 根因优先 | 修到"反查不应依赖易失状态"这一层，而非给 `fire()` 打补丁吞异常 |
| §1.6 红线 | `fire` 的续跑已落 `session/wake` 事件（`recordSelfWake`）；本修复**不新增**模型可见输入 ⇒ 无需新增事件类型 |
| R00-001 分层 | 仅 `tasks/**` 内部改动，无跨层 |
| **CD07（关键模块）** | 属"会话恢复"关键域 ⇒ 依 `code-deletion.md` CD07，**不得**因"某方法（`getAllPending`）无静态引用"而删；修复须保留语义 |

---

## 7. 实施记录（2026-10-09，方案 A）

| 交付物 | 变更 |
|---|---|
| `app/src/tasks/selfwake/WakeStore.ts` | 新增 `rebuildIndex()`（扫盘重建 `wakeId→sessionId`）· 新增私有 `resolveSessionId()`（未命中即**惰性重建**）· `markFired()` 改用之且**幂等短路**（已是 `fired` 不再写） |
| `app/src/tasks/selfwake/SelfWakeService.ts` | `_findEntry()` 未命中时**先 `rebuildIndex()` 再查** · `fire()` 对 `entry.status==='fired'` **短路**（`fire:already_fired`，防双续跑） |
| `app/tests/tasks/selfwake/SelfWakeRestart.test.ts`（新建） | R1 重启后 `fire ⇒ fired + 续跑一次` · R2 幂等（连续两次 `fire ⇒ 续跑仅一次`）· R3 未知 `wakeId` 不触发 |

**验证**：`bun test tests/tasks/selfwake/` ⇒ **30 pass / 0 fail**。
**突变验证**：临时去掉 `rebuildIndex` 惰性重建（`_findEntry`/`resolveSessionId` 退化为纯内存索引）⇒ **R1/R2 转红、R3 仍绿**（证明用例非空转），随后已还原。
