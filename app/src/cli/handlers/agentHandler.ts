/**
 * Agent处理器
 * 处理CLI中的Agent相关命令
 */

import chalk from 'chalk';
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ErrorCodes } from '@modules/error';

const logger = getLogger('agentHandler');

export interface AgentHandlerOptions {
  verbose?: boolean;
}

export interface AgentInfo {
  name: string;
  type: string;
  status: 'running' | 'stopped' | 'error';
  model?: string;
  tasks?: number;
}

export class AgentHandler {
  private options: AgentHandlerOptions;
  private agents: AgentInfo[] = [];

  constructor(options?: AgentHandlerOptions) {
    this.options = { verbose: false, ...options };
  }

  /**
   * 处理列表命令
   */
  async handleList(): Promise<void> {
    if (this.options.verbose) {
      logger.info('Fetching agents...');
    }

    try {
      await this.fetchAgents();

      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold('  Agents'));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log();

      if (this.agents.length === 0) {
        console.log(chalk.yellow('⚠'), 'No agents configured');
      } else {
        this.agents.forEach((agent, index) => {
          const statusIcon = this.getStatusIcon(agent.status);
          console.log(
            chalk.green(`${String(index + 1).padStart(2)}.`),
            agent.name
          );
          console.log(`   ${chalk.gray('Type:')} ${agent.type}`);
          console.log(
            `   ${chalk.gray('Status:')} ${statusIcon} ${agent.status}`
          );
          if (agent.model) {
            console.log(`   ${chalk.gray('Model:')} ${agent.model}`);
          }
          if (agent.tasks !== undefined) {
            console.log(`   ${chalk.gray('Active tasks:')} ${agent.tasks}`);
          }
          console.log();
        });
      }

      console.log(chalk.cyan('═'.repeat(60)));
    } catch (error) {
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: { handler: 'AgentHandler', operation: 'handleList' },
      });
    }
  }

  /**
   * 处理启动命令
   */
  async handleStart(args: string[]): Promise<void> {
    const agentName = args[0];

    if (!agentName) {
      throw AppError.fromCode(ErrorCodes.INVALID_INPUT, {
        category: ErrorCategory.VALIDATION,
        context: { handler: 'AgentHandler', operation: 'handleStart' },
      });
    }

    if (this.options.verbose) {
      logger.info(`Starting agent: ${agentName}`);
    }

    try {
      const agent = this.agents.find((a) => a.name === agentName);
      if (!agent) {
        throw new AppError(
          `Agent not found: ${agentName}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1005'
        );
      }

      agent.status = 'running';
      await this.startAgentProcess(agent);

      console.log(chalk.green('✓'), `Agent ${agentName} started`);
    } catch (error) {
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: {
          handler: 'AgentHandler',
          operation: 'handleStart',
          agentName,
        },
      });
    }
  }

  /**
   * 处理停止命令
   */
  async handleStop(args: string[]): Promise<void> {
    const agentName = args[0];

    if (!agentName) {
      throw AppError.fromCode(ErrorCodes.INVALID_INPUT, {
        category: ErrorCategory.VALIDATION,
        context: { handler: 'AgentHandler', operation: 'handleStop' },
      });
    }

    if (this.options.verbose) {
      logger.info(`Stopping agent: ${agentName}`);
    }

    try {
      const agent = this.agents.find((a) => a.name === agentName);
      if (!agent) {
        throw new AppError(
          `Agent not found: ${agentName}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1005'
        );
      }

      await this.stopAgentProcess(agent);
      agent.status = 'stopped';

      console.log(chalk.green('✓'), `Agent ${agentName} stopped`);
    } catch (error) {
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: {
          handler: 'AgentHandler',
          operation: 'handleStop',
          agentName,
        },
      });
    }
  }

  /**
   * 处理重启命令
   */
  async handleRestart(args: string[]): Promise<void> {
    const agentName = args[0];

    if (!agentName) {
      throw AppError.fromCode(ErrorCodes.INVALID_INPUT, {
        category: ErrorCategory.VALIDATION,
        context: { handler: 'AgentHandler', operation: 'handleRestart' },
      });
    }

    if (this.options.verbose) {
      logger.info(`Restarting agent: ${agentName}`);
    }

    try {
      await this.handleStop([agentName]);
      await this.handleStart([agentName]);
      console.log(chalk.green('✓'), `Agent ${agentName} restarted`);
    } catch (error) {
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: {
          handler: 'AgentHandler',
          operation: 'handleRestart',
          agentName,
        },
      });
    }
  }

  /**
   * 创建新Agent
   */
  async handleCreate(args: string[]): Promise<void> {
    const agentName = args[0];
    const agentType = args[1] || 'default';

    if (!agentName) {
      throw AppError.fromCode(ErrorCodes.INVALID_INPUT, {
        category: ErrorCategory.VALIDATION,
        context: { handler: 'AgentHandler', operation: 'handleCreate' },
      });
    }

    if (this.options.verbose) {
      logger.info(`Creating agent: ${agentName}`);
    }

    try {
      const newAgent: AgentInfo = {
        name: agentName,
        type: agentType,
        status: 'stopped',
        model: '', // 空 = 走模型体系 fallback（resolveModelRoute），不硬编码默认模型
        tasks: 0,
      };

      await this.createAgentProcess(newAgent);
      this.agents.push(newAgent);

      console.log(chalk.green('✓'), `Agent ${agentName} created`);
    } catch (error) {
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: {
          handler: 'AgentHandler',
          operation: 'handleCreate',
          agentName,
        },
      });
    }
  }

  /**
   * 获取状态图标
   */
  private getStatusIcon(status: string): string {
    switch (status) {
      case 'running':
        return chalk.green('●');
      case 'stopped':
        return chalk.gray('○');
      case 'error':
        return chalk.red('●');
      default:
        return chalk.gray('○');
    }
  }

  /**
   * 获取Agent列表
   */
  private async fetchAgents(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    // CS04: 无 agent 时保持为空，不注入假数据
  }

  /**
   * 启动Agent进程
   */
  private async startAgentProcess(agent: AgentInfo): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  /**
   * 停止Agent进程
   */
  private async stopAgentProcess(agent: AgentInfo): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  /**
   * 创建Agent进程
   */
  private async createAgentProcess(agent: AgentInfo): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

/**
 * 创建Agent处理器
 */
export function createAgentHandler(
  options?: AgentHandlerOptions
): AgentHandler {
  return new AgentHandler(options);
}
