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
      { tool: 'doc:command', description: '读取会议纪要' },
      { tool: 'mail:send', description: '群发邮件 + 附件' },
    ],
  };

  /**
   * 执行编排模板
   * 中间结果自动在步骤间传递
   */
  async execute(
    workflowName: string,
    params: Record<string, unknown>
  ): Promise<WorkflowResult> {
    const steps = DocOrchestrator.workflows[workflowName];
    if (!steps) {
      return {
        success: false,
        completedSteps: [],
        error: `未知工作流: ${workflowName}`,
      };
    }

    const completedSteps: string[] = [];
    let output: string | undefined;

    for (const step of steps) {
      try {
        logger.debug('执行工作流步骤', {
          workflow: workflowName,
          tool: step.tool,
        });
        // TODO: 实际工具调用由 DocModule 注入
        completedSteps.push(step.tool);
      } catch (error) {
        return {
          success: false,
          completedSteps,
          error: `步骤 ${step.tool} 失败: ${String(error)}`,
        };
      }
    }

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
