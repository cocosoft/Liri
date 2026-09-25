# Spec：迁移注册表与版本中枢（P2-9）

> 版本 1.0 ｜ 创建 2026-09-25 ｜ 状态：**待评审（未实施）**
> 来源：`多Agent与长程任务-对标分析报告.md` §五 **P2-9**「缺迁移/版本演进模块」+ §六 建议（对标 codex `state/src/runtime/rollout_migration.rs`、`cli/src/state_db_recovery.rs`）；台账 N-64
> 关联规则：GR15（Spec-Driven）/ GR01（基础设施复用）/ CS01（归一化）/ CS03（回退最小化）/ CS04（零 Mock）/ CS05（根因优先）/ R06-008（分层）/ `project_rules` §1.1（**仅允许新增表**，禁删改结构）/ §1.5（唯一 `app.db`）/ §1.3（无正式用户 ⇒ **无向后兼容负担**）
> 对标边界（如实声明）：codex 侧仅有**模块存在性证据**，未读其实现 ⇒ 只借"迁移/恢复是一等公民、有独立模块与测试"的判断准则，不搬其 schema 或流程。

---

## 1. Problem Statement

本仓**已有 6 套互不知情**的版本/迁移机制，但没有统一注册表，也**没有"哪些迁移已应用"的持久记录**：

| # | 设施 | 形态 | 版本记录 | 证据 |
|---|---|---|---|---|
| 1 | 配置级迁移框架 + `/migrate` | `MigrationStep{fromVersion,toVersion,apply(configDir)}` + 逐步执行/报告 | **无**（现场判定） | `app/src/commands/migrate/MigrateCommand.ts:20-44`、`:88-126`、`:128-188` |
| 2 | AppState 迁移 | `initializeAppState` / `migrateModuleState` | **无** | `app/src/core/migration/StateMigrator.ts` |
| 3 | 记忆 schema 迁移 | **真实逐版迁移**（`while (current < CURRENT)`） | 文件级 `MemoryMetadata.CURRENT_SCHEMA_VERSION = 2` | `memory/types/MemorySchemaRegistry.ts:91`、`memory/types/MemoryMetadata.ts:31` |
| 4 | 知识文件迁移 | frontmatter `schema_version` 迁移 | 文件级 | `knowledge/KnowledgeSchemaMigration.ts:16/84-98` |
| 5 | 上下文快照 | **版本门**（major 不匹配即抛错，**非**迁移） | `'1.0'` | `context/persistence/ContextPersistence.ts:32/66-69` |
| 6 | sqlite store | 各自 `schema_version` + 幂等 DDL + `PRAGMA table_info` 驱动 ALTER | 各 store 元数据表 | `tools/AgentTool/AgentRunStore.ts:16/37-42/274-289` 等 |

**缺口（可证）**：`app_metadata` / `applied_migrations` / `migration_version` / `schema_migrations` 全仓**零命中** ⇒ 无统一注册表、无已应用记录 ⇒ **无法回答"本安装处于哪个版本、哪些迁移已跑过"**；且失败后**没有恢复手段**（配置迁移失败即中断，无快照）。

**根因（单点）**：缺少**迁移的中枢**（注册表 + 已应用记录 + 恢复），各机制只能各自为政。

---

## 2. 目标 / 非目标

**目标**
- G1：**MigrationRegistry** —— 各子系统把自己的**跨版本迁移**登记为条目（`id` 全局唯一），提供 `listRegistered()` / `runAll()`。
- G2：**版本中枢表** `app_migrations`（唯一 `app.db`）—— 记录每条迁移的 `applied|failed|reverted` + 时间 + 错误 + 快照路径；**幂等由中枢判定**（已 `applied` 即跳过）。
- G3：**可恢复/回滚**（C 的核心）—— 以 **"执行前快照 + 失败恢复"** 实现（**不做逆向迁移**：`§1.1` 禁删改库结构，且多数 DDL 不可逆）；提供 `--dry-run` 预演与 `recover` 恢复。
- G4：**可回答"当前版本"**：`status()` 汇总"各 module 的已应用最高版本 + 待执行迁移"。

**非目标（明确不做）**
- N1：**不改各 store 的幂等 init 自愈**（`init()` 内的建表/`ALTER ADD COLUMN`/写 `schema_version` 是"自愈"，不是版本迁移）—— 注册表**只管跨版本数据迁移**。
- N2：不做**逆向迁移脚本**（`down()`）；回滚 = 恢复快照（见 G3）。
- N3：不删改任何既有表结构（`§1.1`）；仅**新增** `app_migrations`。
- N4：不引入自动"启动即迁移"的隐式行为（迁移可能改数据 ⇒ 默认**显式触发**；启动期最多输出"存在待执行迁移"提示，见 D3）。
- N5：不改 `MemorySchemaRegistry` / `KnowledgeSchemaMigration` / `ContextPersistence` 的内部迁移算法（仅**登记**其存在与版本观测，见 D4）。
- N6：不引入特性开关；回滚 = 删新文件 + 还原 `MigrateCommand` 的一处调用。

---

## 3. 设计

### 3.1 落点与分层

- 内核：`app/src/core/migration/MigrationRegistry.ts`（与既有 `StateMigrator.ts` **同目录**，不新增顶层模块）。
- 中枢存储：`app/src/core/migration/AppMigrationStore.ts`（新表 `app_migrations` 落唯一 `app.db`；沿用仓内 store 惯例：`constructor(dbPath = resolveDbPath())` + `init()` 建表 + 回调式 `db.run/all/get`，参照 `AgentRunStore` / `YieldWaitingStore`）。
- 命令层：**扩展既有** `commands/migrate/MigrateCommand.ts`（`/migrate` 走注册表；新增 `--dry-run` / `recover` / `status`），**不新建命令**（CS01）。
- 分层：`core/migration` **不得** import 业务模块（R06-008）⇒ 各业务迁移的 `apply` 由**调用方注册**（在各自的 bootstrap/命令层），内核只持接口。

### 3.2 数据模型（唯一新增表）

```sql
CREATE TABLE IF NOT EXISTS app_migrations (
  id            TEXT PRIMARY KEY,   -- 全局唯一，约定 "<module>.<from>->.<to>"（如 "agent_runs.2->3"）
  module        TEXT NOT NULL,
  from_version  TEXT,
  to_version    TEXT NOT NULL,
  status        TEXT NOT NULL,      -- applied | failed | reverted
  applied_at    INTEGER,
  last_error    TEXT,
  snapshot_path TEXT,               -- 快照目录（可空：entry 声明无需快照时）
  updated_at    INTEGER NOT NULL
);
```

- **幂等**：`runAll()` 对 `status='applied'` 的 id **直接跳过**（不重复执行）；`failed` 可重试；`reverted` 允许再次执行。
- **单向状态机**（对齐仓内 I4 手法）：`applied` 为终态，禁止被改回；`failed → applied`（重试成功）与 `failed → reverted`（恢复）允许。

### 3.3 注册表条目

```ts
export interface MigrationEntry {
  /** 全局唯一 id（约定 `<module>.<from>->.<to>`） */
  id: string;
  module: string;
  fromVersion?: string;
  toVersion: string;
  description: string;
  /** 是否需要执行前快照（默认 false；DDL/大批量改写类建议 true） */
  requiresSnapshot?: boolean;
  /** 受影响的资源根（供快照与恢复）；缺省 = 不产快照 */
  snapshotTargets?: string[];
  /** 执行体（幂等由中枢保证；实现应为"一次成功即安全重入"） */
  apply: (ctx: MigrationContext) => Promise<{ warnings?: string[] }>;
}

export interface MigrationContext {
  /** 该次运行的快照目录（`requiresSnapshot` 时非空） */
  snapshotDir?: string;
  /** 预演模式：**不得**产生副作用 */
  dryRun: boolean;
  logger: Logger;
}

export function registerMigration(entry: MigrationEntry): void;  // 重复 id ⇒ 抛 AppError（fail-closed）
export function listRegistered(): MigrationEntry[];
```

### 3.4 执行、快照与恢复（C 的核心）

- **`runAll(opts?: { dryRun?: boolean; only?: string[] }): Promise<MigrationRunReport>`**
  1. 取中枢已应用集合 ⇒ 过滤出"待执行"（含 `failed` 重试）；
  2. **顺序**：按 `module` 分组，组内按注册顺序（`toVersion` 升序）；**默认 fail-fast**（失败即停止后续 —— 迁移改动数据，半途继续会放大不一致）；
  3. 每条：`dryRun` ⇒ 只记录"将执行"；否则：
     - `requiresSnapshot` ⇒ 先对 `snapshotTargets` 打快照到 `~/.pyapp/data/migration-backups/<runId>/<id>/`（文件复制；sqlite 用 `VACUUM INTO` 或文件复制）；
     - 执行 `apply(ctx)` ⇒ 成功写 `applied`；抛错 ⇒ 写 `failed` + `lastError`，**若已打快照则自动恢复**（并把该条置 `reverted`，`reason=auto-recover`），随后停止；
  4. 返回报告（每条：id / 状态 / 耗时 / warnings）。
- **`recover(opts?: { id?: string }): Promise<MigrationRunReport>`**（对标 codex `state_db_recovery` 的最小可行形态）
  - 对 `failed`（或 `--id` 指定）条目：若 `snapshot_path` 存在 ⇒ 恢复快照 + 置 `reverted`；若不存在 ⇒ **如实报"无可恢复快照"**（不假装成功）。
- **快照保留**：`runAll` 成功后按 `MIGRATION_SNAPSHOT_RETENTION_DAYS`（默认 7 天）清理（幂等；删除失败仅记 WARN）。
- **`status()`**：输出 `[{ module, appliedMax: string, pending: string[] }]` —— **回答"当前版本"**。

### 3.5 命令层（扩展 `/migrate`）

| 用法 | 行为 |
|---|---|
| `/migrate` | 等价 `runAll()`（既有配置迁移步骤**迁入注册表**后一并执行，见 D2） |
| `/migrate --dry-run` | 预演：列出将执行/将跳过的条目，**不改动任何数据**（验收含"零副作用"断言） |
| `/migrate status` | 各 module 的 `appliedMax` + `pending` |
| `/migrate recover [--id <id>]` | 对失败条目恢复快照 |

### 3.6 既有 6 套机制的处置（**登记而非重写**）

| # | 机制 | 处置 |
|---|---|---|
| 1 | `MigrateCommand.getMigrations()` | **迁入注册表**（`apply(configDir)` 的语义保留：包成 `apply(ctx)` 的闭包），命令改为消费注册表（D2） |
| 2 | `StateMigrator` | **登记**为条目（若其含跨版本步骤）；无版本语义的部分保持不动 |
| 3 | `MemorySchemaRegistry` | **登记**：`module='memory'`，`from→to` 取 `MemoryMetadata.CURRENT_SCHEMA_VERSION`；`apply` **委托**既有 `migrate()` 逻辑（不重写，N5） |
| 4 | `KnowledgeSchemaMigration` | **登记**（`module='knowledge'`） |
| 5 | `ContextPersistence` | **仅登记版本观测**（它是版本门，不迁移；`status()` 里如实标注"版本门，无迁移"） |
| 6 | 各 sqlite store | **不登记**（属"幂等自愈"，N1）；仅在 `status()` 的说明中注明其 `schema_version` 自管 |

---

## 4. 决策点（请评审确认）

| ID | 决策（建议） | 理由 |
|---|---|---|
| D1 | 回滚 = **快照恢复**，不做逆向迁移/`down()` | `§1.1` 禁删改库结构 ⇒ 多数 DDL 不可逆；`down()` 会诱导危险操作 |
| D2 | 既有 `MigrateCommand.getMigrations()` **迁入**注册表（而非并存） | 避免"两套配置迁移清单"（CS01 双轨禁止） |
| D3 | **不自动在启动期执行**迁移；启动期最多输出"存在 N 条待执行迁移"提示 | 迁移改数据，隐式执行风险高；`§1.3`（无正式用户）也意味着几乎无待执行项 |
| D4 | 记忆/知识迁移**登记但委托既有实现** | 不重写已验证的迁移算法（CS01/CS03） |
| D5 | 默认 `fail-fast` + 失败自动恢复快照 | 迁移半途继续会放大不一致；恢复用快照最直接 |
| D6 | 仅**新增** `app_migrations` 一表 | `§1.1` 允许新增；中枢需要持久"已应用"记录 |

---

## 5. 影响文件（预计）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/core/migration/MigrationRegistry.ts` | **新建**：`MigrationEntry` / `MigrationContext` / `registerMigration` / `listRegistered` / `runAll` / `recover` / `status`（快照与恢复逻辑） |
| 2 | `app/src/core/migration/AppMigrationStore.ts` | **新建**：`app_migrations` 表 CRUD + 单向状态机 + 幂等查询 |
| 3 | `app/src/commands/migrate/MigrateCommand.ts` | **改**：消费注册表；新增 `--dry-run` / `status` / `recover`；`getMigrations()` 迁入注册表 |
| 4 | `app/src/commands/migrate/index.ts` | **改**（如需）：注册既有配置迁移步骤 |
| 5 | `app/src/memory/types/MemorySchemaRegistry.ts`（或其在 bootstrap 处的调用点） | **改（登记）**：把既有迁移注册进注册表（**委托**原实现） |
| 6 | `app/tests/migration/migrationRegistry.test.ts` | **新建**：注册表（id 唯一/重复抛错/顺序）、中枢（幂等跳过/状态机/失败记录）、`dryRun` 零副作用、快照恢复、`recover` 无快照时如实报错 |
| 7 | `app/tests/migration/appMigrationStore.test.ts` | **新建**：建表幂等 / 跨实例持久化 / 单向状态机 / `failed→applied` 与 `failed→reverted` |
| 8 | `.trae/docs/api-spec.md` | **本批不加**（无 HTTP/IPC 端点） |

---

## 6. 验收方案

| 项 | 通过标准 |
|---|---|
| 类型/架构 | `typecheck` 0；`lint:arch` 错误/警告不增加（当前基线 0/0；`core/migration` 不得 import 业务模块） |
| 注册表 | 重复 `id` ⇒ 抛 `AppError`；`listRegistered()` 顺序稳定；`runAll({ only })` 过滤正确 |
| 中枢幂等 | 已 `applied` 的条目**二次 `runAll` 不执行**（用 `apply` 调用计数断言）；`failed` 可重试成功转 `applied` |
| 单向状态机 | `applied` 不可被改写（断言 store 层拒绝） |
| **dry-run** | `runAll({ dryRun: true })` ⇒ **零副作用**（断言：快照目录不存在、中枢无新行、`apply` 未被调用） |
| 快照恢复 | `requiresSnapshot` 条目执行失败 ⇒ 快照被恢复（受控文件内容回到执行前）+ 中枢置 `reverted`；`recover()` 对无快照条目**如实报错** |
| 回归 | 全量 `bun test` 0 fail（当前基线 **3630 pass / 19 skip / 0 fail**）；`/migrate` 既有行为（配置迁移）回归通过 |
| 未做（明确） | 逆向迁移 `down()`；启动期自动迁移；跨进程迁移锁；迁移链可视化 UI |

---

## 7.5 实施结果（2026-09-25）

| 项 | 结果 |
|---|---|
| G1 注册表 | ✅ 新建 `app/src/core/migration/MigrationRegistry.ts`：`MigrationEntry` / `MigrationContext` / `registerMigration`（**重复 id ⇒ 抛 `AppError`**）/ `listRegistered`（顺序稳定）/ `resetMigrationRegistry`（测试用） |
| G2 版本中枢 | ✅ 新建 `app/src/core/migration/AppMigrationStore.ts`：新表 `app_migrations`（9 列）落唯一 `app.db`；`upsert()` 带**单向状态机守卫**（`canTransitionMigration`：`applied` 终态 ⇒ 返回 `false` 拒绝改写）；store 模式对齐 `YieldWaitingStore`（`initPromise` 失败清空） |
| G3 可恢复 | ✅ `runAll()`：`requiresSnapshot` ⇒ 执行前 `takeSnapshot()`（`~/.pyapp/data/migration-backups/<runId>/<id>/` + **`manifest.json`** 记录 target 顺序与"迁移前是否存在"）；失败 ⇒ **自动 `restoreSnapshot()`** 并置 `reverted`；`recover({id?})` 独立恢复入口（**无快照时如实报 error**，不假装成功）；`cleanupMigrationSnapshots()` 按 7 天裁剪。**不做逆向迁移**（D1） |
| G4 版本视图 | ✅ `getMigrationStatus()` ⇒ 各 module 的 `appliedMax` + `pending` |
| 命令层 | ✅ `/migrate` 扩展：`status` / `recover [--id]` / `--dry-run`；既有两条配置迁移**迁入注册表**（`registerConfigMigrations()` 幂等注册，D2 消除双轨）；`MigrationReport`/`getMigrations()` 被注册表消费替代（对外文案口径保持：结论行 + 应用/跳过/失败计数 + 逐条明细） |
| 接线 | ✅ `core/index.ts` 桶补导出（`core/migration/` 内部用相对路径 `../paths` ⇒ **无环**） |
| 验证 | ✅ 新增 **16 例**（store 5：建表幂等 / 字段往返+跨实例持久化 / `applied` 终态拒改 / `failed→applied` / `failed→reverted`；registry 11：重复 id 抛错 / 顺序稳定 / **module 分组顺序** / **幂等跳过** / **dryRun 零副作用** / **fail-fast** / **失败自动恢复快照** / `recover` 无快照如实报错 / `recover` 有快照恢复 / `status` 的 appliedMax+pending / 清理幂等）；`typecheck` 0；改动文件 `eslint` 0（13 处 prettier 已 `--fix`）；`lint:arch` **0 错 0 警**；全量 **3646 pass / 19 skip / 0 fail**（3665 tests / 362 文件） |
| **未做（如实，与 §5 清单的偏离）** | ① **记忆 / 知识 / state 三类迁移未登记** —— 取证发现 `MemorySchemaRegistry`（`needsMigration(meta)` + 逐条迁移）与 `KnowledgeSchemaMigration`（逐文件 frontmatter 迁移）均为**逐条按需迁移、无批量入口** ⇒ 若要登记必须**新写"遍历 + 迁移"逻辑**，超出 N5（不重写既有迁移算法）⇒ 本轮**不登记**（不造空壳条目）；其版本仍由各自 `CURRENT_SCHEMA_VERSION` 表达 ⇒ `status()` 只覆盖**已注册**模块（如实，不虚报覆盖）。② §5 清单外新增 1 个文件：`app/src/core/index.ts`（桶导出）。③ `MigrateCommand` 内部的 `MigrationReport` 类型与 `getMigrations()` 清单被替换（CLI 语义保持） |

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先于实现创建；经评审后再动代码 |
| GR01 基础设施复用 | ✅ 复用既有迁移实现（配置迁移/记忆/知识**登记委托**，不重写）；store 模式复用 `AgentRunStore` 手法；命令**扩展**既有 `/migrate` |
| CS01 归一化 | ✅ 已检索：`app_migrations`/`applied_migrations` 零占用（可新增）；`core/migration/` 目录已存在（不新增模块）；迁移清单**收敛为一份**（D2） |
| CS03 回退最小化 | ✅ 仅保留"失败自动恢复快照"这一有真实场景的回退（迁移改数据，失败必须可回）；不为不可能场景加兜底 |
| CS04 零 Mock | ✅ 无 mock/假数据；测试用临时 dataDir + 真实 store |
| CS05 根因优先 | ✅ 根因是"无迁移中枢" ⇒ 建中枢，而非在每个迁移点加补丁 |
| R06-008 分层 | ✅ `core/migration` 零业务 import（`apply` 由调用方注册） |
| `project_rules` §1.1 | ✅ **仅新增** `app_migrations`；不做逆向 DDL；不改既有表结构 |
| `project_rules` §1.5 | ✅ 落唯一 `app.db`；快照落 `~/.pyapp/data/migration-backups/`（经 `paths.ts`） |
| `project_rules` §1.8/§1.9 | ✅ 日志走 `getLogger('core:migration:registry')`；错误经 `handleError` / 记入中枢 `last_error` |
| PY_APP §2 简洁优先 | ✅ 不做 `down()`、不做 UI、不做跨进程锁；`apply` 只承载"一次成功即安全重入"的最小契约 |

---

## 8. 风险与边界（如实）

1. **收益存疑（我在提案时已提示）**：本仓**无正式用户、无向后兼容负担**（`§1.3`）⇒ 现存待迁移数据几乎为零，本项的价值主要在 ① 未来版本演进的**制度落点**（有中枢可登记）② 外部数据漂移/多版本并存的**可恢复性**。若评审认为"当前不值"，可退化为只做 **A（注册表 + 统一入口，无新表）**。
2. **快照成本**：sqlite 复制/`VACUUM INTO` 有体积与耗时成本 ⇒ 仅对 `requiresSnapshot: true` 的条目执行（默认 false）。
3. **"回滚"语义必须诚实**：快照恢复是"回到执行前状态"，**不是**"迁移的逆运算"；对"外部系统副作用"（如已发出的 HTTP 请求）无回滚能力 —— spec 与命令输出都需如实说明。
4. **既有 `/migrate` 行为变更**：把 `getMigrations()` 迁入注册表会改变命令内部结构（对外 CLI 语义保持）⇒ 需回归 `/migrate` 既有用例。
5. **对标口径**：codex 侧仅模块存在性证据，本 spec 未断言其行为；本仓的"恢复"是**快照恢复**，与 codex 的 `state_db_recovery` **不等价**（如实标注，不外推）。
6. **不做跨进程迁移锁**：并发运行两次 `/migrate` 的理论风险存在（本仓单机单实例为主）⇒ 本轮不做；如需另立 spec。
