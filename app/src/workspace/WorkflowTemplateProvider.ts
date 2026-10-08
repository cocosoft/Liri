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
 * **③ 权限边界（S24 ③，2026-10-08 已裁定）**：本 Provider 在**执行前**做权限预检 ——
 * **仅允许非破坏性工具**（`sideEffect === 'none'`；**未声明 ⇒ 拒绝**，fail-closed）。
 * 事实源 = `tools/toolEffects.ts` 的 `TOOL_EFFECTS`（编译期强制的唯一声明表），经
 * `ToolSideEffectResolver` **注入**（不在本类硬编码工具名表 —— 违 model-usage 规则精神）。
 * 越界 ⇒ **显式拒绝**（`stopReason:'error'`、`completedSteps` 为空），**不静默跳过越界步骤**。
 */
import { getLogger } from '@modules/monitoring';
import type {
  WorkflowDefinition,
  WorkflowEngine,
  WorkflowProvider,
  WorkflowRunResult,
  WorkflowStepReporter,
} from '@modules/workflow';
// 类型位镜像（③ 权限策略的取值域来自工具效果声明表；type-only ⇒ 无运行时依赖）
import type { ToolSideEffect } from '@modules/tools';

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

/**
 * 工具**副作用**解析器（注入；生产实现 = `resolveToolEffect`）。
 *
 * 注入而非直接 import：① 保持本 Provider 零业务依赖、可单测；② 策略事实源外置
 * （`tools/toolEffects.ts` 的 `TOOL_EFFECTS` 是编译期强制的**唯一声明表**）。
 *
 * 返回 `undefined` = **未声明**（MCP / 插件工具）⇒ 调用方按 **fail-closed** 处理。
 */
export type ToolSideEffectResolver = (
  tool: string
) => ToolSideEffect | undefined;

/** 模板执行 **③ 权限策略**（S24 ③，2026-10-08）：**仅允许非破坏性工具** */
export const PERMISSION_POLICY_NOTE =
  '模板仅允许调用**非破坏性**工具（`sideEffect === "none"`；未声明工具同样拒绝）';

export class WorkflowTemplateProvider implements WorkflowProvider {
  readonly providerId = WORKFLOW_TEMPLATE_PROVIDER_ID;

  constructor(
    private readonly listTemplates: WorkflowTemplateSource,
    private readonly execTool: WorkflowStepExecutor,
    /**
     * ③ 权限策略的事实源（**必填**：无隐式默认 ⇒ 策略不会因漏注入而静默失效）。
     */
    private readonly resolveSideEffect: ToolSideEffectResolver
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
   * ③ 权限预检（S24 ③）：列出**越界**工具（非 `none` 副作用，或未声明 ⇒ fail-closed）。
   *
   * 纯函数、无副作用；返回空数组 = 全部合规。
   */
  private unsafeTools(definition: WorkflowDefinition): string[] {
    const unsafe = new Set<string>();
    for (const step of definition.steps) {
      if (this.resolveSideEffect(step.tool) !== 'none') unsafe.add(step.tool);
    }
    return [...unsafe];
  }

  /**
   * 逐步执行（定义已由 seam 通过静态校验并按拓扑序排列）。
   *
   * 语义（对齐既有 doc Provider）：
   * - **执行前**先过 ③ 权限预检（越界 ⇒ `error` 且 `completedSteps` 为空，**不做任何步骤**）；
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
    // ③ 权限边界（S24 ③）：越界 ⇒ 显式拒绝（不静默跳过越界步骤 —— CS03）
    const unsafe = this.unsafeTools(definition);
    if (unsafe.length > 0) {
      logger.warn('模板执行被权限策略拒绝', {
        workflow: definition.name,
        unsafeTools: unsafe,
      });
      return {
        stopReason: 'error',
        completedSteps: [],
        error: `权限策略拒绝：${PERMISSION_POLICY_NOTE}；越界工具: ${unsafe.join(', ')}`,
      };
    }

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
 * 生产接线点 = Phase 5 `domain:init`（`BootPipelineIntegrator`）。工具执行器与**副作用解析器**
 * 在此**动态**取 `@modules/tools`，避免把 tools 域拖进 workspace 的模块顶层依赖。
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

  const [
    { getWorkflowTemplateStore },
    { globalToolManager, resolveToolEffect },
  ] = await Promise.all([
    import('./WorkflowTemplateStore'),
    import('@modules/tools'),
  ]);

  const store = getWorkflowTemplateStore();
  // 预热同步快照（seam 的 `listWorkflows()` 是同步契约，而 sqlite 是回调式异步）
  await store.list();

  const provider = new WorkflowTemplateProvider(
    () => store.listSync(),
    (tool, params) => globalToolManager.executeTool(tool, params, {}),
    // ③ 权限策略事实源（编译期强制的唯一声明表）；未声明工具 ⇒ undefined ⇒ 拒绝
    (tool) => resolveToolEffect(tool)?.sideEffect
  );
  const definitions = provider.listWorkflows();
  engine.registerProvider(provider);
  logger.info('工作流模板 Provider 已注册到 seam', {
    providerId: WORKFLOW_TEMPLATE_PROVIDER_ID,
    executableTemplates: definitions.length,
  });
  return true;
}
