// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `office:doc-pipeline` 工具（P1-3 接线，2026-09-26）
 *
 * 让 `runDocWorkflow` 四阶段流水线**有生产调用方**。修复前：全链无生产者、
 * `assistant/doc_workflow` 事件全仓无 append ⇒ 前端 `DocWorkflowProgress` 永不亮。
 *
 * **分工（关键取舍）**：LLM 工作在**模型侧**完成（模型随参数给出大纲节点与各节正文），
 * 工具内**不回调对话管线**（避免工具内重入 chat）；成稿委托 `doc_generate`、配图委托
 * `image_generate`（工具调工具是本仓既有模式，`DocOrchestrator` 即如此）。
 *
 * **进度落盘**：`onProgress` → `ChatManager.persistDocWorkflowProgress()`
 * （走唯一事件写入入口，落 `assistant/doc_workflow` 富块事件）。
 *
 * **执行路径**：经 workflow seam（`getWorkflowEngine().execute(DOC_PIPELINE_WORKFLOW, …)`）
 * ⇒ 拓扑序 + 成员级账本 + 失败归因，且由 seam 侧装配器把 run 记录随 `ToolResult.metadata`
 * 带出；进度由 Provider 复用**共享** emitter 在阶段边界 emit（见 `DocPipelineParams.onProgress`）。
 *
 * **为何独立成文件**：R04-001（文件 ≤1000 行）—— 本工具约 280 行，留在 `DocModule.ts`
 * 会把该文件推过上限（实测 1006 行被门禁拦下）。
 */
import { getToolRegistry } from '@modules/tools';
import type { Tool, ToolUseContext } from '@modules/tools/types/Tool';
import { ToolExecutionStatus } from '@modules/tools/types/ToolResult';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { handleError } from '../../../core/errorHandler.js';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
} from '../../../core/errors.js';
import { getWorkflowEngine, createRunRecordCollector } from '@modules/workflow';
import {
  DOC_PIPELINE_WORKFLOW,
  type DocPipelineParams,
} from '../workflow/DocWorkflowProvider';
import type { DocFormat, DocOutlineNode } from '../types/outline';

/** 支持格式（不含 pdf：底层 `doc_generate` 的 type 无 pdf） */
const PIPELINE_FORMATS: readonly DocFormat[] = ['docx', 'pptx', 'html'];

/**
 * 配图委托（`image_generate`）。
 *
 * 实测形状（ImageGenerateTool.ts:504-515）：`{ success, data: { images: GeneratedImage[] }, output }`；
 * router 路径会把图片注册进 FileRegistry 并补 `filePath`（同文件 L475-493）⇒ 优先取**本地路径**，
 * 使成稿阶段内嵌图片而非引用远程 URL。
 *
 * 成败判定同时看 `success !== true` 与 `first` 是否存在：`ToolResult` 全仓同名多定义且**全字段可选**
 * ⇒ 编译期无法收窄成败形状（见台账「全仓 ≥4 处同名 ToolResult」条）。
 */
async function pipelineGenerateImage(
  prompt: string,
  context: ToolUseContext
): Promise<string> {
  const tool = getToolRegistry().getTool('image_generate');
  if (!tool) {
    throw new AppError(
      'image_generate 工具未注册，无法生成配图',
      ErrorCategory.EXECUTION,
      ErrorSeverity.MEDIUM,
      'DOC_PIPELINE_IMAGE_TOOL_MISSING'
    );
  }
  const res = (await tool.execute({ prompt }, context)) as {
    success?: boolean;
    error?: string;
    data?: {
      images?: Array<{ filePath?: string; localUrl?: string; url?: string }>;
    };
  };
  const first = res.data?.images?.[0];
  if (res.success !== true || !first) {
    throw new AppError(
      `配图生成失败：${res.error ?? '未返回图片'}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.MEDIUM,
      'DOC_PIPELINE_IMAGE_FAILED',
      { prompt: prompt.slice(0, 200) }
    );
  }
  const path = first.filePath ?? first.localUrl ?? first.url;
  if (!path) {
    throw new AppError(
      '配图结果缺少可用路径（filePath/localUrl/url 均为空）',
      ErrorCategory.EXECUTION,
      ErrorSeverity.MEDIUM,
      'DOC_PIPELINE_IMAGE_NO_PATH'
    );
  }
  return path;
}

/**
 * 成稿委托（`doc_generate`）。
 *
 * 实测形状（DocGenerateTool.ts:1572-1585）：成功 `{ success: true, data: { fileName, filePath, type, size }, output }`，
 * 失败 `{ success: false, error }`；其入参为 `type`（取值 docx/xlsx/pptx/html，**无 pdf**）。
 */
async function pipelineGenerateDoc(
  title: string,
  content: string,
  format: DocFormat,
  context: ToolUseContext
): Promise<{ filePath: string; format: string }> {
  const tool = getToolRegistry().getTool('doc_generate');
  if (!tool) {
    throw new AppError(
      'doc_generate 工具未注册，无法成稿',
      ErrorCategory.EXECUTION,
      ErrorSeverity.MEDIUM,
      'DOC_PIPELINE_DOC_TOOL_MISSING'
    );
  }
  const res = (await tool.execute(
    { title, content, type: format },
    context
  )) as {
    success?: boolean;
    error?: string;
    data?: { filePath?: string };
  };
  if (res.success !== true || !res.data?.filePath) {
    throw new AppError(
      `文档成稿失败：${res.error ?? '未返回文件路径'}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.MEDIUM,
      'DOC_PIPELINE_DOC_FAILED',
      { title, format }
    );
  }
  return { filePath: res.data.filePath, format };
}

/** 创建 `office:doc-pipeline` 工具（见文件头注释） */
export function createDocPipelineTool(): Tool {
  return {
    name: 'office:doc-pipeline',
    description:
      'Generate a long-form document through a staged pipeline (outline -> per-node content -> images -> compose) with live 3-stage progress. ' +
      'IMPORTANT: the LLM work happens on YOUR side - pass the outline nodes AND each node content as params; this tool does not call the model. ' +
      `Supported formats: ${PIPELINE_FORMATS.join(', ')} (pdf is NOT supported).`,
    params: [
      {
        name: 'topic',
        type: 'string',
        description: '文档主题（同时作为文档标题）',
        required: true,
      },
      {
        name: 'format',
        type: 'string',
        description: `输出格式，可选值: ${PIPELINE_FORMATS.join(' | ')}`,
        required: true,
        enum: [...PIPELINE_FORMATS],
      },
      {
        name: 'nodes',
        type: 'array',
        description:
          '大纲节点数组，每项 { id?, title, bullets?, content?, imageHint? }：title 必填；content 与 bullets 至少一项；imageHint 非空则触发配图',
        required: true,
      },
      {
        name: 'fillConcurrency',
        type: 'number',
        description: '内容填充并发度（默认 1，串行）',
        required: false,
      },
      {
        name: 'imageConcurrency',
        type: 'number',
        description: '配图并发度（默认 3）',
        required: false,
      },
    ],
    aliases: ['office_doc_pipeline', 'doc_pipeline'],
    searchTips: ['doc', 'document', 'pipeline', 'long-form', 'report'],
    isEnabled: () => true,
    isReadOnly: () => false,
    isDestructive: () => false,
    isConcurrencySafe: () => false,

    async execute(input: Record<string, unknown>, context: ToolUseContext) {
      const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
      const format = input.format as DocFormat;
      const rawNodes = Array.isArray(input.nodes)
        ? (input.nodes as unknown[])
        : [];
      const sessionId = context.sessionId;

      const fail = (message: string) => ({
        status: ToolExecutionStatus.FAILURE,
        data: { success: false, error: message },
        output: message,
        errorOutput: message,
        executionTime: 0,
        executionId: `doc_pipeline_${Date.now()}`,
        toolName: 'office:doc-pipeline',
        timestamp: Date.now(),
      });

      // ── 参数校验（缺项明确报错，不静默降级） ──
      if (!topic) return fail('topic 不能为空');
      if (!PIPELINE_FORMATS.includes(format)) {
        return fail(
          format === 'pdf'
            ? '暂不支持 format=pdf：底层 doc_generate 的 type 仅支持 docx/xlsx/pptx/html，无法产出 pdf（请先生成 docx 再转换）'
            : `format 非法：${String(input.format)}（可选 ${PIPELINE_FORMATS.join('/')}）`
        );
      }
      if (rawNodes.length === 0) return fail('nodes 不能为空');

      const llmNodes: DocOutlineNode[] = [];
      for (let i = 0; i < rawNodes.length; i += 1) {
        const raw = (rawNodes[i] ?? {}) as Record<string, unknown>;
        const title = typeof raw.title === 'string' ? raw.title.trim() : '';
        if (!title) return fail(`nodes[${i}].title 不能为空`);
        const content =
          typeof raw.content === 'string' ? raw.content : undefined;
        const bullets = Array.isArray(raw.bullets)
          ? raw.bullets.filter((b): b is string => typeof b === 'string')
          : undefined;
        if (content === undefined && (!bullets || bullets.length === 0)) {
          return fail(
            `nodes[${i}] 需提供 content 或非空 bullets —— 本工具的 LLM 工作由你完成，正文须随参数给出`
          );
        }
        const imageHint =
          typeof raw.imageHint === 'string' ? raw.imageHint.trim() : '';
        llmNodes.push({
          id:
            typeof raw.id === 'string' && raw.id.trim()
              ? raw.id.trim()
              : `sec-${i + 1}`,
          kind: 'section',
          title,
          ...(bullets ? { bullets } : {}),
          ...(content === undefined ? {} : { content }),
          ...(imageHint ? { imageHint } : {}),
        });
      }

      const pipelineParams: DocPipelineParams = {
        input: { topic, format },
        llmNodes,
        // 直通：填充阶段的"LLM 结果"由模型随参数给出（工具内不回调 chat，避免重入）
        fillNode: async (node) =>
          node.content ?? (node.bullets ?? []).join('\n'),
        generateImage: (prompt) => pipelineGenerateImage(prompt, context),
        generateDoc: (params) =>
          pipelineGenerateDoc(
            params.title,
            params.content,
            params.format,
            context
          ),
        ...(typeof input.fillConcurrency === 'number'
          ? { fillConcurrency: input.fillConcurrency }
          : {}),
        ...(typeof input.imageConcurrency === 'number'
          ? { imageConcurrency: input.imageConcurrency }
          : {}),
        onProgress: (data) => {
          if (!sessionId) return;
          // 不 await：进度落盘失败不得阻断流水线（appendStreamEvent 内部已 try/catch）
          void getCoreAPI()
            .getChatManager()
            .persistDocWorkflowProgress(sessionId, data);
        },
      };

      try {
        // P1-19 ①（2026-10-05）：传 sessionId ⇒ 成员级事件执行期实时落盘；drain() 保证
        // 实时事件（含 run_end）先于 tool/result 落盘。
        const {
          observer,
          record: workflowRun,
          drain,
        } = createRunRecordCollector({ sessionId });
        const runResult = await getWorkflowEngine().execute(
          DOC_PIPELINE_WORKFLOW,
          pipelineParams as unknown as Record<string, unknown>,
          {
            observer,
            // P1-19 ⑤：与 office:workflow 同源 —— 透传会话级中止信号
            // （未注入 abortController 时不传，行为不变）；
            // grace=0：用户中止 ⇒ 立即结算 cancelled（用户裁定，2026-10-05）
            ...(context?.abortController
              ? { signal: context.abortController.signal, gracePeriodMs: 0 }
              : {}),
          }
        );
        await drain();
        const success = runResult.stopReason === 'completed';
        const composed = success
          ? (runResult.value as
              | { filePath?: string; format?: string }
              | undefined)
          : undefined;
        if (!success || !composed?.filePath) {
          const message =
            runResult.error ??
            `doc_pipeline 未完成（stopReason=${runResult.stopReason}）`;
          return {
            ...fail(`doc_pipeline 执行失败：${message}`),
            metadata: {
              workflowRun,
              completedSteps: runResult.completedSteps,
            },
          };
        }
        return {
          status: ToolExecutionStatus.SUCCESS,
          data: {
            success: true,
            filePath: composed.filePath,
            format: composed.format ?? format,
          },
          output: `文档已生成：${composed.filePath}`,
          errorOutput: '',
          executionTime: 0,
          executionId: `doc_pipeline_${Date.now()}`,
          toolName: 'office:doc-pipeline',
          timestamp: Date.now(),
          metadata: { workflowRun, completedSteps: runResult.completedSteps },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await handleError(error, {
          module: 'doc:pipeline',
          action: 'office:doc-pipeline 执行失败',
          context: { topic, format, nodeCount: llmNodes.length },
        });
        return fail(`doc_pipeline 执行失败：${message}`);
      }
    },

    getInfo() {
      return {
        name: 'office:doc-pipeline',
        description: this.description,
        params: this.params,
        aliases: this.aliases,
        searchTips: this.searchTips,
        enabled: true,
        readOnly: false,
        destructive: false,
        concurrencySafe: false,
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block',
      };
    },
  };
}
