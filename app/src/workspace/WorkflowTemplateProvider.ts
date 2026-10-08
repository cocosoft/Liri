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
 * 用户工作流模板 → workflow seam **Provider**（P1-19 ②，2026-10-08）
 *
 * 规格：`.trae/specs/workflow-template-execution-binding.md`（推荐形态 ①+②）。
 * 把**用户自定义模板**（`workflow_templates` 表）中**显式带 `tool`** 的条目装配为可执行
 * `WorkflowDefinition` 并交给 seam（`WorkflowEngine`）；内建 4 模板不含 `tool` ⇒ 不产出
 * 任何定义 ⇒ 行为与现状一致（spec §5.1）。
 *
 * **职责边界（CS01：不重写既有能力）**：
 * - 装配 = 复用纯函数 `templateToDefinition`（本模块不重复映射逻辑）；
 * - 拓扑序 / 依赖校验 / 成员级账本 / 取消宽限 = **seam 负责**（本 Provider 只逐步执行）；
 * - 工具执行 = **注入**（`WorkflowStepExecutor`）—— 复用既有工具执行门
 *   （`globalToolManager.executeTool`），**不新建权限旁路**。
 *
 * ⚠️ **权限边界（P0-3 / S24 ③）仍待独立裁定**：本 Provider 不自行定义"模板可调哪些工具"的
 * 策略，步骤工具经**与模型同一条**工具执行门 ⇒ 不新增特权；若后续要在其上叠加**模板专属**
 * 白名单，落点在该门而非本类。
 */
import { getLogger } from '@modules/monitoring';
import type {
  WorkflowDefinition,
  WorkflowEngine,
  WorkflowProvider,
  WorkflowRunResult,
  WorkflowStepReporter,
} from '@modules/workflow';

import type { WorkflowTemplate } from './types';
import { templateToDefinition } from './workflowTemplateAssembly';

const logger = getLogger('workspace:workflowTemplateProvider');

/** Provider 标识（seam 注册表键；重复注册 seam 会 fail loud） */
export const WORKFLOW_TEMPLATE_PROVIDER_ID = 'workspace:workflow-templates';

/** 模板来源（**同步** —— seam 的 `listWorkflows()` 是同步契约，故由 store 的同步快照供给） */
export type WorkflowTemplateSource = () => WorkflowTemplate[];

/** 单步工具执行器（注入；生产实现 = `globalToolManager.executeTool`） */
export type WorkflowStepExecutor = (
  tool: string,
  params: Record<string, unknown>
) => Promise<unknown>;

export class WorkflowTemplateProvider implements WorkflowProvider {
  readonly providerId = WORKFLOW_TEMPLATE_PROVIDER_ID;

  constructor(
    private readonly listTemplates: WorkflowTemplateSource,
    private readonly execTool: WorkflowStepExecutor
  ) {}

  /**
   * 声明本 Provider 承载的定义。
   *
   * **同步**：只读调用方给的模板快照（store 的派生缓存），只为**可执行**模板产出定义
   * （`templateToDefinition` 返回 `null` 者跳过 —— 缺 `tool` 的模板显式不可执行）。
   */
  listWorkflows(): WorkflowDefinition[] {
    const definitions: WorkflowDefinition[] = [];
    for (const template of this.listTemplates()) {
      const definition = templateToDefinition(template);
      if (definition) definitions.push(definition);
    }
    return definitions;
  }

  /**
   * 逐步执行（定义已由 seam 通过静态校验并按拓扑序排列）。
   *
   * 语义（对齐既有 doc Provider）：
   * - 每步 = 一次 `execTool(step.tool, {...step.params, ...params})`（**运行时参数覆盖步骤参数**）；
   * - 首个失败步骤即终止，`completedSteps` 只含**此前成功**的步骤；
   * - **步骤边界**检查 `signal` ⇒ 中止时返回 `cancelled`（seam 契约）；
   * - 步骤起止经 `stepReporter` 上报（未实现上报时由 seam 账本兜底合成）。
   */
  async execute(
    definition: WorkflowDefinition,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    stepReporter?: WorkflowStepReporter
  ): Promise<WorkflowRunResult> {
    const completedSteps: string[] = [];
    /** 步骤边界取消判定（seam 契约：Provider 在步骤边界返回 cancelled） */
    const cancelledResult = (): WorkflowRunResult | undefined =>
      signal?.aborted
        ? {
            stopReason: 'cancelled',
            completedSteps: [...completedSteps],
            error: '运行在步骤边界被取消',
          }
        : undefined;

    for (const step of definition.steps) {
      const cancelled = cancelledResult();
      if (cancelled) return cancelled;

      stepReporter?.onStepStart?.({
        stepId: step.id,
        tool: step.tool,
        description: step.description,
        startedAt: Date.now(),
      });

      try {
        await this.execTool(step.tool, { ...(step.params ?? {}), ...params });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stepReporter?.onStepEnd?.({
          stepId: step.id,
          outcome: 'failed',
          error: message,
        });
        logger.warn('模板工作流步骤失败', {
          workflow: definition.name,
          stepId: step.id,
          tool: step.tool,
          completedSteps: completedSteps.length,
          error: message,
        });
        return {
          stopReason: 'error',
          completedSteps: [...completedSteps],
          error: `步骤 ${step.id}(${step.tool}) 失败: ${message}`,
        };
      }

      completedSteps.push(step.id);
      stepReporter?.onStepEnd?.({ stepId: step.id, outcome: 'completed' });
    }

    return {
      stopReason: 'completed',
      completedSteps,
      value: { steps: completedSteps },
    };
  }
}

/**
 * 注册到 workflow seam（**幂等**：已注册则跳过 —— seam 重复注册会抛 fatal）。
 *
 * 生产接线点 = Phase 5 `domain:init`（`BootPipelineIntegrator`）。工具执行器在此**动态**取
 * `globalToolManager`，避免把 tools 域拖进 workspace 的模块顶层依赖。
 *
 * ⚠️ **不**改动 `office:workflow` 工具的参数 enum（= 不打开模型可见触发面）——
 * "谁触发"属 **P0-2**，仍待独立裁定。
 */
export async function registerWorkflowTemplateProvider(
  engine: WorkflowEngine
): Promise<boolean> {
  if (engine.hasProvider(WORKFLOW_TEMPLATE_PROVIDER_ID)) {
    logger.info('工作流模板 Provider 已注册，跳过', {
      providerId: WORKFLOW_TEMPLATE_PROVIDER_ID,
    });
    return false;
  }

  const [{ getWorkflowTemplateStore }, { globalToolManager }] =
    await Promise.all([
      import('./WorkflowTemplateStore'),
      import('@modules/tools'),
    ]);

  const store = getWorkflowTemplateStore();
  // 预热同步快照（seam 的 `listWorkflows()` 是同步契约，而 sqlite 是回调式异步）
  await store.list();

  const provider = new WorkflowTemplateProvider(
    () => store.listSync(),
    (tool, params) => globalToolManager.executeTool(tool, params, {})
  );
  const definitions = provider.listWorkflows();
  engine.registerProvider(provider);
  logger.info('工作流模板 Provider 已注册到 seam', {
    providerId: WORKFLOW_TEMPLATE_PROVIDER_ID,
    executableTemplates: definitions.length,
  });
  return true;
}
