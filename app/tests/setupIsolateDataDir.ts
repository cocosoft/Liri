/**
 * 测试全局隔离：默认数据目录重定向到进程级临时目录（2026-11-20）
 *
 * **背景（真机取证）**：`goalStartFailureCloseOut.test.ts` 曾把 `/goal` 目标行写进**真实**
 * `~/.pyapp/data/app.db`（全量套件里默认单例已被先跑的用例按真实路径初始化，晚设
 * `LIRI_DATA_DIR` 无效），这些 `active` 且永不终态的目标随后被应用启动期的「目标续接」
 * （`GOAL_STARTUP_RESUME`，默认开）反复执行 —— 真机累积 346 条 `写一个文件` 测试目标。
 *
 * 单点修掉那个用例后，对真实库 98 张表做「停 daemon → 拍快照 → 跑全量套件 → diff」，
 * 仍发现 **9 张表增长**（`usage_records` / `goal_metrics` / `task_goals` / `taor_checkpoints` /
 * `inbox_items` / `approval_audit_log` / `review_samples` / `file_files_fts_*`）——
 * 即"单测写真实库"不是某个用例的个案，而是**所有未显式隔离数据目录的用例**的共性：
 * 它们经进程级单例（`getTaskGoalStore()` / `sharedTaskStore` / `inboxManager` /
 * `GoalMetricsService` …）落盘，路径来自 `resolveDbPath()` ⇒ 默认即生产库。
 *
 * **处置（根因，而非逐 store 打补丁）**：preload 阶段把 `LIRI_HOME` 指到临时目录
 * ⇒ `resolvePyappHome()` 默认取它、`resolveDataDir()` 即 `<临时>/data`；
 * 生产不设该变量 ⇒ 行为不变。
 *
 * **为什么选 `LIRI_HOME` 这个最低优先级的缝**（实测取舍，见下方三层优先级）：
 * 1. `resolvePyappHome`：`setUserDataDirOverride()` **优先于** `LIRI_HOME` ⇒
 *    仓内约 40 个用 override 的测试文件（`pathsResolvers` / `tenantPurge*` / `enterpriseAuditOwnership` …）
 *    仍用自己的临时目录，**不受影响**；
 * 2. `resolveDataDir`：`LIRI_DATA_DIR` **优先于** `resolvePyappHome()` ⇒
 *    另约 40 个设 `LIRI_DATA_DIR` 的文件同样不受影响；
 * 3. 两者都没设的用例才落到本 preload 的临时 home —— 也就是真正会写生产库的那批。
 *
 * **曾试过并否决的方案**：preload 设 `LIRI_DATA_DIR`（env）⇒ env 压过 override，
 * 使上述 override 类用例的"自己隔离"失效（全量实测 9 例红：`usageStatsOwnerScope` 3→7 行、
 * `enterpriseAuditOwnership` 落盘超时、`ruleSourceAndRemovalHint` 1→2 条规则…），故放弃。
 *
 * **为什么还要 `beforeEach` 兜底**：`bun test` 的 preload **每进程只跑一次**（探针实测：
 * 两个测试文件只记录一行），而仓内多处沿用 `afterAll` 里 `delete process.env.LIRI_HOME`
 * 的旧写法 —— 这会**抹掉**本 preload 设的默认值，使同进程后续文件又回落到真实库。
 * 实测（同一探针）：preload 注册的 `beforeEach` **对后续所有测试文件都生效** ⇒
 * 仅在"变量已缺失"时补回默认值，既修复删除泄漏，又不覆盖用例显式设置的值。
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach } from 'bun:test';

const KEY = 'LIRI_HOME';
const PREFIX = 'liri-test-home-';

/**
 * 兜底清扫：删除**上一轮遗留**的同前缀临时 home（实测 `bun test` worker 终止时
 * 不一定会执行 `process.on('exit')`，与 `setupIsolateAgentStore` 同一现象）。
 * 只删 **mtime 超过 1 小时** 的目录 ⇒ 不会误删并发 worker 正在用的目录。
 */
function sweepStaleHomes(): void {
  const staleMs = 60 * 60 * 1000;
  const now = Date.now();
  try {
    for (const name of readdirSync(tmpdir())) {
      if (!name.startsWith(PREFIX)) continue;
      const full = join(tmpdir(), name);
      try {
        if (now - statSync(full).mtimeMs < staleMs) continue;
        rmSync(full, { recursive: true, force: true });
      } catch {
        // @ignore-catch: 单目录清扫失败不影响测试
      }
    }
  } catch {
    // @ignore-catch: 临时目录不可读时跳过清扫
  }
}

sweepStaleHomes();

const tempHome = mkdtempSync(join(tmpdir(), PREFIX));

// 幂等：CI / 开发者显式指定了用户级根时尊重之（与 setupIsolateSecurityAudit 同口径）
if (!process.env[KEY]?.trim()) {
  process.env[KEY] = tempHome;
}

beforeEach(() => {
  // 只补"被 afterAll 删掉"的默认值；用例自己设的临时目录保持不动
  if (!process.env[KEY]?.trim()) {
    process.env[KEY] = tempHome;
  }
});

// 进程退出回收临时目录（worker 被强杀时不执行，残留由系统临时目录策略清理）
process.on('exit', () => {
  try {
    rmSync(tempHome, { recursive: true, force: true });
  } catch {
    // @ignore-catch: 退出路径，清理失败无补救价值
  }
});
