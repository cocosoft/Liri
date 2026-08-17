/**
 * 文档+邮件编排引擎
 * 预定义工作流：send-report, reply-with-doc, meeting-to-all
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('doc:orchestration');

/** 工作流步骤 */
interface WorkflowStep {
  tool: string;
  description: string;
}

/** 工作流结果 */
interface WorkflowResult {
  success: boolean;
  completedSteps: string[];
  output?: string;
  error?: string;
}

/**
 * 文档编排器
 * 保留 v2.2 设计，重命名为 DocOrchestrator
 * 依赖 doc（核心）+ mail（可选），mail 未安装时跳过邮件步骤
 */
export class DocOrchestrator {
  /** D-1 修复：由 DocModule 注入的真实工具调用执行器（未注入时显式失败，不做假成功） */
  private toolExecutor:
    | ((tool: string, params: Record<string, unknown>) => Promise<unknown>)
    | null = null;

  /**
   * 注入工具执行器（DocModule 初始化时调用）
   */
  setToolExecutor(
    executor: (
      tool: string,
      params: Record<string, unknown>
    ) => Promise<unknown>
  ): void {
    this.toolExecutor = executor;
  }

  /** 预定义编排模板 */
  static readonly workflows: Record<string, WorkflowStep[]> = {
    'send-report': [
      { tool: 'doc:create-docx', description: '创建文档' },
      {
        tool: 'mail:send',
        description: '发送邮件（自动附加上一步创建的文档）',
      },
    ],
    'reply-with-doc': [
      { tool: 'mail:search', description: '查找邮件' },
      { tool: 'doc:command', description: '根据邮件内容创建/修改文档' },
      { tool: 'mail:send', description: '回复邮件（自动附加文档）' },
    ],
    'meeting-to-all': [
      { tool: 'calendar:list', description: '获取会议列表及参会人信息' },
      {
        tool: 'doc:create-docx',
        description: '根据会议纪要模板生成文档',
      },
      {
        tool: 'mail:send',
        description: '群发邮件并附上生成的文档给参会人',
      },
    ],
  };

  /**
   * 执行编排模板
   * 中间结果自动在步骤间传递：
   * - doc:create-docx 成功后，其 data.filePath 自动注入后续 mail:send 的 attachments
   * - 前一步返回的 output 作为 lastOutput 合并到下一步参数
   * D-1 修复：未注入执行器时返回失败而非"假成功"；步骤失败即终止
   */
  async execute(
    workflowName: string,
    params: Record<string, unknown>
  ): Promise<WorkflowResult> {
    const startedAt = Date.now();
    const steps = DocOrchestrator.workflows[workflowName];
    if (!steps) {
      logger.warn('编排工作流不存在，拒绝执行', {
        workflow: workflowName,
        available: DocOrchestrator.getAvailableWorkflows(),
      });
      return {
        success: false,
        completedSteps: [],
        error: `未知工作流: ${workflowName}`,
      };
    }
    if (!this.toolExecutor) {
      logger.warn('编排器未注入工具执行器，拒绝执行', {
        workflow: workflowName,
        steps: steps.map((s) => s.tool),
      });
      return {
        success: false,
        completedSteps: [],
        error: 'DocOrchestrator 未注入工具执行器，无法执行编排',
      };
    }

    logger.info('编排工作流开始', {
      workflow: workflowName,
      stepCount: steps.length,
      steps: steps.map((s) => s.tool),
      paramsKeys: Object.keys(params),
    });

    const completedSteps: string[] = [];
    let output: string | undefined;
    /** 步骤间传递的累积参数（含前一步生成的附件路径） */
    const accumulatedParams: Record<string, unknown> = { ...params };

    for (const step of steps) {
      const stepStartedAt = Date.now();
      logger.debug('执行工作流步骤', {
        workflow: workflowName,
        tool: step.tool,
        description: step.description,
        stepIndex: completedSteps.length + 1,
      });
      try {
        const stepResult = await this.toolExecutor(
          step.tool,
          accumulatedParams
        );
        const stepElapsed = Date.now() - stepStartedAt;

        // 工具返回失败状态（未抛异常）时终止
        if (
          typeof stepResult === 'object' &&
          stepResult !== null &&
          (stepResult as { status?: string; success?: boolean }).status ===
            'failure'
        ) {
          const errMsg = (stepResult as { error?: string }).error ?? '未知错误';
          logger.warn('编排步骤失败（工具返回失败状态）', {
            workflow: workflowName,
            tool: step.tool,
            error: errMsg,
            completedSteps,
            stepElapsedMs: stepElapsed,
            paramsSnapshot: JSON.stringify(accumulatedParams),
          });
          return {
            success: false,
            completedSteps,
            error: `步骤 ${step.tool} 失败: ${errMsg}`,
          };
        }

        if (typeof stepResult === 'string') {
          output = stepResult;
        } else if (typeof stepResult === 'object' && stepResult !== null) {
          // 提取输出文本
          const strOut = (stepResult as { output?: string }).output;
          if (typeof strOut === 'string') {
            output = strOut;
          }
          // doc:create-docx → 提取生成的文件路径，注入后续 mail:send 附件
          if (step.tool === 'doc:create-docx') {
            const data = (stepResult as { data?: { filePath?: string } }).data;
            if (data?.filePath) {
              const existing = accumulatedParams.attachments;
              const existingPaths = Array.isArray(existing)
                ? (existing as string[])
                : typeof existing === 'string'
                  ? (existing as string).split(',').map((s) => s.trim())
                  : [];
              accumulatedParams.attachments = [...existingPaths, data.filePath];
              logger.info('编排步骤产出附件，注入后续步骤', {
                workflow: workflowName,
                tool: step.tool,
                filePath: data.filePath,
                attachments: accumulatedParams.attachments,
              });
            } else {
              logger.warn(
                '编排步骤 doc:create-docx 未返回 filePath，无法注入附件',
                {
                  workflow: workflowName,
                  tool: step.tool,
                  resultKeys: Object.keys(stepResult as object),
                }
              );
            }
          }
        }

        completedSteps.push(step.tool);
        logger.info('编排步骤完成', {
          workflow: workflowName,
          tool: step.tool,
          stepElapsedMs: stepElapsed,
          outputPreview:
            typeof output === 'string'
              ? output.slice(0, 200)
              : String(output ?? ''),
        });
      } catch (error) {
        const stepElapsed = Date.now() - stepStartedAt;
        logger.warn('编排步骤执行抛错', {
          workflow: workflowName,
          tool: step.tool,
          error: String(error),
          stack: error instanceof Error ? error.stack : undefined,
          completedSteps,
          stepElapsedMs: stepElapsed,
          paramsSnapshot: JSON.stringify(accumulatedParams),
        });
        return {
          success: false,
          completedSteps,
          error: `步骤 ${step.tool} 失败: ${String(error)}`,
        };
      }
    }

    logger.info('编排工作流完成', {
      workflow: workflowName,
      completedSteps,
      totalElapsedMs: Date.now() - startedAt,
      outputPreview:
        typeof output === 'string'
          ? output.slice(0, 200)
          : String(output ?? ''),
    });

    return {
      success: true,
      completedSteps,
      output,
    };
  }

  /**
   * 获取可用工作流列表
   */
  static getAvailableWorkflows(): string[] {
    return Object.keys(DocOrchestrator.workflows);
  }
}
