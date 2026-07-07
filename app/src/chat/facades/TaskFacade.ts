// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * TaskFacade — 任务执行门面
 *
 * 封装 ChatManager 的任务编排逻辑（Plan 生命周期管理）。
 * ChatManager 通过此门面委托任务执行，解耦 TaskRegistry/TaskOrchestrator 直接依赖。
 */
import type { ChatSession } from '../types/session';
import type { SendMessageOptions } from '../types/message';
import { taskRegistry } from '@modules/tasks/TaskRegistry';
import { taskOrchestrator } from '@modules/tasks/TaskOrchestrator';

export interface ITaskFacade {
  /**
   * 执行所有计划步骤
   * @param session 当前会话
   * @param executeStep 步骤执行回调
   * @param options 消息选项
   */
  executePlanSteps(
    session: ChatSession,
    executeStep: (
      prompt: string,
      session: ChatSession,
      options?: SendMessageOptions
    ) => Promise<void>,
    options?: SendMessageOptions
  ): Promise<void>;
}

export class TaskFacade implements ITaskFacade {
  async executePlanSteps(
    session: ChatSession,
    executeStep: (
      prompt: string,
      session: ChatSession,
      options?: SendMessageOptions
    ) => Promise<void>,
    options?: SendMessageOptions
  ): Promise<void> {
    const pendingTasks = taskRegistry
      .getAllTaskInfos()
      .filter((t) => t.displayStatus === 'pending');

    if (pendingTasks.length === 0) return;

    const stepDescriptions = pendingTasks.map((t) => t.description);
    const taskIds = pendingTasks.map((t) => t.id);
    const plan = taskOrchestrator.createPlan(
      'User-assigned task plan',
      stepDescriptions,
      session.id,
      taskIds
    );

    const steps = taskOrchestrator.getPendingSteps(plan.id);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      taskOrchestrator.markStepRunning(step.id);

      const stepPrompt = `[Plan Step ${i + 1}/${steps.length}]: ${step.description}\n\nExecute this step using available tools. When complete, summarize what was done.`;

      await executeStep(stepPrompt, session, options);

      taskOrchestrator.markStepCompleted(step.id);
    }

    const progress = taskOrchestrator.getPlanProgress(plan.id);
    const summaryPrompt = `All ${steps.length} plan steps have been completed (${progress?.percent ?? 0}%). Provide a brief summary of what was accomplished.`;
    await executeStep(summaryPrompt, session, options);
  }
}
