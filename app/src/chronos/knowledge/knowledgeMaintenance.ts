/**
 * 知识库定时维护任务
 * 通过 Chronos 调度系统定期执行：
 * 1. 编译 raw/ 目录的原始文件为结构化 wiki 文档
 * 2. 更新知识库摘要缓存
 * 3. 执行健康检查（可选，默认仅在检查模式下执行）
 */
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { resolvePyappHome } from '@modules/config/paths';

const logger = new Logger({ level: LogLevel.INFO });

/** 默认知识库维护 cron 表达式：每日凌晨 4 点 */
export const DEFAULT_MAINTENANCE_CRON = '0 4 * * *';

/** 知识库维护任务 ID */
export const KNOWLEDGE_MAINTENANCE_TASK_ID = 'knowledge-maintenance';

/** 系统知识维护任务的 prompt 标记 */
const SYSTEM_MAINTENANCE_PROMPT = '__SYSTEM_KNOWLEDGE_MAINTENANCE__';

/** 知识库维护执行结果 */
export interface KnowledgeMaintenanceResult {
  success: boolean;
  compiled: number;
  skipped: number;
  errors: string[];
  lintIssues: number;
  digestUpdated: boolean;
  durationMs: number;
}

/**
 * 执行知识库维护
 * 1. 编译 raw/ 目录的原始文件
 * 2. 更新摘要缓存
 * 3. 执行健康检查（记录问题但不阻止流程）
 */
export async function runKnowledgeMaintenance(): Promise<KnowledgeMaintenanceResult> {
  const startTime = Date.now();

  const result: KnowledgeMaintenanceResult = {
    success: false,
    compiled: 0,
    skipped: 0,
    errors: [],
    lintIssues: 0,
    digestUpdated: false,
    durationMs: 0,
  };

  try {
    const { existsSync } = await import('fs');
    const { join } = await import('path');
    const { readdir } = await import('fs/promises');

    const rawDir = join(resolvePyappHome(), 'knowledge', 'raw');

    if (!existsSync(rawDir)) {
      result.durationMs = Date.now() - startTime;
      result.success = true;
      return result;
    }

    const rawFiles = await readdir(rawDir);
    const compileCandidates = rawFiles.filter(
      (f) => f.endsWith('.txt') || f.endsWith('.md') || f.endsWith('.json')
    );

    if (compileCandidates.length === 0) {
      result.durationMs = Date.now() - startTime;
      result.success = true;
      return result;
    }

    logger.info('知识库维护开始', {
      compileCandidates: compileCandidates.length,
    });

    const { aiService } = await import('@modules/ai/services/aiService');
    const { runKnowledgeCompile } =
      await import('../../knowledge/KnowledgeCompiler');
    const { runKnowledgeLint } =
      await import('../../knowledge/KnowledgeLinter');
    const { getDefaultDigestService } =
      await import('../../knowledge/KnowledgeDigestService');

    // Step 1: 编译 raw/ 文件
    const compileResult = await runKnowledgeCompile(aiService, {
      force: false,
    });
    result.compiled = compileResult.compiled;
    result.skipped = compileResult.skipped;
    result.errors = compileResult.errors;

    // Step 2: 更新摘要缓存
    try {
      const digestService = getDefaultDigestService();
      await digestService.buildDigest();
      result.digestUpdated = true;
    } catch {
      logger.warning('摘要缓存更新失败，跳过');
    }

    // Step 3: 健康检查（非阻塞）
    try {
      const lintResult = await runKnowledgeLint();
      result.lintIssues = lintResult.issues.length;
      if (lintResult.issues.length > 0) {
        logger.info('知识库健康检查发现问题', {
          issueCount: lintResult.issues.length,
          issues: lintResult.issues.slice(0, 5).map((i) => i.message),
        });
      }
    } catch {
      // 健康检查失败不阻止主流程
    }

    result.success = true;
    result.durationMs = Date.now() - startTime;

    logger.info('知识库维护完成', {
      compiled: result.compiled,
      skipped: result.skipped,
      errors: result.errors.length,
      lintIssues: result.lintIssues,
      digestUpdated: result.digestUpdated,
      durationMs: result.durationMs,
    });
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    result.durationMs = Date.now() - startTime;
    logger.error('知识库维护失败', { error: result.errors[0] });
  }

  return result;
}

/**
 * 注册知识库定时维护任务
 * 使用 CronTasks 系统进行持久化调度
 */
export async function registerKnowledgeMaintenanceTask(
  cron?: string
): Promise<string> {
  const expression = cron ?? DEFAULT_MAINTENANCE_CRON;

  const { addCronTask, updateCronTask } = await import('../CronTasks');

  const taskId = await addCronTask(
    expression,
    SYSTEM_MAINTENANCE_PROMPT,
    true,
    true,
    undefined
  );

  await updateCronTask(taskId, {
    taskType: '_system',
    metadata: { type: 'knowledge_maintenance', cron: expression },
  });

  logger.info('知识库定时维护任务已注册', {
    taskId,
    cron: expression,
    schedule: '每日凌晨 4 点（默认）',
  });

  return taskId;
}

/**
 * 注销知识库定时维护任务
 */
export async function unregisterKnowledgeMaintenanceTask(
  taskId?: string
): Promise<void> {
  const id = taskId || KNOWLEDGE_MAINTENANCE_TASK_ID;
  const { removeCronTasks } = await import('../CronTasks');
  await removeCronTasks([id]);
  logger.info('知识库定时维护任务已注销', { taskId: id });
}
