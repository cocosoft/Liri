# Spec：进程级崩溃注入测试（Process Crash Injection）

> 版本 1.0 ｜ 创建 2026-10-10 ｜ 状态：**S1 ✅**
> **来源**：`dev_docs/20261010/升级优化方案-20261010.md` §3 **P0-1**（对应核验项 E-6；外部专项 B/C 核心）
> **关联规则**：GR15 · CS01 · CS03 · CS06（证据驱动）· `code-deletion.md`（无删除）
> **关联 spec**：`.trae/specs/durable-execution.md` · `.trae/specs/execution-lifecycle-ownership.md` · `.trae/specs/unknown-tool-call-recovery.md`

---

## 1. 问题（根因）

既有"故障注入"（`tests/execution/recoveryFaultInjection.test.ts`）是**进程内**做法：
`spyOn(store, method).mockImplementation(async () => { await orig(); throw CRASH })`
—— 方法**真实提交后抛错**，且**同一管理器/同库重开**继续跑。

外部审查（CHANGELOG 专项 §二）明确指出：*"日志明确承认，故障注入目前主要验证 B-02 的调用顺序，
尚未进行真实崩溃注入"*。⇒ 缺"**进程在写入点之间消失**"这一真实时序的验证。

---

## 2. 范围决策

- **做**：新增**真实 spawn 子进程 → `SIGKILL` 自身 → 父进程重开库恢复**的驱动器 + 五组场景。
- **不做**（诚实边界）：
  - **不做**外部副作用（文件/网络/远端）的真实注入 —— 本版聚焦 **DB/事件/执行状态** 的一致收敛
    （外部副作用需真实外部系统，属后续扩展；触发条件见 §4）。
  - **不替换**既有 `recoveryFaultInjection.test.ts`（两者互补：进程内 = 快速单元级；本文件 = 端到端时序级）。
  - **不新增**生产代码（本项为**测试 + 夹具**；仅复用既有 P0-4 策略）。

---

## 3. 设计

### 3.1 子进程夹具（`app/tests/execution/fixtures/executionCrashChild.ts`）

`bun executionCrashChild.ts <dbPath> <scenario>`：
按场景用 `ExecutionStore` **公共 API** 写入"崩溃前"持久化状态 → 打印 `SEEDED` →
`process.kill(process.pid, 'SIGKILL')`（**无 `finally`、无退出钩子、不 `close()`**）。
**只写真实 SQLite**，不 mock 任何存储。

### 3.2 父进程驱动（`app/tests/execution/processCrashInjection.test.ts`）

`spawnSync(process.execPath, [fixture, dbPath, scenario])` → 子进程崩溃后，**父进程重开同库** +
`ExecutionManager.attachStore` + `recover({ staleMs })`，断言不变量。

**可移植性**：`SIGKILL` 的退出码跨平台不一致（Windows 不暴露 signal）⇒ 断言**不用退出码**，
而用"夹具抵达崩溃点的 `SEEDED` 标记 + 落盘数据存在"作为真实崩溃证据。

### 3.3 五组场景 ↔ 不变量

| 场景 | 崩溃前状态 | 断言（不变量） |
|---|---|---|
| ① `before-ledger-write` | 执行 `RUNNING`，工具**未落盘** | 恢复 ⇒ `STALE`（**非 `COMPLETED`**）、`unknownToolCalls` 空 |
| ② `after-ledger-write` | 执行 `RUNNING` + 工具 `running` | 工具收敛为 `unknown`（**不永久 `running`**）；`unknownToolCalls` 含该工具 |
| ③ 同 ②（策略） | —— | `resolveToolRecoveryPolicy('file_write') === 'manual'` ⇒ **禁止自动重放**（P0-4） |
| ④ `orphan-for-fencing` | 代次 7 的孤儿 | 新 `acquire` 得 `RUNNING` 且代次 > 8；旧执行 `complete` **抛错**、不改写新执行（**迟到者不得提交**） |
| ⑤ `cancel-requested` | `CANCEL_REQUESTED` + 陈旧心跳 | **不静默当"已取消"** ⇒ 按孤儿 `STALE` + 工具 `unknown`（**取消请求 ≠ 进程已退出**） |
| 不变量 | —— | `recover()` **可重复执行**（第二次 `recovered=0`、不重复抬代次） |

---

## 4. 验收与边界

- **验收**：`bun test tests/execution/processCrashInjection.test.ts` ⇒ **6 pass / 0 fail**（含前置保障 1 例）。
- **未覆盖（如实，触发条件）**：
  - **外部副作用**（文件已写/未写、远端已提交/未提交）的真实判定 —— 需真实外部系统或可控 mock 服务；
    触发条件：出现"崩溃后必须自动对账外部副作用"的真实需求（与 `unknown-tool-call-recovery.md` §2 同源）。
  - **SIGKILL 的确切信号可见性**（POSIX `signal='SIGKILL'`）在 Windows 不可断言 ⇒ 用 `SEEDED` + 落盘数据替代。

---

## 5. 实施记录

| 切片 | 内容 | 落点 | 状态 |
|---|---|---|---|
| **S1** | 子进程崩溃夹具 + 父进程驱动（五组场景 + 幂等不变量） | `app/tests/execution/fixtures/executionCrashChild.ts`（新）· `app/tests/execution/processCrashInjection.test.ts`（新） | ✅ 2026-10-10 |
