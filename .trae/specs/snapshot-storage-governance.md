# 快照存储治理（`data/snapshots/`）—— 可观测性补强

> **状态**：✅ **已实施（2026-09-29，用户指令「先处理 snapshots 存储治理」）**
> **来源**：[`toolchain-checkpoint-atomic-rollback.md`](./toolchain-checkpoint-atomic-rollback.md) §2「剩余真实问题 1」（台账 **D-18** 同批发现）
> **关联规则**：GR01（基础设施复用）/ GR02（实现唯一性）/ GR03（证据驱动）/ CS01（新增前先查已有）/ CS03（回退最小化）/ CS05（根因优先）/ §1.8（日志）/ §1.13（路径）
> **最后更新**：2026-09-29

---

## 1. 取证：**治理机制已存在**（先证"已有什么"，避免重造）

| 事实 | 证据 |
|---|---|
| **配额淘汰已实现** | [`CleanupManager.enforceSnapshotQuota()`](../../app/src/security/rollback/CleanupManager.ts#L140-L209)：`DEFAULT_QUOTA_BYTES = 5 * 1024^3`（[:49](../../app/src/security/rollback/CleanupManager.ts#L49)）；**最旧优先**（按 `createdAt` 升序，[:173-175](../../app/src/security/rollback/CleanupManager.ts#L173-L175)）；**清理到配额的 80%**（[:177](../../app/src/security/rollback/CleanupManager.ts#L177)）；**边界保护**（"只有 1 轮快照不误删"，[:187-196](../../app/src/security/rollback/CleanupManager.ts#L187-L196)） |
| **启动钩子已接线（活的）** | `onApplicationStart()`（[:215-219](../../app/src/security/rollback/CleanupManager.ts#L215-L219)）→ `cleanupInterruptedRounds()` + `enforceSnapshotQuota()`；← [`RollbackIntegration.onAppStart():130-131`](../../app/src/security/rollback/RollbackIntegration.ts#L130-L131) ← [`ChatManager.ts:2786`](../../app/src/chat/ChatManager.ts#L2786) |
| **实测占用** | `~/.pyapp/data/snapshots` = **527 文件 / 5007.4 MB**（配额 5120 MB）⇒ **未超限** ⇒ 淘汰尚未触发，属**设计内驻留** |
| **另一处 `tmp/` 清理** | `cleanupInterruptedRounds()`（[:76-113](../../app/src/security/rollback/CleanupManager.ts#L76-L113)）：清"有临时目录但无 manifest"的中断轮次 |
| **⚠️ 台账旧表述需收窄** | 台账曾记"snapshots/ …**无按数量/年龄淘汰**" —— 经本 spec 取证：**存在"按大小"淘汰**（5 GB + 最旧优先）；缺的只是"按年龄/条数"维度（见 §2） |

---

## 2. 真缺口（三条；逐条给出**处置决定**）

| # | 缺口 | 证据 | 决定 |
|---|---|---|---|
| **1** | **可观测性缺口（主）**：`totalSize <= maxBytes` 时**直接 return，零日志**（[:145-147](../../app/src/security/rollback/CleanupManager.ts#L145-L147)）⇒ 运维**看不到"占了多少 / 离上限多远 / 有多少条"**，与 PDCA 留存先例（启动打印 `{maxAgeDays, scanned, pruned, keptFresh, keptActive, errors}`）**不一致** | 见左 | ✅ **本轮修**（零风险、纯增量） |
| **2** | **配额口径不含 `tmp/`**：`getTotalSnapshotSize()`（[:378-404](../../app/src/security/rollback/SnapshotStorage.ts#L378-L404)）只累加**已 finalize 轮次**的 `manifest.totalSize`；`tmp/` 与索引/锁文件不计 | 见左 | ⏸ **不改**（`cleanupInterruptedRounds()` 已在配额**之前**清 tmp ⇒ 实测残留 ≈ 0，改它属"为理论可能性加机制"）；**仅在巡检日志中补"条数"**以提升可见性 |
| **3** | **同目录多写者（已取证更正：另一写者其实是死的）** | `data/snapshots` 名义上有两个写者：`security/rollback` 与 [`performance/MemorySnapshotService`](../../app/src/performance/MemorySnapshotService.ts#L84)（`resolveDataSubDir('snapshots')`）。**但 2026-09-29 复核：`MemorySnapshotService` 全仓零消费者**（无任何 `import`；`memorySnapshotService` / `captureMemorySnapshot` 仅在本文件内定义）⇒ **它从不写入** ⇒ 该"混放"**不是活问题** | ✅ **已处置（2026-09-29）**：**不做**目录隔离（对方**从未写入**，隔离无意义）；`MemorySnapshotService` 作为死模块**已删除**（台账 **D-20**；`typecheck` 0 + 全量测试与删除前一致） |

**明确不做（附理由）**：
- ❌ **不加"按年龄淘汰"**：快照是 **undo/redo 的数据源** ⇒ 按年龄删会**静默削弱 undo 能力**（用户"撤销到上一轮"可能失效）。大小配额（最旧优先）已是"在保留 undo 与限制磁盘之间"的合理折中。
- ❌ **不引入配额配置面**：`DEFAULT_QUOTA_BYTES` 为常量，与既有先例一致（`MEMORY_MAX_COUNT = 1000`、`PDCA_CHECKPOINT_RETENTION_DAYS = 30` 均为常量）⇒ 按 CS03 **不做未被要求的可配置性**。
- ❌ **不动淘汰逻辑**（配额值、80% 目标、边界保护、排序键**全部保持**）。

---

## 3. 方案（最小改动）

在 `CleanupManager` 内：

1. 新增**轻量计数** `countFinalizedSnapshots()`：**只列目录 + 探 `manifest.json` 是否存在**（不解析 manifest），`tmp/` 不算；与 `getTotalSnapshotSize()` 并行使用（一个给"字节"、一个给"条数"）。
2. `enforceSnapshotQuota()` **始终**输出一条巡检日志；超限时的 `warn` / `info` 增补同一组字段。

统一字段：`{ totalBytes, quotaBytes, usagePercent, snapshotCount, cleaned, freedBytes }`。

---

## 4. 验收

| # | 判据 | 方式 |
|---|---|---|
| A1 | 未超限 ⇒ 返回 `{cleaned:0, freedBytes:0}` **且不删任何快照**，同时输出带 `totalBytes/quotaBytes/usagePercent/snapshotCount` 的 INFO | 新增离线用例 |
| A2 | 超限 ⇒ **删最旧**、`freedBytes > 0`、最旧 manifest 消失而最新仍在 | 新增离线用例（`LIRI_DATA_DIR` 指向临时目录） |
| A3 | 边界保护不变：全场仅 1 个快照且超限 ⇒ **不删** | 新增离线用例 |
| A4 | 零回归 + 门禁 | `typecheck` / `eslint` / `prettier` / `lint:arch` |

**测试安全前提（已实测）**：`LIRI_DATA_DIR` **可重定向**快照根（`getSnapshotsRoot()` 在**调用时**解析，非模块级冻结）—— 实测 `LIRI_DATA_DIR=C:/tmp-probe-snap` ⇒ `root = C:\tmp-probe-snap\snapshots`。用例内**硬断言**根目录落在临时目录，避免误删真实 527 个快照。

---

## 5. 合规检查表

| 规则 | 落实 |
|---|---|
| GR01（基础设施复用） | **复用**既有 `enforceSnapshotQuota` / `getTotalSnapshotSize` / `getManifestPath`；**不新造**清理框架、不新建目录 |
| GR02（实现唯一性） | §2-#3 的"同目录多写者"**只登记不擅动**；本 spec 不新增第二套清理逻辑 |
| GR03（证据驱动） | §1 / §2 每条附 `文件:行`；并**收窄**了台账关于"无淘汰"的旧表述 |
| CS01（新增前先查已有） | §1 即该检查 ⇒ 结论是"治理已在位"，故本轮只补**可观测性** |
| CS03（回退最小化） | 不新增回退；不为 `tmp/` 的理论残留加机制；不引入可配置面 |
| CS05（根因优先） | 根因 = "**未超限即静默**"（看得到才能治理）⇒ 修日志而非改配额 |
| §1.8（日志） | 用既有 `logger`（module 沿用 `CleanupManager`）；INFO 级别为**启动期一次性**输出，不构成噪音 |

---

## 6. 不在范围 / 未验（如实）

- ❌ **不改**配额值、不改 80% 目标、不改排序键、不改边界保护。
- ❌ **不加**年龄/条数淘汰（§2 已给理由）。
- ✅ ~~**不改** `MemorySnapshotService` 与 rollback 同用 `data/snapshots` 的现状~~ ⇒ **该问题已不存在**：`MemorySnapshotService` **全仓零消费者**（§2-#3）⇒ 已于 **2026-09-29 删除**（台账 **D-20**），故**无需**做目录隔离。
- ✅ **已查明（2026-09-29，原写"旁路目录/来源未查明"—— 该表述作废）**：`~/.pyapp/snapshots`（3 个 `snapshot-<ts>.json`）**不是遗留、也不是旁路** —— 它是 **`ConfigSnapshot`（配置快照）** 的正常存储目录：`createDefaultConfigSnapshot(configDir)` 取 `join(configDir, 'snapshots')`（[`ConfigSnapshot.ts:148-151`](../../app/src/config/ConfigSnapshot.ts#L148-L151)），唯一入口 [`ConfigManager.ts:37/372`](../../app/src/config/ConfigManager.ts#L37)；文件内容实为**配置快照**（theme / channels / ai / settings.soul …，非 rollback 的轮快照）；且**已有条数上限** `DEFAULT_MAX_SNAPSHOTS = 3`（[:21](../../app/src/config/ConfigSnapshot.ts#L21)）—— 与实测**恰好 3 个文件**吻合 ⇒ **无需治理，也未删除**。
  ⚠️ 顺带甄别：`config/version/VersionController.ts` 另有一个**同名但不同物**的 `ConfigSnapshot` **interface**（内存版本历史，非落盘配置快照）⇒ 属"同名不同物"，已在台账登记，**本轮不动**。

---

## 7. 实施记录（2026-09-29）

| 项 | 落点 | 状态 |
|---|---|:--:|
| 轻量计数 `countFinalizedSnapshots()` | [`CleanupManager.ts:131-169`](../../app/src/security/rollback/CleanupManager.ts#L131-L169)（**只列目录 + 探 manifest**，不解析；`tmp/` 不计） | ✅ |
| **未超限也输出巡检** | [`CleanupManager.ts:189-199`](../../app/src/security/rollback/CleanupManager.ts#L189-L199)：`logger.info('快照存储巡检：未超限', { totalBytes, quotaBytes, usagePercent, snapshotCount })` | ✅ |
| 超限日志增补同组字段 | `warn`（[:201-206](../../app/src/security/rollback/CleanupManager.ts#L201-L206)）/ `info` 清理完成（[:264-270](../../app/src/security/rollback/CleanupManager.ts#L264-L270)） | ✅ |
| 常量口径注明 | [`DEFAULT_QUOTA_BYTES`](../../app/src/security/rollback/CleanupManager.ts#L48-L50) 就地写明"常量、单调用方不传参、按 CS03 不引入配置面" | ✅ |
| **淘汰逻辑零改动** | 配额值 / 80% 目标 / 排序键 / 边界保护**均未动** | ✅ |
| 测试（**该函数此前零覆盖**） | 新建 [`tests/security/snapshotQuota.test.ts`](../../app/tests/security/snapshotQuota.test.ts) **3 例**：未超限不删（A1）/ 超限删最旧且最新仍在（A2）/ 全场仅 1 条不删（A3） | ✅ |

**改动面（2 文件）**：`src/security/rollback/CleanupManager.ts`（+66 行，其中 38 行为计数助手）、`tests/security/snapshotQuota.test.ts`（**新建**）。

**验收（实测）**：
- 新增守卫 **3 pass / 0 fail**；实测日志已按预期输出 —— 未超限：`{totalBytes:200, quotaBytes:10000, usagePercent:2, snapshotCount:2}`。
- **安全核验**：测试运行前后 `~/.pyapp/data/snapshots` 文件数 **527 → 527**（**未被触碰**；用例内含"根目录必须落在临时目录"的硬断言）。
- `bun run typecheck` **0** · 改动文件 `eslint` **0** · `prettier` ✓ · `lint:arch` **0 错 1 警**（预存 R07-004）。

**未做（如实）**：① §2-#2（`tmp/` 不计入配额）**刻意不改**，仅在计数中排除；② §2-#3（同目录多写者）**只登记**；③ `~/.pyapp/snapshots` 旁路目录的**来源与去留未定**。
