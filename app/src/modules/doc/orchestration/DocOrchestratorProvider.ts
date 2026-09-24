// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * doc 编排工作流 Provider（P0-1 **接入点第二刀**）
 *
 * 把 `DocOrchestrator.workflows`（`send-report` / `reply-with-doc` / `meeting-to-all`，
 * 即 `office:workflow` 工具真实执行的那三个跨模块工作流）声明为 seam 可调度的
 * `WorkflowDefinition`，从而让 workflow seam（拓扑序 + 成员级账本 + 失败归因）
 * 对**真实生产链路**生效。
 *
 * **实现唯一性（关键设计约束）**：本 Provider **不复制**步骤循环 —— 步骤序列与
 * 步骤间参数传递（如 `doc:create-docx` 产物注入后续 `mail:send` 的附件）仍由
 * `DocOrchestrator.execute()` 独占实现，Provider 只：
 *  ① 声明定义；② 把 `DocStepHooks` 桥接为 seam 的 `WorkflowStepReporter`；③ 把
 * `WorkflowResult` 映射为 `WorkflowRunResult`。抄第二份循环会直接违反 CS01 / R02。
 *
 * **步骤 id = 工具名**（沿用 P1-3 §11.1 已验证结论：`step.id === step.tool`），故
 * `WorkflowRunResult.completedSteps` 与既有 `office:workflow` 工具返回的
 * `metadata.completedSteps`（工具名数组）语义一致。**代价**：同一工作流内同一工具
 * 不得出现两次 —— 该约束由 `WorkflowEngine.validate()` 在**注册期**拦截（fail loud）。
 */

import { getLogger } from '@modules/monitoring';
import type {
  WorkflowDefinition,
  WorkflowProvider,
  WorkflowRunResult,
  WorkflowStepReporter,
} from '@modules/workflow';
import { DocOrchestrator } from './DocOrchestrator';

const logger = getLogger('doc:orchestrator-provider');

/** doc 编排域 Provider 标识 */
export const DOC_ORCHESTRATOR_PROVIDER_ID = 'doc-orchestrator';

export class DocOrchestratorProvider implements WorkflowProvider {
  readonly providerId = DOC_ORCHESTRATOR_PROVIDER_ID;

  constructor(private readonly orchestrator: DocOrchestrator) {}

  listWorkflows(): WorkflowDefinition[] {
    return Object.entries(DocOrchestrator.workflows).map(([name, steps]) => ({
      name,
      description: `跨模块编排：${steps.map((s) => s.tool).join(' → ')}`,
      // 链式依赖：编排器**顺序推进**且前一步产物注入下一步（如 `doc:create-docx` 的
      // filePath 进入后续 `mail:send` 的 attachments）⇒ 后一步语义上依赖前一步。
      // 声明为链不改变执行序（无依赖时 `orderSteps` 本就按声明序），但让**失败归因**
      // 有边可循（`findRootCauseCandidates` 沿 dependsOn 入边回溯）。
      steps: steps.map((step, index) => ({
        id: step.tool,
        description: step.description,
        tool: step.tool,
        ...(index === 0 ? {} : { dependsOn: [steps[index - 1].tool] }),
      })),
    }));
  }

  /**
   * 执行工作流：**委托** `DocOrchestrator`，仅桥接观察与结果映射。
   *
   * `signal` 当前未使用：`office:workflow` 工具不注入取消信号，取消由 seam 的
   * 宽限期强制结算兜底（`WorkflowEngine.raceWithCancelGrace`）。
   */
  async execute(
    definition: WorkflowDefinition,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    stepReporter?: WorkflowStepReporter
  ): Promise<WorkflowRunResult> {
    const result = await this.orchestrator.execute(definition.name, params, {
      onStepStart: (info) => {
        stepReporter?.onStepStart?.({
          stepId: info.tool,
          tool: info.tool,
          description: info.description,
          startedAt: info.startedAt,
        });
      },
      onStepEnd: (info) => {
        stepReporter?.onStepEnd?.({
          stepId: info.tool,
          outcome: info.outcome,
          ...(info.error === undefined ? {} : { error: info.error }),
        });
      },
    });

    if (!result.success) {
      logger.warn('doc 编排工作流执行失败', {
        workflow: definition.name,
        completedSteps: result.completedSteps,
        error: result.error,
      });
      return {
        stopReason: 'error',
        completedSteps: [...result.completedSteps],
        error: result.error ?? `工作流 ${definition.name} 执行失败`,
      };
    }

    return {
      stopReason: 'completed',
      completedSteps: [...result.completedSteps],
      value: result.output,
    };
  }
}
