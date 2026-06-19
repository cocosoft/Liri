/**
 * Tmux子agent
 */
import {
  SubAgent,
  SubAgentConfig,
  SubAgentStatus,
  SubAgentType,
  SubAgentTask,
  SubAgentResult,
  TmuxSubAgentConfig,
} from './SubAgent';
import { execSync, exec } from 'child_process';
import { Logger, LogLevel } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * Tmux子agent
 */
export class TmuxSubAgent implements SubAgent {
  id: string;
  name: string;
  type: SubAgentType;
  status: SubAgentStatus;
  config: TmuxSubAgentConfig;
  metadata: any;

  private sessionName: string;
  private windowName: string;
  private paneName: string;
  private messageQueue: any[] = [];

  /**
   * 构造函数
   * @param config Tmux子agent配置
   */
  constructor(config: TmuxSubAgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.type = SubAgentType.TMUX;
    this.status = SubAgentStatus.CREATED;
    this.config = config;
    this.metadata = {};

    this.sessionName = config.sessionName || `subagent_${this.id}`;
    this.windowName = config.windowName || 'main';
    this.paneName = config.paneName || 'default';
  }

  /**
   * 启动子agent
   */
  async start(): Promise<void> {
    if (this.status === SubAgentStatus.RUNNING) {
      return;
    }

    try {
      // 检查Tmux是否安装
      try {
        execSync('tmux --version');
      } catch (error) {
        throw new AppError(
          'Tmux is not installed',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      // 检查会话是否存在
      const sessionExists = this.checkSessionExists(this.sessionName);

      if (!sessionExists) {
        // 创建新会话
        execSync(
          `tmux new-session -d -s ${this.sessionName} -n ${this.windowName}`
        );
        logger.info(`Created Tmux session ${this.sessionName}`);
      }

      // 初始化子agent
      this.metadata = {
        startedAt: Date.now(),
        sessionName: this.sessionName,
        windowName: this.windowName,
        paneName: this.paneName,
      };

      this.status = SubAgentStatus.RUNNING;
      logger.info(
        `TmuxSubAgent ${this.id} started in session ${this.sessionName}`
      );
    } catch (error) {
      this.status = SubAgentStatus.ERROR;
      logger.error(`Error starting TmuxSubAgent ${this.id}:`, { error });
      throw error;
    }
  }

  /**
   * 停止子agent
   */
  async stop(): Promise<void> {
    if (this.status === SubAgentStatus.TERMINATED) {
      return;
    }

    try {
      // 检查会话是否存在
      const sessionExists = this.checkSessionExists(this.sessionName);

      if (sessionExists) {
        // 终止会话
        execSync(`tmux kill-session -t ${this.sessionName}`);
        logger.info(`Killed Tmux session ${this.sessionName}`);
      }

      // 清理资源
      this.messageQueue = [];

      this.status = SubAgentStatus.TERMINATED;
      logger.info(`TmuxSubAgent ${this.id} stopped`);
    } catch (error) {
      logger.error(`Error stopping TmuxSubAgent ${this.id}:`, { error });
      throw error;
    }
  }

  /**
   * 暂停子agent
   */
  async pause(): Promise<void> {
    if (this.status !== SubAgentStatus.RUNNING) {
      return;
    }

    try {
      // Tmux会话不能直接暂停，这里只是更新状态
      this.status = SubAgentStatus.PAUSED;
      logger.info(`TmuxSubAgent ${this.id} paused`);
    } catch (error) {
      logger.error(`Error pausing TmuxSubAgent ${this.id}:`, { error });
      throw error;
    }
  }

  /**
   * 恢复子agent
   */
  async resume(): Promise<void> {
    if (this.status !== SubAgentStatus.PAUSED) {
      return;
    }

    try {
      // 检查会话是否存在
      const sessionExists = this.checkSessionExists(this.sessionName);

      if (!sessionExists) {
        // 重新创建会话
        execSync(
          `tmux new-session -d -s ${this.sessionName} -n ${this.windowName}`
        );
        logger.info(`Recreated Tmux session ${this.sessionName}`);
      }

      this.status = SubAgentStatus.RUNNING;
      logger.info(`TmuxSubAgent ${this.id} resumed`);
    } catch (error) {
      logger.error(`Error resuming TmuxSubAgent ${this.id}:`, { error });
      throw error;
    }
  }

  /**
   * 执行任务
   * @param task 任务
   * @returns 执行结果
   */
  async execute(task: SubAgentTask): Promise<SubAgentResult> {
    if (this.status !== SubAgentStatus.RUNNING) {
      throw new AppError(
        `SubAgent ${this.id} is not running`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    try {
      logger.info(`Executing task ${task.id} in TmuxSubAgent ${this.id}:`, {
        task,
      });

      // 检查会话是否存在
      const sessionExists = this.checkSessionExists(this.sessionName);

      if (!sessionExists) {
        throw new AppError(
          `Tmux session ${this.sessionName} does not exist`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      // 在Tmux会话中执行命令
      const command = `echo "Executing task: ${task.content}"`;
      const output = execSync(
        `tmux send-keys -t ${this.sessionName}:${this.windowName} "${command}" Enter`
      );

      // 模拟任务执行
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const result: SubAgentResult = {
        id: `result_${Date.now()}`,
        taskId: task.id,
        status: 'success',
        content: `Task ${task.id} executed successfully in TmuxSubAgent ${this.id}`,
        metadata: {
          executionTime: 1000,
          sessionName: this.sessionName,
          windowName: this.windowName,
        },
      };

      logger.info(
        `Task ${task.id} executed successfully in TmuxSubAgent ${this.id}`
      );
      return result;
    } catch (error) {
      logger.error(
        `Error executing task ${task.id} in TmuxSubAgent ${this.id}:`,
        { error }
      );
      return {
        id: `result_${Date.now()}`,
        taskId: task.id,
        status: 'failure',
        content: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 获取状态
   * @returns 状态
   */
  getStatus(): SubAgentStatus {
    return this.status;
  }

  /**
   * 获取信息
   * @returns 信息
   */
  getInfo(): any {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      status: this.status,
      config: this.config,
      metadata: this.metadata,
      messageQueueLength: this.messageQueue.length,
    };
  }

  /**
   * 更新配置
   * @param config 配置
   */
  async updateConfig(config: Partial<TmuxSubAgentConfig>): Promise<void> {
    try {
      this.config = {
        ...this.config,
        ...config,
      };

      // 更新会话、窗口和面板名称
      if (config.sessionName) {
        this.sessionName = config.sessionName;
      }
      if (config.windowName) {
        this.windowName = config.windowName;
      }
      if (config.paneName) {
        this.paneName = config.paneName;
      }

      logger.info(`Updated config for TmuxSubAgent ${this.id}:`, { config });
    } catch (error) {
      logger.error(`Error updating config for TmuxSubAgent ${this.id}:`, {
        error,
      });
      throw error;
    }
  }

  /**
   * 发送消息
   * @param message 消息
   */
  async sendMessage(message: any): Promise<void> {
    try {
      this.messageQueue.push(message);

      // 在Tmux会话中显示消息
      const sessionExists = this.checkSessionExists(this.sessionName);
      if (sessionExists) {
        const command = `echo "Message: ${JSON.stringify(message)}"`;
        execSync(
          `tmux send-keys -t ${this.sessionName}:${this.windowName} "${command}" Enter`
        );
      }

      logger.info(`Message sent to TmuxSubAgent ${this.id}:`, { message });
    } catch (error) {
      logger.error(`Error sending message to TmuxSubAgent ${this.id}:`, {
        error,
      });
      throw error;
    }
  }

  /**
   * 接收消息
   * @returns 消息
   */
  async receiveMessage(): Promise<unknown> {
    try {
      if (this.messageQueue.length === 0) {
        return null;
      }

      const message = this.messageQueue.shift();
      logger.info(`Message received from TmuxSubAgent ${this.id}:`, {
        message,
      });
      return message;
    } catch (error) {
      logger.error(`Error receiving message from TmuxSubAgent ${this.id}:`, {
        error,
      });
      throw error;
    }
  }

  /**
   * 检查Tmux会话是否存在
   * @param sessionName 会话名称
   * @returns 是否存在
   */
  private checkSessionExists(sessionName: string): boolean {
    try {
      execSync(`tmux has-session -t ${sessionName}`);
      return true;
    } catch (error) {
      return false;
    }
  }
}
