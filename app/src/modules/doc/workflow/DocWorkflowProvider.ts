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
 * doc 工作流 Provider（P0-1 **接入点第一刀**）
 *
 * 把 `runDocWorkflow` 的四阶段声明为 seam 可调度的 `WorkflowDefinition`，让 workflow seam
 * （拓扑序 + 成员级账本 + 失败归因）对 doc 流水线**真实生效** —— 这是 P0-1/P0-2 从"有内核、
 * 无数据"走向"有真实数据"的第一步（方案见 `.trae/specs/graph-engineering-p0.md` §七）。
 *
 * **第一刀边界**：
 * - **不改** `runDocWorkflow` 及其调用方 ⇒ 现有文档生成行为完全不变；
 * - 本 Provider 目前只被 `engine.execute()` 调用（把 `office:workflow` 工具切到 seam 属第二刀）。
 *
 * TODO: CS05-ROOTFIX — 第一刀期间本文件与 `runDocWorkflow` 各自持有同一阶段序列（临时双轨）；
 * 第二刀收口后由本 Provider 独占序列、`runDocWorkflow` 降为薄包装（spec §七.2）。
 */

import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import type {
  WorkflowDefinition,
  WorkflowProvider,
  WorkflowRunResult,
  WorkflowStepReporter,
  WorkflowStepSpec,
} from '@modules/workflow';
import type { DocOutline } from '../types/outline';
import {
  buildOutline,
  compose,
  fillContent,
  generateImages,
} from './DocWorkflow';
import type {
  BuildOutlineInput,
  ComposeResult,
  RunDocWorkflowOptions,
} from './DocWorkflow';

const logger = getLogger('doc:workflow-provider');

/** doc 流水线工作流名（seam 内全局唯一） */
export const DOC_PIPELINE_WORKFLOW = 'doc_pipeline';
/** doc 域 Provider 标识 */
export const DOC_PROVIDER_ID = 'doc';

/**
 * `execute()` 的 params 形状（seam 的 params 为 `Record<string, unknown>`，
 * 由本域自行约定；缺项**抛错**而非静默降级）。
 */
export interface DocPipelineParams {
  input: BuildOutlineInput;
  llmNodes: DocOutline['nodes'];
  fillNode: RunDocWorkflowOptions['fillNode'];
  generateImage: RunDocWorkflowOptions['generateImage'];
  generateDoc: RunDocWorkflowOptions['generateDoc'];
  fillConcurrency?: number;
  imageConcurrency?: number;
  confirmOutline?: RunDocWorkflowOptions['confirmOutline'];
}

/** 阶段 id（与 `runDocWorkflow` 的三阶段语义一一对应；配图是填充阶段的辅助动作，故独立成步） */
const STEP_OUTLINE = 'outline';
const STEP_FILL = 'fill_content';
const STEP_IMAGES = 'images';
const STEP_COMPOSE = 'compose';

export class DocWorkflowProvider implements WorkflowProvider {
  readonly providerId = DOC_PROVIDER_ID;

  listWorkflows(): WorkflowDefinition[] {
    return [
      {
        name: DOC_PIPELINE_WORKFLOW,
        description: '文档生成流水线：大纲 → 内容填充 → 配图 → 成稿',
        steps: [
          {
            id: STEP_OUTLINE,
            description: '整理大纲（含 PPT 精炼校验）',
            tool: 'doc:build_outline',
          },
          {
            id: STEP_FILL,
            description: '填充各节点内容',
            tool: 'doc:fill_content',
            dependsOn: [STEP_OUTLINE],
          },
          {
            id: STEP_IMAGES,
            description: '按 imageHint 生成配图',
            tool: 'doc:generate_images',
            dependsOn: [STEP_FILL],
          },
          {
            id: STEP_COMPOSE,
            description: '合成文档并落盘',
            tool: 'doc:compose',
            dependsOn: [STEP_IMAGES],
          },
        ],
      },
    ];
  }

  async execute(
    definition: WorkflowDefinition,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    stepReporter?: WorkflowStepReporter
  ): Promise<WorkflowRunResult> {
    if (definition.name !== DOC_PIPELINE_WORKFLOW) {
      return {
        stopReason: 'error',
        completedSteps: [],
        error: `未知工作流: ${definition.name}`,
      };
    }

    const p = params as unknown as DocPipelineParams;
    const missing = (
      ['input', 'llmNodes', 'fillNode', 'generateImage', 'generateDoc'] as const
    ).filter((key) => p?.[key] === undefined);
    if (missing.length > 0) {
      throw new AppError(
        `doc 流水线缺少必需参数: ${missing.join(', ')}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'DOC_PIPELINE_PARAMS_MISSING'
      );
    }

    const planned = new Map<string, WorkflowStepSpec>(
      definition.steps.map((step) => [step.id, step])
    );
    const completedSteps: string[] = [];

    /** 阶段边界上报（配对不变式由 seam 账本兜底，此处只报事实） */
    const beginStep = (stepId: string): void => {
      const step = planned.get(stepId);
      if (!step) return;
      stepReporter?.onStepStart?.({
        stepId: step.id,
        tool: step.tool,
        description: step.description,
        startedAt: Date.now(),
      });
    };
    const finishStep = (stepId: string, error?: unknown): void => {
      if (error === undefined) completedSteps.push(stepId);
      stepReporter?.onStepEnd?.({
        stepId,
        outcome: error === undefined ? 'completed' : 'failed',
        ...(error === undefined ? {} : { error: String(error) }),
      });
    };

    /** 每个阶段边界检查取消（seam 契约：Provider 在步骤边界返回 cancelled） */
    const cancelled = (): WorkflowRunResult | undefined =>
      signal?.aborted
        ? {
            stopReason: 'cancelled',
            completedSteps: [...completedSteps],
            error: '运行在步骤边界被取消',
          }
        : undefined;

    let outline: DocOutline;
    /** 填充阶段的产物类型（`FilledOutline`）——用推导而非猜名，避免与实现漂移 */
    let filled: Awaited<ReturnType<typeof fillContent>>;
    let result: ComposeResult;

    // 阶段①：大纲（本阶段失败直接抛——后续阶段无输入可依）
    beginStep(STEP_OUTLINE);
    try {
      outline = buildOutline(p.input, p.llmNodes);
      if (p.confirmOutline && !(await p.confirmOutline(outline))) {
        finishStep(STEP_OUTLINE, new Error('用户取消大纲'));
        return {
          stopReason: 'error',
          completedSteps: [...completedSteps],
          error: '用户取消大纲',
        };
      }
      finishStep(STEP_OUTLINE);
    } catch (error) {
      finishStep(STEP_OUTLINE, error);
      return {
        stopReason: 'error',
        completedSteps: [...completedSteps],
        error: String(error),
      };
    }

    // 阶段②：内容填充
    const afterOutline = cancelled();
    if (afterOutline) return afterOutline;
    beginStep(STEP_FILL);
    try {
      filled = await fillContent(outline, p.fillNode, {
        concurrency: p.fillConcurrency,
      });
      finishStep(STEP_FILL);
    } catch (error) {
      finishStep(STEP_FILL, error);
      return {
        stopReason: 'error',
        completedSteps: [...completedSteps],
        error: String(error),
      };
    }

    // 阶段③：配图（独立成步：失败可定位到"配图"而非笼统的"填充"）
    const afterFill = cancelled();
    if (afterFill) return afterFill;
    beginStep(STEP_IMAGES);
    try {
      await generateImages(filled, {
        generateImage: p.generateImage,
        concurrency: p.imageConcurrency,
      });
      finishStep(STEP_IMAGES);
    } catch (error) {
      finishStep(STEP_IMAGES, error);
      return {
        stopReason: 'error',
        completedSteps: [...completedSteps],
        error: String(error),
      };
    }

    // 阶段④：成稿
    const afterImages = cancelled();
    if (afterImages) return afterImages;
    beginStep(STEP_COMPOSE);
    try {
      result = await compose(filled, p.generateDoc);
      finishStep(STEP_COMPOSE);
    } catch (error) {
      finishStep(STEP_COMPOSE, error);
      logger.warn('doc 流水线成稿阶段失败', {
        topic: p.input.topic,
        format: p.input.format,
        error: String(error),
      });
      return {
        stopReason: 'error',
        completedSteps: [...completedSteps],
        error: String(error),
      };
    }

    return { stopReason: 'completed', completedSteps, value: result };
  }
}
