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
 * `workflow:run-template` 工具 —— 让**模型**能列出/执行**用户自定义工作流模板**
 * （P0-2 续：新增专用工具，2026-10-08）
 *
 * 规格：`.trae/specs/workflow-template-execution-binding.md` §7（P0-2 / P0-3）。
 *
 * **为何"新增专用工具"而非扩 `office:workflow`**：后者属 doc 域、其参数 `enum` 在
 * **工具创建时静态生成**（用户模板是运行期 CRUD ⇒ 永远进不去），且语义专属办公编排。
 * 本工具**不用 enum**：模板 id 由调用方给出，**未知 id 时返回当前可用清单**
 * （动态目录的正确做法 —— 静态 enum 承载不了 CRUD 目录）。
 *
 * **③ 权限策略由 seam 侧 Provider 统一预检**（仅非破坏性工具）：本工具**不复制**策略，
 * 只把调用转给 `WorkflowEngine.execute('template:<id>')` ⇒ **同一收口**（复用，CS01）。
 * 因此本工具**不新增特权**：越界模板会被 Provider 在执行前整体拒绝。
 *
 * ⚠️ **必须登记 `TOOL_CATEGORIES`**（N-44/N-45）：出站按 **wire 安全名**
 * （`workflow:run-template` → `workflow_run-template`）裁剪工具集，未登记类别 ⇒ 落 `misc`
 * ⇒ **不在任何任务白名单** ⇒ 模型**永远看不到本工具**（这正是 N-45 的现场）。
 *
 * **注册**：运行期注册（同 `office:*` 由所属域注册），**非** `ToolFactory` 内建 ——
 * 故不进 `toolNames.generated.ts`。
 */
import type { Tool, ToolUseContext } from '@modules/tools/types/Tool';
import { ToolExecutionStatus } from '@modules/tools/types/ToolResult';
import { getToolRegistry, globalToolManager } from '@modules/tools';
import { getLogger } from '@modules/monitoring';
import {
  createRunRecordCollector,
  getWorkflowEngine,
  type WorkflowRunResult,
} from '@modules/workflow';

import { getWorkflowTemplateStore } from './WorkflowTemplateStore';
import {
  templateToDefinition,
  templateWorkflowName,
} from './workflowTemplateAssembly';

const logger = getLogger('workspace:workflowTemplateTool');

/** 工具名（运行期注册名；与 `office:*` 同类，不在内建名生成物内） */
export const WORKFLOW_TEMPLATE_TOOL_NAME = 'workflow:run-template';

/** 可执行模板的**简要清单**（含步骤工具名；供模型选择） */
export interface RunnableTemplateBrief {
  id: string;
  name: string;
  description: string;
  steps: Array<{ id: string; tool: string; description: string }>;
}

/** 一次执行的归一结果（含 seam 侧 run 记录，供随 `metadata` 带出） */
export interface TemplateRunOutcome {
  result: WorkflowRunResult;
  workflowRun?: unknown;
}

/** 工具依赖（**注入** ⇒ 可单测，且不把 store/seam 拖进测试） */
export interface WorkflowTemplateToolDeps {
  /** 列出"结构上可执行"的模板（装配层过滤掉缺 `tool` 者） */
  listRunnableTemplates: () => RunnableTemplateBrief[];
  /** 执行模板（默认实现含成员级事件落盘 + 会话级中止透传） */
  runTemplate: (
    templateId: string,
    params: Record<string, unknown>,
    context?: ToolUseContext
  ) => Promise<TemplateRunOutcome>;
}

/**
 * 从 store 的**同步快照**取"结构上可执行"的模板。
 *
 * 注：这里**不含** ③ 权限判定 —— 权限由 Provider 在执行前判定（唯一收口）；
 * 清单多列一条越界模板不算错，执行时会被明确拒绝（不静默）。
 */
function listRunnableFromStore(): RunnableTemplateBrief[] {
  const briefs: RunnableTemplateBrief[] = [];
  for (const template of getWorkflowTemplateStore().listSync()) {
    const definition = templateToDefinition(template);
    if (!definition) continue;
    briefs.push({
      id: template.id,
      name: template.name,
      description: definition.description,
      steps: definition.steps.map((step) => ({
        id: step.id,
        tool: step.tool,
        description: step.description,
      })),
    });
  }
  return briefs;
}

/** 生产默认依赖（真实 store 同步快照 + workflow seam） */
export function defaultWorkflowTemplateToolDeps(): WorkflowTemplateToolDeps {
  return {
    listRunnableTemplates: listRunnableFromStore,
    runTemplate: async (templateId, params, context) => {
      // 成员级事件随会话实时落盘（同 office:workflow 的 P1-19 ① 手法）
      const {
        observer,
        record: workflowRun,
        drain,
      } = createRunRecordCollector({ sessionId: context?.sessionId });
      try {
        const result = await getWorkflowEngine().execute(
          templateWorkflowName(templateId),
          params,
          {
            observer,
            // 与 office:workflow / office:doc-pipeline 同源：透传会话级中止信号
            ...(context?.abortController
              ? { signal: context.abortController.signal, gracePeriodMs: 0 }
              : {}),
          }
        );
        return { result, workflowRun };
      } finally {
        await drain();
      }
    },
  };
}

/** 创建 `workflow:run-template` 工具 */
export function createWorkflowTemplateTool(
  deps: WorkflowTemplateToolDeps = defaultWorkflowTemplateToolDeps()
): Tool {
  return {
    name: WORKFLOW_TEMPLATE_TOOL_NAME,
    description:
      'List or run the user-defined workflow templates stored in the workspace. ' +
      'Use action="list" to see the available templates and the tool each step calls, then ' +
      'action="run" with the template id plus its params. ' +
      'Policy: templates may only call non-destructive tools; a template violating this is ' +
      'rejected before any step runs. Templates whose steps lack an explicit tool are not runnable.',
    params: [
      {
        name: 'action',
        type: 'string',
        description: '动作：list = 列出可执行模板；run = 执行指定模板',
        required: true,
        enum: ['list', 'run'],
      },
      {
        name: 'template',
        type: 'string',
        description:
          '模板 id（action=run 时必填）。未知 id 或不可执行时，返回当前可用清单。',
        required: false,
      },
      {
        name: 'params',
        type: 'object',
        description: '传给各步骤工具的运行时参数（与步骤参数合并，运行时优先）',
        required: false,
      },
    ],
    aliases: ['run_workflow_template', 'workflow_template'],
    searchTips: ['workflow', 'template', 'run'],
    isEnabled: () => true,
    isReadOnly: () => false,
    isDestructive: () => false,
    isConcurrencySafe: () => false,

    async execute(input: Record<string, unknown>, context?: ToolUseContext) {
      const executionId = `workflow_template_${Date.now()}`;
      const fail = (message: string, metadata?: Record<string, unknown>) => ({
        status: ToolExecutionStatus.FAILURE,
        data: { success: false, error: message },
        output: message,
        errorOutput: message,
        executionTime: 0,
        executionId,
        toolName: WORKFLOW_TEMPLATE_TOOL_NAME,
        timestamp: Date.now(),
        ...(metadata ? { metadata } : {}),
      });

      const action = typeof input.action === 'string' ? input.action : '';

      if (action === 'list') {
        const templates = deps.listRunnableTemplates();
        const summary =
          templates.length === 0
            ? '当前没有可执行的用户工作流模板（模板需为每个步骤显式声明 tool）'
            : templates
                .map(
                  (t) =>
                    `${t.id} — ${t.name}（${t.steps
                      .map((s) => `${s.id}→${s.tool}`)
                      .join(' → ')}）`
                )
                .join('\n');
        return {
          status: ToolExecutionStatus.SUCCESS,
          data: { success: true, templates },
          output: summary,
          errorOutput: '',
          executionTime: 0,
          executionId,
          toolName: WORKFLOW_TEMPLATE_TOOL_NAME,
          timestamp: Date.now(),
        };
      }

      if (action !== 'run') {
        return fail(`action 非法：${String(input.action)}（可选 list | run）`);
      }

      const templateId =
        typeof input.template === 'string' ? input.template.trim() : '';
      if (!templateId) return fail('action=run 时 template（模板 id）必填');

      // 动态目录校验：未知 / 结构不可执行 ⇒ 报错并**列出当前可用清单**（不猜、不降级）
      const available = deps.listRunnableTemplates();
      if (!available.some((t) => t.id === templateId)) {
        // 内建模板不在 store（只存在于 service 层静态常量）⇒ 本工具看不到它们；
        // 按前缀给出**准确原因**（"存在但为人工方法论清单"），而非笼统"不存在"。
        if (templateId.startsWith('builtin:')) {
          return fail(
            `模板 ${templateId} 是**内建**模板：属人工方法论清单（含 manual/review 步骤），` +
              '未声明 tool ⇒ 不可自动执行。请用 action="list" 选择用户自定义模板。'
          );
        }
        const hint =
          available.length === 0
            ? '（当前没有任何可执行模板）'
            : available.map((t) => t.id).join(', ');
        return fail(
          `模板 ${templateId} 不存在或不可执行（每个步骤都需显式声明 tool）。当前可用：${hint}`
        );
      }

      const params =
        input.params && typeof input.params === 'object'
          ? (input.params as Record<string, unknown>)
          : {};

      try {
        const { result, workflowRun } = await deps.runTemplate(
          templateId,
          params,
          context
        );

        if (result.stopReason !== 'completed') {
          const message =
            result.error ??
            `模板 ${templateId} 未完成（stopReason=${result.stopReason}）`;
          return fail(message, {
            workflowRun,
            completedSteps: result.completedSteps,
          });
        }

        return {
          status: ToolExecutionStatus.SUCCESS,
          data: {
            success: true,
            templateId,
            completedSteps: result.completedSteps,
            value: result.value,
          },
          output: `模板 ${templateId} 执行完成：${result.completedSteps.join(' → ') || '（无步骤）'}`,
          errorOutput: '',
          executionTime: 0,
          executionId,
          toolName: WORKFLOW_TEMPLATE_TOOL_NAME,
          timestamp: Date.now(),
          metadata: { workflowRun, completedSteps: result.completedSteps },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('工作流模板工具执行异常', { templateId, error: message });
        return fail(`模板 ${templateId} 执行异常：${message}`);
      }
    },

    getInfo() {
      return {
        name: WORKFLOW_TEMPLATE_TOOL_NAME,
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

/**
 * 注册本工具（**幂等**）。
 *
 * 生产接线点 = Phase 5 `domain:init`（与 `registerWorkflowTemplateProvider` 同批）。
 */
export function registerWorkflowTemplateTool(): boolean {
  if (getToolRegistry().getTool(WORKFLOW_TEMPLATE_TOOL_NAME)) {
    logger.info('工作流模板工具已注册，跳过', {
      tool: WORKFLOW_TEMPLATE_TOOL_NAME,
    });
    return false;
  }
  globalToolManager.registerTool(createWorkflowTemplateTool());
  logger.info('工作流模板工具已注册', { tool: WORKFLOW_TEMPLATE_TOOL_NAME });
  return true;
}
