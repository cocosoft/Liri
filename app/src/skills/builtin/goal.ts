/**
 * Goal-based Loop 技能 — /goal 命令
 *
 * 让 Liri 支持"设目标 → 自迭代 → 达标才交付"的 Goal-based Loop 模式。
 * 内部复用 LongRunningTaskOrchestrator.runFullPdca() 四阶段闭环。
 *
 * 用法：
 *   /goal <目标描述> [stop after N tries] [maxTokens=X] [maxCost=Y] [--approve-plan]
 *   /goal --plan-only <目标描述>
 *   /goal --trace <目标描述>
 *   /goal feedback "人类反馈文本"
 *   /goal approve <taskId>
 *   /goal reject <taskId>
 *   /goal cancel
 *   /goal continue
 *   /goal status
 */

import { Skill, SkillSource, SkillLoadMethod } from '../types/index.js';
import { Logger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import {
  getOrCreateOrchestrator,
  getOrchestrator,
} from '../../tasks/LongRunningTaskOrchestrator.js';
import { unattendedMode } from '@modules/runtime/UnattendedModeManager.js';

const logger = new Logger({ module: 'skills:goal' });

/** VerifierAgent 首次启用提示（整个进程生命周期只显示一次） */
let verifierFirstRunShown = false;

/** 活跃的 Goal 任务（session 级互斥） */
const activeGoals = new Map<
  string,
  { id: string; description: string; startTime: number; feedback?: string }
>();

/** 解析 /goal 命令参数 */
function parseGoalArgs(raw: string): {
  description: string;
  maxTurns: number;
  maxTokens?: number;
  maxCost?: number;
  planOnly: boolean;
  trace: boolean;
  feedback?: string;
  requirePlanApproval: boolean;
} {
  let description = raw;
  let maxTurns = 5;
  let maxTokens: number | undefined;
  let maxCost: number | undefined;
  let planOnly = false;
  let trace = false;
  let feedback: string | undefined;
  let requirePlanApproval = false;

  // --plan-only flag
  if (description.includes('--plan-only')) {
    planOnly = true;
    description = description.replace('--plan-only', '').trim();
  }

  // --approve-plan flag
  if (description.includes('--approve-plan')) {
    requirePlanApproval = true;
    description = description.replace('--approve-plan', '').trim();
  }

  // --trace / @debug flag
  if (description.includes('--trace') || description.includes('@debug')) {
    trace = true;
    description = description.replace(/--trace|@debug/g, '').trim();
  }

  // feedback "..." subcommand
  const feedbackMatch = description.match(/^feedback\s+"(.+)"$/);
  if (feedbackMatch) {
    feedback = feedbackMatch[1];
    description = description.replace(feedbackMatch[0], '').trim();
  }

  // stop after N tries
  const stopMatch = description.match(/stop\s+after\s+(\d+)\s*(tries)?/i);
  if (stopMatch) {
    maxTurns = parseInt(stopMatch[1], 10);
    description = description.replace(stopMatch[0], '').trim();
  }

  // maxTokens=X
  const tokensMatch = description.match(/maxTokens[=\s]+(\d+)/i);
  if (tokensMatch) {
    maxTokens = parseInt(tokensMatch[1], 10);
    description = description.replace(tokensMatch[0], '').trim();
  }

  // maxCost=Y
  const costMatch = description.match(/maxCost[=\s]+([\d.]+)/i);
  if (costMatch) {
    maxCost = parseFloat(costMatch[1]);
    description = description.replace(costMatch[0], '').trim();
  }

  return {
    description,
    maxTurns,
    maxTokens,
    maxCost,
    planOnly,
    trace,
    feedback,
    requirePlanApproval,
  };
}

/** 检查 session 级并发互斥 */
function checkConcurrency(sessionId: string): string | null {
  const existing = activeGoals.get(sessionId);
  if (existing) {
    return `当前已有目标 "${existing.description}" 在执行中。用 /goal cancel 终止后再发起新目标。`;
  }
  return null;
}

const goalSkill: Skill = {
  name: 'goal',
  description:
    '设置目标并让 Liri 自动迭代直到达标。用法：/goal <描述> [stop after N tries] [--plan-only]',
  source: SkillSource.BUILTIN,
  loadMethod: SkillLoadMethod.FILE_SYSTEM,
  loadedFrom: 'builtin',
  version: '1.0.0',
  impl: {
    kind: 'executable',
    execute: async (args: unknown[]) => {
      const raw = args.join(' ');
      const sessionId = `goal_${Date.now().toString(36)}`;

      const otel = getOTelTracing();
      const span = otel.startSpan('goal.execute', {
        'goal.sessionId': sessionId,
        'goal.raw': raw.substring(0, 200),
      });

      try {
        // 处理子命令
        if (!raw || raw === 'status') {
          const goals = Array.from(activeGoals.values());
          otel.endSpan(span, SpanStatusCode.OK);
          if (goals.length === 0) return '当前没有运行中的目标。';
          return goals
            .map(
              (g) =>
                `[${g.id}] ${g.description} — 运行中（${Math.round((Date.now() - g.startTime) / 1000)}s）${g.feedback ? ` | 反馈: "${g.feedback}"` : ''}`
            )
            .join('\n');
        }

        if (raw === 'cancel') {
          const existing = activeGoals.get(sessionId);
          if (!existing) {
            otel.endSpan(span, SpanStatusCode.OK);
            return '当前没有运行中的目标。';
          }
          activeGoals.delete(sessionId);
          logger.info('Goal cancelled', { goalId: existing.id });
          otel.endSpan(span, SpanStatusCode.OK);
          return `已中止目标 "${existing.description}"。`;
        }

        // /goal approve <taskId>
        if (raw.startsWith('approve ')) {
          const taskId = raw.substring(8).trim();
          if (!taskId) {
            otel.endSpan(span, SpanStatusCode.OK);
            return '用法：/goal approve <taskId>';
          }
          const orch = getOrchestrator(taskId);
          if (!orch) {
            otel.endSpan(span, SpanStatusCode.OK);
            return `未找到任务 ${taskId}。`;
          }
          try {
            const status = await orch.resumeAfterApproval(sessionId);
            const summary = `✅ 计划已批准，PDCA 执行完成 | ${status.plan?.steps.length ?? 0} 步 | 阶段: ${status.phase}`;
            span.setAttribute('goal.status', status.phase);
            otel.endSpan(span, SpanStatusCode.OK);
            return summary;
          } catch (e) {
            await handleError(e, {
              module: 'skills:goal',
              action: 'approve',
              context: { taskId },
            });
            otel.recordError(
              span,
              e instanceof Error ? e : new Error(String(e))
            );
            otel.endSpan(span, SpanStatusCode.ERROR, String(e));
            return `❌ 审批执行失败：${e instanceof Error ? e.message : String(e)}`;
          }
        }

        // /goal reject <taskId>
        if (raw.startsWith('reject ')) {
          const taskId = raw.substring(7).trim();
          if (!taskId) {
            otel.endSpan(span, SpanStatusCode.OK);
            return '用法：/goal reject <taskId>';
          }
          const orch = getOrchestrator(taskId);
          if (!orch) {
            otel.endSpan(span, SpanStatusCode.OK);
            return `未找到任务 ${taskId}。`;
          }
          orch['dispose']?.();
          activeGoals.delete(sessionId);
          logger.info('Goal rejected', { taskId });
          otel.endSpan(span, SpanStatusCode.OK);
          return `已拒绝计划 ${taskId}，任务已清理。`;
        }

        const {
          description,
          maxTurns,
          maxTokens,
          maxCost,
          planOnly,
          trace,
          feedback,
          requirePlanApproval,
        } = parseGoalArgs(raw);

        // feedback 子命令：注入反馈到当前活跃目标
        if (feedback) {
          const existing = activeGoals.get(sessionId);
          if (!existing) {
            otel.endSpan(span, SpanStatusCode.OK);
            return '当前没有运行中的目标。请先用 /goal <描述> 发起一个目标。';
          }
          existing.feedback = feedback;
          logger.info('Feedback injected', { goalId: existing.id, feedback });
          otel.endSpan(span, SpanStatusCode.OK);
          return `已向目标 "${existing.description}" 注入反馈："${feedback}"。将在下一轮 PLAN 阶段生效。`;
        }

        if (!description) {
          otel.endSpan(span, SpanStatusCode.ERROR, 'no_description');
          return '请提供目标描述。用法：/goal <目标描述> [stop after N tries] [--plan-only] [--trace]';
        }

        // plan-only 模式
        if (planOnly) {
          const orchestrator = getOrCreateOrchestrator(sessionId);
          const plan = await orchestrator.executePlanPhase(
            description,
            sessionId
          );
          otel.endSpan(span, SpanStatusCode.OK);
          return `📋 计划（未执行）:\n${plan.steps
            .map((s, i) => `  ${i + 1}. ${s.description}`)
            .join(
              '\n'
            )}\n\n共 ${plan.steps.length} 步。确认后用 /goal execute ${plan.id} 执行。`;
        }

        // VerifierAgent 首次启用提示
        let verifierNotice = '';
        if (!verifierFirstRunShown) {
          verifierFirstRunShown = true;
          verifierNotice =
            '🔍 VerifierAgent 已启用（我每轮执行完后会自检一次，确保质量达标再交付）\n' +
            '可通过 config set verifier.enabled=false 关闭此功能\n\n';
        }

        // 并发检查
        const concurrencyError = checkConcurrency(sessionId);
        if (concurrencyError) {
          otel.endSpan(span, SpanStatusCode.ERROR, 'concurrency');
          return concurrencyError;
        }

        // 注册活跃目标
        const goalId = `goal_${Date.now().toString(36)}`;
        activeGoals.set(sessionId, {
          id: goalId,
          description,
          startTime: Date.now(),
        });

        logger.info('Goal started', { goalId, description, maxTurns, trace });

        try {
          const orchestrator = getOrCreateOrchestrator(sessionId);

          // --trace 模式：记录开始时间用于每阶段计时
          const traceStart = trace ? Date.now() : 0;

          // 启动 PDCA 全流程（支持计划前置审批）
          const result = await orchestrator.runFullPdca(
            description,
            sessionId,
            {
              requirePlanApproval,
            }
          );

          // 清理（审批挂起时不清理）
          if (result.phase !== 'plan_pending') {
            activeGoals.delete(sessionId);
          }

          // plan_pending: 计划已生成，等待审批
          if (result.phase === 'plan_pending') {
            // 无人值守模式：自动批准并继续执行
            if (unattendedMode.isUnattended()) {
              logger.info('Unattended mode: auto-approving plan', {
                sessionId,
              });
              const executed =
                await orchestrator.resumeAfterApproval(sessionId);
              activeGoals.delete(sessionId);
              const autoSummary = `🤖 [无人值守] 计划自动批准并执行完成 | ${executed.plan?.steps.length ?? 0} 步 | 阶段: ${executed.phase}`;
              span.setAttribute('goal.status', executed.phase);
              otel.endSpan(span, SpanStatusCode.OK);
              return `${verifierNotice}${autoSummary}`;
            }

            span.setAttribute('goal.status', 'plan_pending');
            otel.endSpan(span, SpanStatusCode.OK);
            return `${verifierNotice}📋 计划已生成，等待审批\n\n步骤:\n${result.plan?.steps.map((s, i) => `  ${i + 1}. ${s.description}`).join('\n')}\n\n共 ${result.plan?.steps.length ?? 0} 步。\n\n用 /goal approve ${sessionId} 批准执行，或 /goal reject ${sessionId} 拒绝。`;
          }

          // TRACE 日志组装
          let traceSection = '';
          if (trace) {
            const elapsed = Date.now() - traceStart;
            const phases: string[] = result.phase
              ? [`最终阶段: ${result.phase}`]
              : [];
            if (result.plan) {
              phases.push(
                `步骤数: ${result.plan.steps.length}`,
                `通过: ${result.plan.steps.filter((s) => s.status === 'completed').length}`,
                `失败: ${result.plan.steps.filter((s) => s.status === 'failed').length}`
              );
            }
            traceSection =
              '\n\n📊 TRACE:\n' +
              `  耗时: ${(elapsed / 1000).toFixed(1)}s\n` +
              phases.map((p) => `  ${p}`).join('\n');
          }

          const summary = `${verifierNotice}✅ 目标${result.phase === 'completed' ? '完成' : '结束'} | ${result.plan?.steps.length ?? 0} 步 | PDCA 阶段: ${result.phase}${traceSection}`;

          span.setAttribute('goal.status', result.phase);
          span.setAttribute('goal.trace', trace);
          otel.endSpan(span, SpanStatusCode.OK);
          logger.info('Goal completed', {
            goalId,
            status: result.phase,
            trace,
          });
          return summary;
        } catch (e) {
          activeGoals.delete(sessionId);
          throw e;
        }
      } catch (e) {
        await handleError(e, {
          module: 'skills:goal',
          action: 'execute',
          context: { sessionId, raw: raw.substring(0, 200) },
        });
        otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
        otel.endSpan(span, SpanStatusCode.ERROR, String(e));
        return `❌ /goal 执行失败：${e instanceof Error ? e.message : String(e)}`;
      }
    },
  },
};

export default goalSkill;
