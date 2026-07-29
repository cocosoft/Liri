/**
 * Cron 作业 AI 执行器
 * 将 CronJob 的 prompt 发送给 AI 模型并返回结果
 */

import type { CronJob, CronJobResult } from './types';
import type { AIProvider, ChatOptions } from '@modules/ai';
import type { ChatMessage } from '@modules/ai';
import { Logger, LogLevel } from '@modules/monitoring';
import { resolveModelRoute, RouteKey } from '@modules/ai';

const logger = new Logger({
  module: 'tasks:cronExecutor',
  level: LogLevel.INFO,
});

export interface CronExecutorConfig {
  /** 模型（默认从环境变量读取） */
  model?: string;
  /** 系统提示词（追加在用户 prompt 之前） */
  systemPrompt?: string;
  /** 最大 token 数 */
  maxTokens?: number;
  /** 超时时间 (ms) */
  timeoutMs?: number;
}

const DEFAULT_CONFIG: CronExecutorConfig = {
  systemPrompt:
    '你是一个定时任务执行助手。请根据用户的指令执行任务，给出简洁、可操作的结果。',
  maxTokens: 4096,
  timeoutMs: 120_000,
};

/**
 * 创建一个真正的 AI 执行器
 * @param provider AI provider 实例（来自 providerRegistry）
 * @param config 执行器配置
 */
export function createCronExecutor(
  provider: AIProvider,
  config?: CronExecutorConfig
): (job: CronJob) => Promise<CronJobResult> {
  if (!provider) {
    logger.error('[CronExecutor] 无法创建执行器：provider 为空');
    throw new Error('CronExecutor: provider 不能为 null/undefined');
  }

  const cfg = { ...DEFAULT_CONFIG, ...config };

  return async (job: CronJob): Promise<CronJobResult> => {
    const startTime = Date.now();

    // 动态读取模型配置（通过 ModelRouter 统一路由）
    const model =
      job.model ||
      cfg.model ||
      (await resolveModelRoute(RouteKey.SCHEDULED)) ||
      '';

    const messages: ChatMessage[] = [
      { role: 'system', content: cfg.systemPrompt! },
      { role: 'user', content: job.prompt || `执行定时任务：${job.name}` },
    ];

    logger.info('[CronExecutor] 开始执行作业', {
      jobId: job.id,
      name: job.name,
      model,
      promptLength: job.prompt?.length ?? 0,
    });

    // 创建带超时的执行
    const chatPromise = provider.chat(messages, {
      model,
      max_tokens: cfg.maxTokens!,
      temperature: 0.3, // 定时任务用较低温度提高一致性
    } as ChatOptions);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`作业执行超时 (${cfg.timeoutMs}ms)`)),
        cfg.timeoutMs
      )
    );

    try {
      const response = await Promise.race([chatPromise, timeoutPromise]);

      const durationMs = Date.now() - startTime;
      const content =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

      logger.info('[CronExecutor] 作业执行成功', {
        jobId: job.id,
        durationMs,
        responseLength: content.length,
        usage: response.usage,
      });

      // 提取 usage 信息
      const usage = response.usage as any;
      const inputTokens = usage?.prompt_tokens ?? 0;
      const outputTokens = usage?.completion_tokens ?? 0;

      return {
        success: true,
        output: content,
        finalResponse: content,
        durationMs,
        model,
        provider: provider.id,
        inputTokens,
        outputTokens,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);

      logger.error('[CronExecutor] 作业执行失败', {
        jobId: job.id,
        error: errorMsg,
        durationMs,
      });

      return {
        success: false,
        output: '',
        finalResponse: '',
        error: errorMsg,
        durationMs,
      };
    }
  };
}
