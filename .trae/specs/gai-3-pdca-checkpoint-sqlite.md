# Spec：GAI-3 —— PDCA / WorkItem 检查点迁入 `app.db`（SQLite WAL）

> 版本: **0.1** ｜ 创建: 2026-10-05 ｜ 更新: 2026-10-05 ｜ 状态: **✅ 已实施（含实测：真实库 2576 行 / list 9.2ms）**
> 关联：`dev_docs/20261004/google ai 建议.md` §7.3 / 建议原文（`:21`）｜`.trae/rules/project_rules.md` §1.5（DB 统一约定）/ §1.5.1（写前持久化）｜`.trae/rules/architecture-compliance.md` R01（基础设施复用）/ R02（数据模型统一）
> 目标：把 PDCA 检查点（当前 `~/.pyapp/data/pdca/*.json`）与 WorkItem（`~/.pyapp/data/workitems/*.json`）迁入唯一 `app.db`，**复用 WAL + 事务**，消除（a）全目录解析开销（实测 3394 文件 / 1032ms）与（b）**read-modify-write 竞态**。

---

## 1. 问题（实测）

**现状**：`app/src/tasks/PdcaWorkItemBridge.ts` 以**每任务一个 JSON 文件**存储检查点：

| 症状 | 证据 |
|---|---|
| 全量扫描成本随目录**只增不减** | `scanCheckpoints()`（`:123-161`）：`readdirSync` + 逐文件 `readFileSync`+`JSON.parse`；真实目录 **3394** 个 json / 3MB ⇒ `readdir` 2ms / 全量 `stat` 30ms / **全量 read+parse 1032ms**（97% 花在"重新解析未变文件"） |
| **RMW 竞态** | `writePdcaCheckpoint()`（`:80-94`）为"读整文件 → 合并 → 覆盖写"；多通道（HTTP handler / 任务层 / CLI `Goal.ts` / 会话拆除）并发写同一 `taskId` ⇒ **后写覆盖前写**（丢失 `workItemId/status/…`，历史上已致 WorkItem 同步空转） |
| 文件损坏静默丢数 | `readJson()`（`:52-65`）parse 失败 ⇒ `null`，上层按"无文件"处理（`KB-PDCA-READ-LOG`） |
| 已做的缓解（保留但不足） | `ckFileMemo`（mtime+size 记忆，⇒ ≈32ms）+ `prewarmPdcaCheckpointIndex()`（分批预热）——**仍非原子**，未消除 RMW 竞态，且仍依赖目录扫描 |

**对照**：会话/流式检查点（`chat/services/CheckpointDatabase.ts`）**已是** `app.db` SQLite ⇒ 本项是把 PDCA 侧**收敛到同一范式**（R01 复用），**不是**改造会话检查点（避免混淆）。

---

## 2. 决策（待评审）

| # | 决策 | 理由 |
|---|---|---|
| **D1** | 新建表 `pdca_checkpoints`、`workitems`（均 `CREATE TABLE IF NOT EXISTS`），落在唯一 `app.db`（`resolveDbPath()`） | 遵循 §1.5 DB 统一约定；**禁止新建 .db 文件** |
| **D2** | **JSON 载荷 + 提升热列**：`data TEXT NOT NULL`（完整检查点 JSON，字段自由演进）+ 提升列 `phase` / `status` / `updated_at` / `work_item_id` / `workspace_id` / `project_id` | 检查点字段众多且分散在各写入点（`workItemId`/`status`/`workspaceId`/`projectId`/`lastPdcaPhase`/`phase`…）；**避免"一字段一列"的建表churn**，同时让列表/过滤走索引 |
| **D3** | **写入用原子 UPSERT**（`INSERT … ON CONFLICT(task_id) DO UPDATE SET data = json_patch(...)` 或读改写包在**单条 SQL 事务**内），`updated_at` 由写入端统一刷新 | **本项核心**：SQLite 事务消除 RMW 竞态（原整文件覆盖的根因）|
| **D4** | API **由同步改为 `async`**（既有 `@modules/core/external/sqlite3` 为回调式异步封装） | 无法保留同步签名；`taskOpsPorts.ts` 端口**本就是 `Promise`** ⇒ 端口层由"包一层 Promise"变为**直通** |
| **D5** | **一次性、幂等迁移**：启动时若某 `taskId` 在表中不存在且 `<dir>/<taskId>.json` 存在 ⇒ 导入；导入成功后**保留**原 JSON（不删，安全）；迁移**不阻塞**启动（逐文件 `await` 天然让出事件循环；**不再**依赖已被 D6 删除的 `prewarm` 范式） | 不丢历史数据；可回滚；避免启动卡顿 |
| **D6** | `prewarmPdcaCheckpointIndex()` **删除**（不再需要扫描/记忆）；`prunePdcaCheckpoints()` 改为按条件的 `DELETE`（保留天数/终态/孤儿判据**不变**） | 消除无谓机制（CS03） |
| **D7** | **不改**留存判据、状态词汇、`PDCA_TO_WORKITEM` 映射、`taskOpsPorts` 的对外语义 | 只换存储，不改业务语义 |
| **D8** | **WAL / PRAGMA 不新增任何代码**：新连接经 `@modules/core/external/sqlite3` 的 `Database` 类（构造即调 `openBunDatabase()`）**自动继承** `journal_mode=WAL` / `busy_timeout=10000` / `temp_store=MEMORY` | **WAL 项目内早已统一处理**（台账 **D-241**，2026-10-02 用户裁定「扩展封装 + 归一化 5 处」）：PRAGMA **单一事实源** = `core/external/sqlite3.ts` 的 `openBunDatabase(path, { readonly? })`；全仓 `bun:sqlite` 直连**已清零**（复核：仅剩封装内部 1 处）；且 WAL 是**库文件属性** —— 写侧开启后所有连接共享（只读侧无需也不应设置） |

---

## 3. 接口设计

### 3.1 表结构（`app.db`）

```sql
CREATE TABLE IF NOT EXISTS pdca_checkpoints (
  task_id       TEXT PRIMARY KEY,
  data          TEXT NOT NULL,   -- 完整检查点 JSON（读端 JSON.parse 还原原对象）
  phase         TEXT,
  status        TEXT,
  work_item_id  TEXT,
  workspace_id  TEXT,
  project_id    TEXT,
  updated_at    TEXT NOT NULL    -- ISO；留存判据
);
CREATE INDEX IF NOT EXISTS idx_pdca_checkpoints_updated_at ON pdca_checkpoints(updated_at);

CREATE TABLE IF NOT EXISTS workitems (
  work_item_id  TEXT PRIMARY KEY,
  data          TEXT NOT NULL,
  status        TEXT,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workitems_status ON workitems(status);
```

> **实施前必做**：确认 `app.db` 中**无同名表**（红线「表名冲突」）；表名以 `pdca_checkpoints` / `workitems` 为准，若冲突则改前缀 `gai3_`。

### 3.2 API 变更（`PdcaWorkItemBridge.ts`）

| 现签名（sync） | 新签名（async） |
|---|---|
| `readPdcaCheckpoint(taskId): Record \| null` | `readPdcaCheckpoint(taskId): Promise<Record \| null>` |
| `writePdcaCheckpoint(taskId, patch): void` | `writePdcaCheckpoint(taskId, patch): Promise<void>`（**原子 UPSERT**） |
| `listPdcaCheckpoints(): Record[]` | `listPdcaCheckpoints(): Promise<Record[]>`（单条 `SELECT data`） |
| `getPdcaCheckpointIndex(): Map` | `getPdcaCheckpointIndex(): Promise<Map>` |
| `prunePdcaCheckpoints(days?): Result` | `prunePdcaCheckpoints(days?): Promise<Result>`（判据不变） |
| `prewarmPdcaCheckpointIndex()` | **删除** |
| `syncPdcaWorkItemStatus(taskId, phase): void` | `syncPdcaWorkItemStatus(taskId, phase): Promise<void>` |
| （新增）| `migratePdcaCheckpointsFromJson(dir?): Promise<{imported, skipped, errors}>`（D5 一次性迁移，幂等） |

**模块形态**：改为**惰性单例**（`constructor(dbPath = resolveDbPath())` + `initDatabase()` + `createTables()`，照 `CheckpointDatabase` 范式）；导出函数保留为**薄包**（内部走单例）以最小化调用点改动。

### 3.3 调用点改动（须逐点 `await`）

| 文件 | 位置 |
|---|---|
| `app/src/infrastructure/http/handlers/pdca-handlers.ts` | `:139/:165/:182/:189/:236/:287/:402/:589`（改 `await`） |
| `app/src/runtime/api/domainSnapshotOps.ts` | `:1017-1030`（**去掉多余 Promise 包装**，端口改直通） |
| `app/src/runtime/api/taskOpsPorts.ts` | `:329-339`（注释订正：app 侧**已是** async） |
| `app/src/tasks/LongRunningTaskOrchestrator.ts` | `:374/:439/:1815/:2045/:2050/:2321/:2326` |
| `app/src/tasks/StageOrchestrator.ts` | `:241/:252` |
| `app/src/tasks/PlanDrivenLoop.ts` | `:578/:625` |
| `app/src/chat/launchers/PdcaLauncher.ts` | `:237/:240/:260/:291` |
| `app/src/chat/manager/sessionTeardown.ts` | `:137-146` |
| `app/src/commands/builtin/goal/Goal.ts` | `:45/:106/:126/:184/:208/:309` |
| `app/src/main.ts` | `:1968`（删 `prewarmPdcaCheckpointIndex` → 改 `migratePdcaCheckpointsFromJson`）/ `:1978`（`await prune`） |

### 3.4 测试改动（同步 `await`；**断言语义不变**）

`tests/tasks/pdcaCheckpointRetention.test.ts` · `tests/tasks/crossRestartApproval.test.ts` · `tests/http/pdca-status.contract.test.ts` · `tests/http/pdca-list.contract.test.ts` · `tests/chat/PdcaLauncher-progress.test.ts`（后者现隔离到临时目录 ⇒ 改为隔离 DB 路径 / 注入 `dbPath`）。

---

## 4. 合规

| 规则 | 结论 |
|---|---|
| R01 基础设施复用 | 复用 `@modules/core/external/sqlite3` + `resolveDbPath()` 既有范式（`CheckpointDatabase` 同款） |
| R02 数据模型统一 | 不新增重复类型；检查点仍为"自由 JSON 载荷"，仅提升索引列 |
| R08-001 跨重启状态必须持久化 | **本项即修复**：由"文件 + RMW"升级为"DB + 事务" |
| CS01 归一化 | 与 `CheckpointDatabase` 收敛到同一存储范式；`prewarm/memo` 机制**删除**而非叠加 |
| CS03 回退最小化 | 迁移失败**不阻断**启动（`@ignore-catch` 语义）；不做"DB → 文件"自动回退（避免双写） |
| CS05 根因优先 | 根因 = "整文件读改写"非原子；以 SQL 事务根治，非再加锁/记忆层 |
| §1.5 DB 统一约定 | 唯一 `app.db`；**不新建 .db**；表名冲突前置校验 |
| 数据安全 | 仅 `CREATE TABLE IF NOT EXISTS`（新增表），**不改既有表结构**；迁移**不删**原 JSON |

---

## 5. 验证（2026-10-05 实测结论）

| 层 | 用例 | 结果 |
|---|---|---|
| 编译期 | `bun run typecheck` | ✅ **0 error**（含全部调用点 `await` 修正） |
| 单测 | 既有测试文件（改 `await`，**断言语义不变**） | ✅ 全绿 |
| **并发原子性（新增）** | 同 `taskId` 并发写 **50** 个不同字段 ⇒ 最终字段**全部存在**、`taskId`/`updatedAt` 不丢 | ✅ 全绿（**本项核心验收**；`tests/tasks/pdcaCheckpointSqlite.test.ts`） |
| 迁移幂等（新增） | 造 JSON ⇒ 导入 `imported=1` ⇒ 重复调用 `skipped=1`，**原 JSON 保留** | ✅ 全绿 |
| 留存 | `prunePdcaCheckpoints` 判据/计数语义与既有一致 | ✅ 全绿（`PdcaCheckpointPruneResult` 字段未变） |
| 回归 | 全量 `bun test` + `lint:arch` + `lint:size` + `eslint` | ✅ **4398 pass / 21 skip / 0 fail**；`lint:arch` 错误 0 / 警告 4（基线）/ 僵尸方法 **0**；`lint:size` 错误 0；eslint 0 |
| 真实数据 | 真实 `~/.pyapp/data/pdca/`（实测 **2576** 个 json）⇒ `pdca_checkpoints` **2576** 行（与目录文件数一致） | ✅ 行数一致 |
| 耗时 | `listPdcaCheckpoints()` 等价查询 | ✅ **9.2ms**（SELECT 3.5 + parse 5.6）；旧实现首次 ≈**1.1s** ⇒ **≈120×** |
| 表名冲突 | `app.db` 同名表检查 | ✅ 不存在 `pdca_checkpoints`/`workitems`（仅有 `work_items`，名字不同）⇒ 未用 `gai3_` 前缀 |
| 测试隔离 | 真实库污染检查 | ✅ 真实库中 `updated_at ≥ 2026-10-05T07:00Z` 的行数 = **0**（测试均隔离到临时 DB 路径） |
| **WAL（运行时取证）** | 新 store 写入隔离临时 DB 后，用**新连接**读库文件属性（`PRAGMA journal_mode`） | ✅ `journal_mode = "wal"`（继承自库文件，经统一封装 `openBunDatabase()`；**未新增任何 PRAGMA 代码**）；同步验证 promoted 列写入/读回正确 |
| PRAGMA 覆盖面复核 | 全仓 `bun:sqlite` 直连扫描 | ✅ 仅剩 **1** 处（封装 `core/external/sqlite3.ts` 内部）⇒ D-241 归一化后**无新增绕过**；本项未引入直连 |

### 5.1 实施偏差与范围说明（如实）

1. **新增端口方法 `writePdcaWorkItem`**（spec §3.2/§3.3 未列）：`pdca-handlers.writeWorkItem` 原写 JSON 文件 ⇒ 若不重定向到 `workitems` 表，`syncPdcaWorkItemStatus` 读表将永远为空（业务语义回归）。为守分层（service ↛ app 直连）经端口暴露。
2. **写队列串行化**（spec 只提"事务/原子 UPSERT"）：`bun:sqlite` 单连接且封装为异步，"读改写"跨 `await` 会交错 ⇒ 必须经**写链串行化**才真正原子（队列仅守本模块单连接，非应用级锁）。
3. **`getStore()` 按 dbPath 键控 + 新增 `closePdcaCheckpointStore()`**：作为 spec「给单例注入 dbPath」的等价隔离手段；跨文件共享进程时按 env 自动重建；测试清理前关闭（避 Windows EBUSY）。
4. **测试隔离面扩大**（`stageOrchestrator` / `incrementalReplan` / `batchParallel` / `PdcaLauncher` close）：spec §3.4 仅列 5 文件；扩面为**必需**（否则写真实库）。
5. ⚠️ **`workitems` 历史 JSON 未迁移**（迁移函数范围仅 checkpoints）：旧 WorkItem JSON 保留但**不再被读**。依据 `.trae/rules/project_rules.md` §1.3「当前应用无正式用户 ⇒ 迁移无需向后兼容」；若需保留在途 WorkItem 可见性，可另立小项扩迁移范围。
6. **WAL 口径更正（2026-10-05 复查）**：初版方案把 "复用 WAL" 写得像是本项要**做的事**；复查后确认 —— **WAL 早已统一处理**（台账 **D-241**：PRAGMA 单一事实源 `openBunDatabase()`；全仓 `bun:sqlite` 直连已清零），本项**只需经统一封装连接即自动继承**，**不新增任何 PRAGMA 代码**（见 D8 + §5 WAL 取证行）。

---

## 6. 变更记录

| 时间 | 变更 |
|---|---|
| 2026-10-05 | 初版：问题取证 + 决策 D1–D7 + 表结构 + 调用面（10 源文件 / 5 测试）+ 验收（含并发原子性） |
| 2026-10-05 | **实施完成**：`PdcaWorkItemBridge` 重写为惰性单例 + `pdca_checkpoints`/`workitems` 表 + 写链串行化原子 UPSERT；`prewarm`/`ckFileMemo`/文件 I/O 全删；`prune` 改条件 `DELETE`；新增 `migratePdcaCheckpointsFromJson`（幂等、不删原文件）+ `writePdcaWorkItem` 端口；11 源 + 9 测试文件改 `await`；新增 `pdcaCheckpointSqlite.test.ts`（并发原子性 + 迁移幂等）。门槛全绿（4398 pass / 0 fail）。偏差见 §5.1 |
| 2026-10-05 | **WAL 复查 + 口径更正**：确认 WAL/PRAGMA 项目内**早已统一处理**（台账 D-241，单一事实源 `openBunDatabase()`；全仓 `bun:sqlite` 直连已清零，复核仅剩封装内部 1 处）⇒ 新增 **D8**「不新增任何 PRAGMA 代码」；运行时取证 `journal_mode = "wal"`（新 store 经封装继承） |
