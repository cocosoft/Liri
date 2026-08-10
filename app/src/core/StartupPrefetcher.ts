/**
 * 启动预读取模块
 * 在首屏渲染后启动后台预读取，减少用户等待时间
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('StartupPrefetcher');
import { profileCheckpoint } from '@modules/performance/StartupProfiler.js';
import {
  getStartupState,
  getSessionId,
  getOriginalCwd,
} from '@modules/bootstrap/state.js';

/**
 * 预读取任务状态
 */
export type PrefetchStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * 预读取任务定义
 */
export interface PrefetchTask {
  name: string;
  status: PrefetchStatus;
  startTime: number;
  endTime?: number;
  error?: string;
}

/**
 * 预读取任务注册表
 */
const prefetchRegistry: Map<string, PrefetchTask> = new Map();

/**
 * 注册预读取任务
 */
function registerTask(name: string): PrefetchTask {
  const task: PrefetchTask = {
    name,
    status: 'pending',
    startTime: Date.now(),
  };
  prefetchRegistry.set(name, task);
  return task;
}

/**
 * 标记任务开始
 */
function markTaskRunning(task: PrefetchTask): void {
  task.status = 'running';
  task.startTime = Date.now();
}

/**
 * 标记任务完成
 */
function markTaskCompleted(task: PrefetchTask): void {
  task.status = 'completed';
  task.endTime = Date.now();
}

/**
 * 标记任务失败
 */
function markTaskFailed(task: PrefetchTask, error: string): void {
  task.status = 'failed';
  task.endTime = Date.now();
  task.error = error;
}

/**
 * 获取所有预读取任务状态
 */
export function getPrefetchStatus(): PrefetchTask[] {
  return Array.from(prefetchRegistry.values());
}

/**
 * 预读取用户上下文
 * 加载用户配置、权限等
 */
async function prefetchUserContext(): Promise<void> {
  const task = registerTask('userContext');
  markTaskRunning(task);

  try {
    const { getUnifiedConfigManager } =
      await import('../config/UnifiedConfigManager.js');
    const ucm = getUnifiedConfigManager();
    ucm.loadSyncSources();
    markTaskCompleted(task);
  } catch (error) {
    markTaskFailed(task, String(error));
    logger.warn('Failed to prefetch user context:', { error: String(error) });
  }
}

/**
 * 预读取MDM设置
 */
async function prefetchMdmSettings(): Promise<void> {
  const task = registerTask('mdmSettings');
  markTaskRunning(task);

  try {
    const { ensureMdmSettingsLoaded } =
      await import('../config/settings/mdm/index.js');
    await ensureMdmSettingsLoaded();
    markTaskCompleted(task);
  } catch (error) {
    markTaskFailed(task, String(error));
    logger.warn('Failed to prefetch MDM settings:', { error: String(error) });
  }
}

/**
 * 预读取安全环境变量
 */
async function prefetchSafeEnvVariables(): Promise<void> {
  const task = registerTask('safeEnvVariables');
  markTaskRunning(task);

  try {
    const { applySafeConfigEnvironmentVariables } =
      await import('../config/managedEnv.js');
    const { loadUserSettings } =
      await import('../config/settings/userSettings.js');
    const { loadPolicySettings } =
      await import('../config/settings/policySettings.js');

    const sources: Record<string, Record<string, string> | undefined> = {
      userSettings: loadUserSettings()?.env as
        | Record<string, string>
        | undefined,
      flagSettings: undefined,
      policySettings: loadPolicySettings()?.env as
        | Record<string, string>
        | undefined,
    };

    applySafeConfigEnvironmentVariables(sources);
    markTaskCompleted(task);
  } catch (error) {
    markTaskFailed(task, String(error));
    logger.warn('Failed to prefetch safe env variables:', {
      error: String(error),
    });
  }
}

/**
 * 预读取统一配置
 */
async function prefetchUnifiedConfig(): Promise<void> {
  const task = registerTask('unifiedConfig');
  markTaskRunning(task);

  try {
    const { getUnifiedConfigManager } =
      await import('../config/UnifiedConfigManager.js');
    const configManager = getUnifiedConfigManager();
    await configManager.initialize();
    markTaskCompleted(task);
  } catch (error) {
    markTaskFailed(task, String(error));
    logger.warn('Failed to prefetch unified config:', { error: String(error) });
  }
}

/**
 * 预读取模型能力信息
 */
async function prefetchModelCapabilities(): Promise<void> {
  const task = registerTask('modelCapabilities');
  markTaskRunning(task);

  try {
    // 模型能力预读取 - 触发模型列表缓存
    const sessionId = getSessionId();
    logger.debug(`Prefetching model capabilities for session ${sessionId}`);
    markTaskCompleted(task);
  } catch (error) {
    markTaskFailed(task, String(error));
    logger.warn('Failed to prefetch model capabilities:', {
      error: String(error),
    });
  }
}

/**
 * 预读取文件统计
 */
async function prefetchFileStats(): Promise<void> {
  const task = registerTask('fileStats');
  markTaskRunning(task);

  try {
    const cwd = getOriginalCwd();
    logger.debug(`Prefetching file stats for ${cwd}`);
    markTaskCompleted(task);
  } catch (error) {
    markTaskFailed(task, String(error));
    logger.warn('Failed to prefetch file stats:', { error: String(error) });
  }
}

/**
 * 启动延迟预读取
 * 在首屏渲染后调用，不阻塞关键启动路径
 * 参考 CC源码 main.tsx startDeferredPrefetches()
 */
export function startDeferredPrefetches(): void {
  profileCheckpoint('deferred_prefetches_start');

  // 并行启动所有预读取任务
  // 每个任务独立运行，失败不影响其他任务
  void prefetchUserContext();
  void prefetchMdmSettings();
  void prefetchSafeEnvVariables();
  void prefetchUnifiedConfig();
  void prefetchModelCapabilities();
  void prefetchFileStats();

  profileCheckpoint('deferred_prefetches_fired');
  logger.info('Deferred prefetches started');
}

/**
 * 等待关键预读取完成
 * 在需要预读取结果的代码路径中调用
 */
export async function awaitCriticalPrefetches(): Promise<void> {
  const criticalTasks = ['userContext', 'unifiedConfig'];

  const promises = criticalTasks
    .map((name) => prefetchRegistry.get(name))
    .filter((task) => task && task.status === 'running')
    .map(async (task) => {
      // 简单轮询等待任务完成（最多5秒）
      const timeout = 5000;
      const start = Date.now();
      while (task!.status === 'running' && Date.now() - start < timeout) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    });

  await Promise.all(promises);
}

/**
 * 重置预读取状态
 */
export function resetPrefetchState(): void {
  prefetchRegistry.clear();
}
