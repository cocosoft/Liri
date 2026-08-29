import type { CommandContext, CommandResult } from '@modules/commands';
import {
  readPdcaCheckpoint,
  listPdcaCheckpoints,
  PDCA_TERMINAL_PHASES,
} from '@modules/tasks';
import { getOrCreateOrchestrator, getOrchestrator } from '@modules/tasks';
import { handleError } from '@modules/error';

function phaseLabel(phase: unknown): string {
  return typeof phase === 'string' && phase ? phase : 'unknown';
}

function stepCountLabel(ck: Record<string, unknown>): string {
  const steps = ck.steps as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(steps)) return '0 步';
  const done = steps.filter((s) => s.status === 'completed').length;
  return `${done}/${steps.length} 步完成`;
}

export default {
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0] || 'list';

    switch (subcommand.toLowerCase()) {
      case 'list':
        return this.handleList();
      case 'resume':
        return this.handleResume(parts.slice(1), context);
      case 'approve':
        return this.handleApprove(parts.slice(1), context);
      case 'reject':
        return this.handleReject(parts.slice(1), context);
      default:
        return this.handleHelp();
    }
  },

  /** /goal list — 列出进行中的 PDCA 任务（跨重启恢复入口） */
  async handleList(): Promise<CommandResult> {
    const all = listPdcaCheckpoints();
    const active = all.filter(
      (ck) => !PDCA_TERMINAL_PHASES.has(ck.phase as string)
    );

    if (active.length === 0) {
      return {
        success: true,
        type: 'text',
        message:
          '当前没有进行中的任务。使用 /goal resume <taskId> 恢复历史任务。',
        data: { tasks: [], total: 0 },
      };
    }

    const lines = active.map((ck, i) => {
      const idx = (i + 1).toString().padEnd(3);
      const phase = phaseLabel(ck.phase).padEnd(14);
      return `${idx}${phase}${stepCountLabel(ck)}  ${ck.taskId ?? ''}`;
    });

    return {
      success: true,
      type: 'text',
      message: `进行中的 PDCA 任务:\n\n${lines.join('\n')}\n\n用法: /goal resume <taskId> 或 /goal resume <编号>`,
      data: { tasks: active.map((ck) => ck.taskId), total: active.length },
    };
  },

  /** /goal resume <taskId|编号> — 从 checkpoint 恢复执行（断点续跑） */
  async handleResume(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    const rawId = args[0];
    if (!rawId) {
      return {
        success: false,
        type: 'error',
        error: '请提供任务ID或编号',
        message: '用法: /goal resume <taskId|编号>',
      };
    }

    const all = listPdcaCheckpoints();
    const active = all.filter(
      (ck) => !PDCA_TERMINAL_PHASES.has(ck.phase as string)
    );
    const idx = parseInt(rawId, 10);
    let target: Record<string, unknown> | undefined;

    if (!Number.isNaN(idx) && idx >= 1 && idx <= active.length) {
      target = active[idx - 1];
    } else {
      target = all.find((ck) => ck.taskId === rawId);
    }

    if (!target) {
      return {
        success: false,
        type: 'error',
        error: `未找到任务: ${rawId}`,
        message: `未找到任务 "${rawId}"。使用 /goal list 查看有效任务。`,
      };
    }

    const taskId = String(target.taskId);
    try {
      const ck = readPdcaCheckpoint(taskId);
      if (!ck) {
        return {
          success: false,
          type: 'error',
          error: `checkpoint 不存在: ${taskId}`,
          message: `任务 ${taskId} 的 checkpoint 不存在。`,
        };
      }
      const orchestrator = getOrCreateOrchestrator(taskId);
      const status = await orchestrator.resumeFromCheckpoint(ck);
      context.onDone?.(`任务 ${taskId} 已恢复（phase: ${status.phase}）`, {
        display: 'system',
      });
      return {
        success: true,
        type: 'text',
        message:
          `任务 ${taskId} 已从 checkpoint 恢复（phase: ${status.phase}）。\n` +
          `进度: ${status.progress?.completed ?? 0}/${status.progress?.total ?? 0} 步完成`,
        data: { taskId, phase: status.phase, progress: status.progress },
      };
    } catch (err) {
      await handleError(err, {
        module: 'commands:goal',
        action: 'resume',
        context: { taskId },
      });
      return {
        success: false,
        type: 'error',
        error: String(err),
        message: `任务 ${taskId} 恢复失败: ${String(err)}`,
      };
    }
  },

  /** /goal approve [stage] <taskId> — 批准待审批的计划/阶段（D1/M7 扩展 type 分发） */
  async handleApprove(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    // D1/M7：target = { type: 'plan'|'stage', taskId }；默认 type='plan'（向后兼容）
    const type = args[0] === 'stage' ? 'stage' : 'plan';
    const taskId = type === 'stage' ? args[1] : args[0];
    if (!taskId) {
      return {
        success: false,
        type: 'error',
        error: '请提供任务ID',
        message: '用法: /goal approve <taskId> 或 /goal approve stage <taskId>',
      };
    }

    // 阶段审批：分发到 StageOrchestrator（需求阶段 PRD 审批门）
    if (type === 'stage') {
      try {
        const { StageOrchestrator, createDefaultStageRunner } =
          await import('@modules/tasks/StageOrchestrator.js');
        const stageOrch = StageOrchestrator.fromCheckpoint(taskId, {
          // 默认阶段执行器：child 走默认 executor（纯 LLM）继续阶段链
          runStage: createDefaultStageRunner(),
        });
        if (!stageOrch) {
          return {
            success: false,
            type: 'error',
            error: `任务 ${taskId} 不是阶段链任务`,
            message: `任务 ${taskId} 不是阶段链任务（无 stages[] checkpoint）。`,
          };
        }
        const status = await stageOrch.resumeAfterApproval();
        context.onDone?.(`任务 ${taskId} 阶段已批准并继续执行`, {
          display: 'system',
        });
        return {
          success: true,
          type: 'text',
          message: `任务 ${taskId} 阶段已批准，继续阶段链（phase: ${status.phase}）。`,
          data: { taskId, type: 'stage', phase: status.phase },
        };
      } catch (err) {
        return {
          success: false,
          type: 'error',
          error: String(err),
          message: `阶段批准失败: ${String(err)}`,
        };
      }
    }

    const orchestrator = getOrchestrator(taskId);
    if (!orchestrator) {
      return {
        success: false,
        type: 'error',
        error: `任务不在运行中: ${taskId}`,
        message: `任务 ${taskId} 不在运行中。使用 /goal resume <taskId> 从 checkpoint 恢复。`,
      };
    }
    try {
      const ck = readPdcaCheckpoint(taskId);
      const sessionId = (ck?.sessionId as string | undefined) ?? '';
      const status = await orchestrator.resumeAfterApproval(sessionId);
      context.onDone?.(`任务 ${taskId} 已批准并继续执行`, {
        display: 'system',
      });
      return {
        success: true,
        type: 'text',
        message: `任务 ${taskId} 已批准，继续执行（phase: ${status.phase}）。`,
        data: { taskId, phase: status.phase },
      };
    } catch (err) {
      return {
        success: false,
        type: 'error',
        error: String(err),
        message: `批准失败: ${String(err)}`,
      };
    }
  },

  /** /goal reject <taskId> — 拒绝并中止任务 */
  async handleReject(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    const taskId = args[0];
    if (!taskId) {
      return {
        success: false,
        type: 'error',
        error: '请提供任务ID',
        message: '用法: /goal reject <taskId>',
      };
    }
    const orchestrator = getOrchestrator(taskId);
    if (!orchestrator) {
      return {
        success: false,
        type: 'error',
        error: `任务不在运行中: ${taskId}`,
        message: `任务 ${taskId} 不在运行中。`,
      };
    }
    await orchestrator.abort();
    context.onDone?.(`任务 ${taskId} 已拒绝并中止`, { display: 'system' });
    return {
      success: true,
      type: 'text',
      message: `任务 ${taskId} 已拒绝并中止。`,
      data: { taskId, phase: 'failed' },
    };
  },

  async handleHelp(): Promise<CommandResult> {
    return {
      success: true,
      type: 'text',
      message: [
        'PDCA 任务管理命令用法:',
        '',
        '/goal list            - 列出进行中的任务（跨重启恢复入口）',
        '/goal resume <taskId> - 从 checkpoint 恢复执行（断点续跑）',
        '/goal approve <taskId>- 批准待审批的计划并继续执行',
        '/goal reject <taskId> - 拒绝并中止任务',
        '/goal help            - 显示此帮助信息',
        '',
        '示例:',
        '  /goal list',
        '  /goal resume pdca_m3k2x9',
      ].join('\n'),
    };
  },
};
