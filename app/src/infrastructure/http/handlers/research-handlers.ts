// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * research-handlers.ts — 研究模式显式入口（Teamwork P0-3，2026-09-06）
 *
 * POST /v1/research/start { description, sessionId }
 *   - 显式触发候选生成 + 对抗批评编排（区别于 ChatManager 的研究型意图自动分流）；
 *   - 幂等：同一 sessionId 仅允许一个进行中的研究任务；
 *   - 异步执行（不阻塞 HTTP）：结果以 pdca:stage:complete/phase 事件推送前端 SSE，
 *     并记日志；本 handler 不直接落盘会话消息（结果落盘由后续消息通道负责）。
 *   - callModel：复用全局 AI 服务（与 LRTO 默认 executor 同源，经 @modules/ai createAIService），
 *     不经 ChatManager——端点自包含，无会话上下文依赖。
 */
import type http from 'http';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { sendError, readRequestBody } from './handler-utils';
import type { CompetitiveOrchestrationResult } from '@modules/query';
import { CompetitiveStrategyOrchestrator } from '@modules/query';
import { pitfallRegistry } from '@modules/tasks';
import type { ResearchCallModel } from '@modules/query';

const logger = getLogger('infra:research-handlers');

/** 同 sessionId 进行中研究任务集合（幂等键，进程内；重启后自然失效） */
const activeResearch = new Set<string>();

/**
 * POST /v1/research/start — 启动研究模式编排（异步）
 * 请求体: { description, sessionId }
 * 返回: 202 { taskId, status: 'started' }
 */
export async function handleResearchStart(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = JSON.parse(await readRequestBody(req)) as {
      description?: string;
      sessionId?: string;
    };
    const { description, sessionId } = body;
    if (!description || !sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少 description 或 sessionId' }));
      return;
    }
    if (activeResearch.has(sessionId)) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: '该会话已有进行中的研究任务', existing: true })
      );
      return;
    }

    const taskId = `research_${Date.now().toString(36)}`;
    activeResearch.add(sessionId);
    void runResearchTask({ description, sessionId, taskId })
      .catch(() => {
        /* runResearchTask 内部已兜底 */
      })
      .finally(() => {
        activeResearch.delete(sessionId);
      });

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ taskId, status: 'started' }));
  } catch (err) {
    sendError(res, err, 500);
  }
}

async function runResearchTask(opts: {
  description: string;
  sessionId: string;
  taskId: string;
}): Promise<void> {
  const { description, sessionId, taskId } = opts;
  const { emitPdcaLiveEvent } = await import('../../../tasks/PdcaLiveEvents');
  const emit = (
    event: 'pdca:stage:phase' | 'pdca:stage:complete' | 'pdca:stage:fail',
    data: Record<string, unknown>
  ) =>
    void emitPdcaLiveEvent(
      event,
      { sessionId, taskId },
      // 前端阶段胶囊只认 execute/plan/review/decide；研究编排归入 execute 阶段展示
      // （taskId research_* 前缀 + message 内容可区分研究模式）
      { stage: 'execute', ...data }
    );

  emit('pdca:stage:phase', {
    status: 'running',
    message: '研究模式：生成多视角候选方案并逐一对抗评审',
  });
  try {
    // 全局 AI 服务 callModel（AIService.generate 非流式；与 LRTO 默认 executor 同源）
    const { createAIService, modelRouter } = await import('@modules/ai');
    const { configManager } = await import('@modules/config');
    const service = createAIService({
      defaultModel: '',
      apiKey: configManager.env('ANTHROPIC_API_KEY') || '',
    });
    const makeCallModel = (modelId?: string): ResearchCallModel =>
      async function* (messages, signal) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        // 走查修复（2026-09-06）：非流 generate 对思考模型（deepseek-v4-flash）
        // 存在正文恒空问题（思考烧尽预算/非流解析路径与主链不一致）——改走与主聊天链
        // 同语义的流式 service.stream（reasoning 分流为 thinking 事件，正文正常聚合）
        const gen = service.stream(messages as never, modelId, {
          max_tokens: 4000,
        });
        for await (const chunk of gen) {
          const content = (chunk as unknown as { content?: unknown })?.content;
          if (typeof content === 'string' && content) yield { content };
        }
      };
    const callModel = makeCallModel(undefined);
    // P3 role 路由（2026-09-06）：批评用 verifier 角色模型——modelRouter.resolveRole
    // 读任务分工配置 role 字段；未配置返回 '' → verifierCallModel 不注入 → 编排器回退
    // callModel（现状路由，验收 #6 默认兼容）
    const verifierModelId = modelRouter.resolveRole('verifier');
    const verifierCallModel = verifierModelId
      ? makeCallModel(verifierModelId)
      : undefined;
    // P3 role 路由（2026-09-07，Teamwork 收尾）：候选生成用 generator 角色模型——
    // 语义同 verifier：未配置返回 '' → 不注入 → 编排器回退 callModel（验收 #6 默认兼容）
    const generatorModelId = modelRouter.resolveRole('generator');
    const generatorCallModel = generatorModelId
      ? makeCallModel(generatorModelId)
      : undefined;

    const orchestrator = new CompetitiveStrategyOrchestrator({
      callModel,
      perspectiveCount: 2,
      // P3 role 路由：候选生成角色模型（未配置回退 callModel）
      generatorCallModel,
      // P3 role 路由：verifier 角色模型（未配置回退 callModel）
      verifierCallModel,
      // Teamwork P2b：REJECT 批评 → pitfall 注册表（P1-2 写点）
      recordPitfall: (rec) =>
        pitfallRegistry.record({
          description: rec.description,
          error: rec.error,
          source: 'verifier',
          contextSig: rec.contextSig ?? taskId,
        }),
    });
    const result: CompetitiveOrchestrationResult = await orchestrator.run(
      description,
      new AbortController().signal
    );

    const objectionBlock = result.rejected
      .map((r) => `- 【${r.perspective}】被驳原因：${r.objections.join('；')}`)
      .join('\n');

    if (result.success && result.content.trim()) {
      emit('pdca:stage:complete', {
        status: 'completed',
        message: result.content,
        stats: result.stats,
        rejected: result.rejected.length,
      });
      if (result.rejected.length > 0) {
        emit('pdca:stage:phase', {
          status: 'note',
          message: `对抗评审：${result.approved.length} 份通过 / ${result.rejected.length} 份被驳\n被驳 objection 保留：\n${objectionBlock}`,
        });
      }
    } else if (result.rejected.length > 0) {
      emit('pdca:stage:fail', {
        status: 'failed',
        message: `候选方案均未通过对抗评审。被驳 objection：\n${objectionBlock}`,
      });
    } else {
      emit('pdca:stage:fail', {
        status: 'failed',
        message: '候选生成失败（模型未返回有效候选），未进入对抗评审。',
      });
    }
    logger.info('研究任务完成', {
      taskId,
      sessionId,
      candidateCount: result.stats.candidateCount,
      approvedCount: result.stats.approvedCount,
      rejectedCount: result.stats.rejectedCount,
    });
  } catch (err) {
    await handleError(err, {
      module: 'infra:research-handlers',
      action: 'research_run',
      context: { taskId, sessionId },
    });
    emit('pdca:stage:fail', {
      status: 'failed',
      message: `研究任务执行失败：${String(err).slice(0, 200)}`,
    });
  }
}
