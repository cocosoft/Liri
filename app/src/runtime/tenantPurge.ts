/**
 * tenantPurge.ts — 删除租户的数据清除（多租户 P5，方案 §2.7.7 最后一项）
 *
 * **目标**：`删除租户 ⇒ 数据、预算、事件、凭据全量清除`。
 *
 * 一个租户的数据面分两层，本模块按"先断流 → 再清行 → 最后删目录"的顺序处理：
 *   ① **分区目录** `<data>/tenants/<safe(tenantId)>`（会话 / 事件日志 / 租户 `app.db` /
 *      日预算状态 / 审计日志 / 工作区 / 凭据 / AlwaysOn 产物）—— 整目录删除；
 *   ② **共享单库里的归属行** —— `channel_configs.owner_key`（凭据与配置）、
 *      `cron_jobs.owner_key` / `task_flow.owner_key`（定时任务与任务流）；
 *   ③ **进程内内存态** —— 该租户的 SSE 长连接、通道实例、审批库连接、日预算账本、
 *      危险命令放行缓存、按身份缓存（凭据 / 会话存储 / 成本桶 / 自主运行配额 /
 *      分析埋点与工具调用桶 / trace 统计桶）；其余内存态（`ChatManager` 会话对象等）
 *      随进程重启清空，见 `notPurged`。
 *
 * **可安全重跑**：删除以"前缀匹配 + 不存在即跳过"实现，幂等；目录删除失败
 * （Windows 上仍有句柄）会记入 `blocked`，重启后重跑即可收敛。
 *
 * **拒绝删除本地身份**（`local`）：那等于清空宿主机自己的数据。
 */

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { resolveDataDir, resolveDbPath } from '@modules/environment';
import { safePathSegment } from '@modules/security/identity';
// 本地身份的租户标识（永远不允许被"删除租户"清掉）—— 单一真源在 identity/principal
import { LOCAL_TENANT_ID } from '@openliri/kernel/identity/principal.js';

const logger = getLogger('runtime:tenantPurge');

export interface TenantPurgeReport {
  tenantId: string;
  /** 归属键前缀（`<tenantId>:`） */
  ownerPrefix: string;
  removed: {
    /** 租户分区目录是否已删除 */
    tenantDataDir: boolean;
    /** `channel_configs` 删除的行数 */
    channelConfigs: number;
    /** `cron_jobs` 删除的行数 */
    cronJobs: number;
    /** `task_flow` 删除的行数 */
    taskFlows: number;
    /** `usage_records` 删除的行数 */
    usageRecords: number;
    /** `model_usage_logs` 删除的行数 */
    modelUsageLogs: number;
    /** `skill_usage_records` 删除的行数 */
    skillUsageRecords: number;
    /** `data/projects/<id>` 删除的目录数 */
    projects: number;
    /** 关闭的 SSE 连接数 */
    sseConnections: number;
    /** 断开的租户通道实例数 */
    tenantChannels: number;
    /**
     * 关闭的**按身份缓存的数据库连接**数（审批库 / 成本 / 执行 / 查询日志 / 供应商 /
     * LLM 跟踪 / 检查点 …；由 `core/identity/scopedResources` 登记器统一关闭）
     */
    scopedConnections: number;
    /** 丢弃的日预算账本数 */
    dailyBudgets: number;
    /**
     * 丢弃的**非 DB** 按身份内存缓存数（凭据实例 / 会话存储实例 / 成本累计桶 /
     * 自主运行配额 / 分析工具调用桶 / trace 统计桶）
     */
    scopedCaches: number;
    /** 清除的危险命令放行记录数 */
    approvedCommands: number;
  };
  /** 删除失败（通常是被文件句柄占用），重启后重跑即可 */
  blocked: Array<{ path: string; error: string }>;
  /**
   * **无法按租户定位**的数据面（如实登记，不做"看起来删了"的假动作）
   */
  notPurged: string[];
}

/** 明确不在本模块能力内、需要另行治理的数据面（常量，便于文档与告警对齐） */
const KNOWN_UNPURGEABLE = [
  '全局文件面 data/pairings、data/transcripts、data/attachments、data/fts-index（无归属索引）',
  '用户级全局目录 ~/.pyapp/{oauth,knowledge,skills,plugins}',
  '进程内 ChatManager 会话对象与待交互条目（重启即清）',
  '企业审批流 ApprovalWorkflow / ExecApprovalManager（当前无运行时接线）',
] as const;

/**
 * 判定"这个租户标识是否可被清除"（**唯一实现**：`purgeTenant` 与 HTTP 入口共用）。
 *
 * 单独抽出的原因：HTTP 侧要据此区隔 **400（请求不合法）** 与 **500（清除过程失败）**，
 * 而"读错误文案做判断"属 CS02 禁止的字符串匹配 ⇒ 判定必须是返回结构化结果的纯函数。
 */
export type PurgeTenantIdCheck =
  | { ok: true; tenantId: string }
  | { ok: false; message: string };

export function validatePurgeableTenantId(
  tenantId: string
): PurgeTenantIdCheck {
  const normalized = tenantId.trim();
  if (!normalized) {
    return { ok: false, message: '删除租户失败：tenantId 不能为空' };
  }
  if (normalized === LOCAL_TENANT_ID) {
    return { ok: false, message: '删除租户失败：local 是宿主身份，不允许清除' };
  }
  return { ok: true, tenantId: normalized };
}

/**
 * 删除一个租户的全部可定位数据（幂等、可重跑）
 *
 * @param tenantId 租户标识（组织标识）；空串 / `local` ⇒ 拒绝
 */
export async function purgeTenant(
  tenantId: string
): Promise<TenantPurgeReport> {
  const check = validatePurgeableTenantId(tenantId);
  if (!check.ok) {
    throw new Error(check.message);
  }
  const normalized = check.tenantId;

  const ownerPrefix = `${normalized}:`;
  const report: TenantPurgeReport = {
    tenantId: normalized,
    ownerPrefix,
    removed: {
      tenantDataDir: false,
      channelConfigs: 0,
      cronJobs: 0,
      taskFlows: 0,
      usageRecords: 0,
      modelUsageLogs: 0,
      skillUsageRecords: 0,
      projects: 0,
      sseConnections: 0,
      tenantChannels: 0,
      scopedConnections: 0,
      dailyBudgets: 0,
      scopedCaches: 0,
      approvedCommands: 0,
    },
    blocked: [],
    notPurged: [...KNOWN_UNPURGEABLE],
  };

  // ── 1. 先断流：SSE 长连接 / 租户通道实例 / 审批库连接 ──
  // 顺序在删数据之前：断流后不会再有新写入落到即将删除的目录里。
  await runStep(report, 'sse', async () => {
    const sse = await import('../infrastructure/http/LocalHTTPServiceSSE.js');
    report.removed.sseConnections =
      sse.closeSSEConnectionsForTenant(normalized);
  });

  await runStep(report, 'channels', async () => {
    const channels = await import('../channels/setupChannels.js');
    report.removed.tenantChannels =
      await channels.stopTenantChannels(ownerPrefix);
  });

  // 关闭该租户**全部**按身份缓存的数据库连接（审批库 / 成本 / 执行 / 查询日志 / 供应商 /
  // LLM 跟踪 / 检查点 / 会话黏性 / 任务 / 知识图谱 …）。
  // 不关 ⇒ Windows 上分区目录 `rmSync` 失败（记入 blocked）。关闭失败同样记 blocked（可重跑）。
  await runStep(report, 'scopedResources', async () => {
    const { closeScopedResourcesForTenant } =
      await import('@openliri/kernel/identity/scopedResources.js');
    const closed = await closeScopedResourcesForTenant(normalized);
    report.removed.scopedConnections = closed.closed;
    for (const failure of closed.failed) {
      report.blocked.push({
        path: `scopedResource:${failure.ownerKey}`,
        error: failure.error,
      });
    }
  });

  // ── 2. 清进程内账本（日预算 / 危险命令放行缓存）──
  await runStep(report, 'dailyBudget', async () => {
    const budget = await import('../query/DailyBudgetManager.js');
    report.removed.dailyBudgets = budget.forgetDailyBudgetForTenant(normalized);
  });

  await runStep(report, 'approvedCommands', async () => {
    const registry = await import('../permission/ApprovedCommandRegistry.js');
    report.removed.approvedCommands = registry
      .getApprovedCommandRegistry()
      .forgetOwnerPrefix(ownerPrefix);
  });

  // 丢**非 DB** 的按身份内存缓存（凭据实例 / 会话存储实例 / 成本累计桶 / 自主运行配额 /
  // 分析埋点与工具调用桶 / trace 统计桶）：
  // 留着会把文件写回已删目录，或让同名新租户继承旧用量与旧读数。
  await runStep(report, 'scopedCaches', async () => {
    const { CredentialStore } =
      await import('../ai/credentials/CredentialStore.js');
    const { forgetScopedStoragesForTenant } =
      await import('../session/gateway/ScopedStorageRegistry.js');
    const { costTracker } = await import('../cost/CostTracker.js');
    const { forgetAlwaysOnQuotaForTenant } =
      await import('../tasks/alwayson/AlwaysOnQuota.js');
    const { analyticsService } =
      await import('../analytics/AnalyticsService.js');
    const { forgetTraceStatsForTenant } =
      await import('../trace-recording/index.js');
    let dropped = CredentialStore.forgetScopedForTenant(normalized);
    dropped += await forgetScopedStoragesForTenant(normalized);
    dropped += costTracker.forgetBucketsForTenant(normalized);
    dropped += forgetAlwaysOnQuotaForTenant(normalized);
    dropped += analyticsService.forgetForTenant(normalized);
    dropped += forgetTraceStatsForTenant(normalized);
    report.removed.scopedCaches = dropped;
  });

  // ── 3. 清共享单库里的归属行（配置/凭据、定时任务、任务流）──
  await runStep(report, 'channelConfigs', async () => {
    const { ChannelRegistry } =
      await import('../channels/registry/ChannelRegistry.js');
    const registry = new ChannelRegistry(resolveDbPath());
    try {
      await registry.initPersistence();
      report.removed.channelConfigs =
        await registry.purgeOwnerPrefix(ownerPrefix);
    } finally {
      await registry.close();
    }
  });

  await runStep(report, 'cronJobs', async () => {
    const { CronJobStore } = await import('../tasks/cron/CronJobStore.js');
    const store = new CronJobStore(resolveDbPath());
    try {
      await store.init();
      report.removed.cronJobs = await store.deleteByOwnerPrefix(ownerPrefix);
    } finally {
      await store.close();
    }
  });

  await runStep(report, 'taskStore', async () => {
    const { SqliteTaskStore } = await import('../tasks/db/SqliteTaskStore.js');
    const store = new SqliteTaskStore(resolveDbPath());
    try {
      await store.init();
      report.removed.taskFlows =
        await store.deleteTaskFlowsByOwnerPrefix(ownerPrefix);
      report.removed.usageRecords =
        await store.deleteUsageRecordsByOwnerPrefix(ownerPrefix);
    } finally {
      await store.close();
    }
  });

  // 用量/技能使用统计：写入侧已带 owner（P5），删除时按同一前缀清
  await runStep(report, 'modelUsageLogs', async () => {
    const { UsageStatsService } =
      await import('../ai/models/UsageStatsService.js');
    // 用**一次性实例**（不碰进程单例）：单例可能已按别的路径建好
    const usage = await UsageStatsService.openAt(resolveDbPath());
    try {
      report.removed.modelUsageLogs =
        await usage.deleteByOwnerPrefix(ownerPrefix);
    } finally {
      await usage.close();
    }
  });

  await runStep(report, 'skillUsageRecords', async () => {
    const { SkillDB } = await import('../skills/persistence/SkillDB.js');
    const db = new SkillDB();
    try {
      report.removed.skillUsageRecords =
        await db.deleteUsageByOwnerPrefix(ownerPrefix);
    } finally {
      await db.close();
    }
  });

  // ── 4. 项目目录（全局 `data/projects/`，按 project.json 的 ownerKey 判定）──
  report.removed.projects = purgeOwnedProjects(ownerPrefix, report.blocked);

  // ── 5. 最后删分区目录（会话 / 事件 / 租户库 / 预算状态 / 审计 / 凭据 / 工作区）──
  const tenantRoot = join(
    resolveDataDir(),
    'tenants',
    safePathSegment(normalized)
  );
  if (existsSync(tenantRoot)) {
    try {
      rmSync(tenantRoot, { recursive: true, force: true });
      report.removed.tenantDataDir = true;
    } catch (error) {
      // Windows 上仍可能被其他句柄占用 ⇒ 记入 blocked，重启后重跑
      report.blocked.push({ path: tenantRoot, error: String(error) });
      logger.warning('租户分区目录删除失败（重启后重跑 purgeTenant 即可）', {
        tenantId: normalized,
        tenantRoot,
        error: String(error),
      });
    }
  }

  logger.info('租户数据清除完成', {
    tenantId: normalized,
    removed: report.removed,
    blocked: report.blocked.length,
  });
  return report;
}

/** 单步失败不阻断后续步骤（清理是"尽量多做"，失败逐项登记） */
async function runStep(
  report: TenantPurgeReport,
  step: string,
  fn: () => Promise<void>
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    report.blocked.push({ path: `step:${step}`, error: String(error) });
    await handleError(error, {
      module: 'runtime:tenantPurge',
      action: `租户清除步骤失败: ${step}`,
      context: { tenantId: report.tenantId },
    });
  }
}

/**
 * 删除归属该前缀的项目目录
 *
 * 项目存于**全局** `data/projects/<id>/project.json`（按 `ownerKey` 过滤访问，
 * 但不随身份分区）⇒ 只能逐个读元数据判定归属。
 *
 * @returns 删除的项目目录数
 */
function purgeOwnedProjects(
  ownerPrefix: string,
  blocked: Array<{ path: string; error: string }>
): number {
  const projectsRoot = join(resolveDataDir(), 'projects');
  if (!existsSync(projectsRoot)) return 0;

  let removed = 0;
  for (const entry of readdirSync(projectsRoot)) {
    const projectDir = join(projectsRoot, entry);
    const metaPath = join(projectDir, 'project.json');
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as {
        ownerKey?: string;
      };
      if (!meta.ownerKey?.startsWith(ownerPrefix)) continue;
      rmSync(projectDir, { recursive: true, force: true });
      removed++;
    } catch (error) {
      blocked.push({ path: projectDir, error: String(error) });
    }
  }
  return removed;
}
