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
 * doc 工作流 Provider（P0-1 **接入点**；临时双轨已于 2026-09-26 收口）
 *
 * 把 doc 四阶段流水线（`buildOutline → fillContent → generateImages → compose`）声明为
 * seam 可调度的 `WorkflowDefinition`，让 workflow seam（拓扑序 + 成员级账本 + 失败归因）
 * 对 doc 流水线**真实生效**（方案见 `.trae/specs/graph-engineering-p0.md` §七）。
 *
 * **✅ 序列单一事实源（原 `TODO: CS05-ROOTFIX` 已结）**：第一刀期间本文件与
 * `runDocWorkflow` 各持一份相同序列（临时双轨）；**2026-09-26「方案 3」已收口** ——
 * `runDocWorkflow` **已删除**、**本 Provider 独占序列**，进度由本 Provider 复用
 * `DocWorkflowProgressEmitter` 在阶段边界推进（保真度与删除前同等：节点清单 + 逐节点百分比）。
 * 调用路径：`office:doc-pipeline` 工具 → workflow seam（`engine.execute('doc_pipeline', …)`）。
 * 收口过程的完整记录见 `DocWorkflow.ts` 的「收口说明」段。
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
import { DocWorkflowProgressEmitter } from './DocWorkflow';
import type {
  BuildOutlineInput,
  ComposeResult,
  RunDocWorkflowOptions,
} from './DocWorkflow';
import type {
  DocWorkflowStage,
  DocWorkflowStageStatus,
} from '../types/outline';

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
  /**
   * 进度回调（方案 3 / 2026-09-26 新增）。
   *
   * 修复前本参数**不存在** ⇒ 经 seam 执行时**进度事件永不产生**（`runDocWorkflow` 内的
   * 发射器不参与），前端 `DocWorkflowProgress` 永不亮。现由本 Provider 复用**共享的**
   * `DocWorkflowProgressEmitter` 在阶段边界推进并 emit ⇒ seam 执行既得 run 记录、
   * 又有 `assistant/doc_workflow` 进度事件。
   */
  onProgress?: RunDocWorkflowOptions['onProgress'];
}

/** 阶段 id（与 doc 四阶段流水线语义对应；配图是填充阶段的辅助动作，故独立成步） */
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

    // ── 进度发射（方案 3）：与 seam 的 stepReporter **各司其职** ──
    // stepReporter → seam 账本（run 记录/成员级账本）；emitter → 前端进度卡片
    // （`assistant/doc_workflow` 富块事件）。二者互不替代，故并行推进。
    const emitter = new DocWorkflowProgressEmitter(
      p.input.topic,
      p.input.format
    );
    /** 推进某阶段状态并立即 emit（`onProgress` 缺省时为空操作） */
    const setStage = (
      stage: DocWorkflowStage,
      status: DocWorkflowStageStatus,
      description?: string
    ): void => {
      emitter.setStage(stage, status, description);
      emitter.emit(p.onProgress);
    };

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
    setStage(STEP_OUTLINE, 'in_progress', '正在生成大纲');
    try {
      outline = buildOutline(p.input, p.llmNodes);
      if (p.confirmOutline) {
        setStage(STEP_OUTLINE, 'awaiting_confirm', '大纲已生成，等待确认');
        if (!(await p.confirmOutline(outline))) {
          finishStep(STEP_OUTLINE, new Error('用户取消大纲'));
          emitter.setError('用户取消大纲');
          setStage(STEP_OUTLINE, 'failed', '用户取消大纲');
          return {
            stopReason: 'error',
            completedSteps: [...completedSteps],
            error: '用户取消大纲',
          };
        }
      }
      finishStep(STEP_OUTLINE);
      setStage(STEP_OUTLINE, 'completed');
    } catch (error) {
      finishStep(STEP_OUTLINE, error);
      emitter.setError(String(error));
      setStage(STEP_OUTLINE, 'failed', String(error));
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
    // `filling` 阶段覆盖 ②填充 + ③配图（配图是本阶段的辅助动作，见文件头 STEP_* 注释）
    // 保真度：与收口前的 `runDocWorkflow` **同等**（节点清单 + 逐节点百分比）——
    // 否则切到 seam 后前端进度卡会变粗（用户可见回退）。
    setStage('filling', 'in_progress', '正在填充内容');
    emitter.setNodes(
      'filling',
      outline.nodes.map((n) => ({
        id: n.id,
        title: n.title,
        status: 'pending' as const,
        hasImage: !!n.imageHint,
      }))
    );
    emitter.emit(p.onProgress);
    const totalNodes = outline.nodes.length;
    let filledCount = 0;
    try {
      filled = await fillContent(
        outline,
        async (node) => {
          const content = await p.fillNode(node);
          filledCount += 1;
          emitter.setProgress(
            'filling',
            Math.round((filledCount / totalNodes) * 100)
          );
          emitter.emit(p.onProgress);
          return content;
        },
        { concurrency: p.fillConcurrency }
      );
      finishStep(STEP_FILL);
    } catch (error) {
      finishStep(STEP_FILL, error);
      emitter.setError(String(error));
      setStage('filling', 'failed', String(error));
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
      // 配图完成 ⇒ 整个 filling 阶段结束
      setStage('filling', 'completed', '内容填充完成');
    } catch (error) {
      finishStep(STEP_IMAGES, error);
      emitter.setError(String(error));
      setStage('filling', 'failed', String(error));
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
    setStage('compose', 'in_progress', '正在生成文档');
    try {
      result = await compose(filled, p.generateDoc);
      finishStep(STEP_COMPOSE);
      emitter.setOutputFile(result.filePath);
      setStage('compose', 'completed', '文档生成完成');
    } catch (error) {
      finishStep(STEP_COMPOSE, error);
      emitter.setError(String(error));
      setStage('compose', 'failed', String(error));
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
