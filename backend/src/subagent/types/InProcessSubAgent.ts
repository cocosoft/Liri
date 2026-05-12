/**
 * 进程内子agent
 */
import {
  SubAgent,
  SubAgentConfig,
  SubAgentStatus,
  SubAgentType,
  SubAgentTask,
  SubAgentResult,
  InProcessSubAgentConfig,
} from './SubAgent';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 进程内子agent
 */
export class InProcessSubAgent implements SubAgent {
  id: string;
  name: string;
  type: SubAgentType;
  status: SubAgentStatus;
  config: InProcessSubAgentConfig;
  metadata: any;

  private messageQueue: any[] = [];
  private context: any;

  /**
   * 构造函数
   * @param config 进程内子agent配置
   */
  constructor(config: InProcessSubAgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.type = SubAgentType.IN_PROCESS;
    this.status = SubAgentStatus.CREATED;
    this.config = config;
    this.metadata = {};
    this.context = config.context || {};
  }

  /**
   * 启动子agent
   */
  async start(): Promise<void> {
    if (this.status === SubAgentStatus.RUNNING) {
      return;
    }

    try {
      // 初始化子agent
      this.metadata = {
        startedAt: Date.now(),
        memoryUsage: process.memoryUsage(),
      };

      this.status = SubAgentStatus.RUNNING;
      logger.info(`InProcessSubAgent ${this.id} started`);
    } catch (error) {
      this.status = SubAgentStatus.ERROR;
      logger.error(`Error starting InProcessSubAgent ${this.id}:`, { error });
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
      // 清理资源
      this.messageQueue = [];
      this.context = {};

      this.status = SubAgentStatus.TERMINATED;
      logger.info(`InProcessSubAgent ${this.id} stopped`);
    } catch (error) {
      logger.error(`Error stopping InProcessSubAgent ${this.id}:`, { error });
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
      this.status = SubAgentStatus.PAUSED;
      logger.info(`InProcessSubAgent ${this.id} paused`);
    } catch (error) {
      logger.error(`Error pausing InProcessSubAgent ${this.id}:`, { error });
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
      this.status = SubAgentStatus.RUNNING;
      logger.info(`InProcessSubAgent ${this.id} resumed`);
    } catch (error) {
      logger.error(`Error resuming InProcessSubAgent ${this.id}:`, { error });
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
      throw new AppError(`SubAgent ${this.id} is not running`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    try {
      logger.info(
        `Executing task ${task.id} in InProcessSubAgent ${this.id}:`,
        { task }
      );

      // 模拟任务执行
      await new Promise((resolve) => setTimeout(resolve, 500));

      const result: SubAgentResult = {
        id: `result_${Date.now()}`,
        taskId: task.id,
        status: 'success',
        content: `Task ${task.id} executed successfully in InProcessSubAgent ${this.id}`,
        metadata: {
          executionTime: 500,
          memoryUsage: process.memoryUsage(),
        },
      };

      logger.info(
        `Task ${task.id} executed successfully in InProcessSubAgent ${this.id}`
      );
      return result;
    } catch (error) {
      logger.error(
        `Error executing task ${task.id} in InProcessSubAgent ${this.id}:`,
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
  async updateConfig(config: Partial<InProcessSubAgentConfig>): Promise<void> {
    try {
      this.config = {
        ...this.config,
        ...config,
      };
      logger.info(`Updated config for InProcessSubAgent ${this.id}:`, {
        config,
      });
    } catch (error) {
      logger.error(`Error updating config for InProcessSubAgent ${this.id}:`, {
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
      logger.info(`Message sent to InProcessSubAgent ${this.id}:`, { message });
    } catch (error) {
      logger.error(`Error sending message to InProcessSubAgent ${this.id}:`, {
        error,
      });
      throw error;
    }
  }

  /**
   * 接收消息
   * @returns 消息
   */
  async receiveMessage(): Promise<any> {
    try {
      if (this.messageQueue.length === 0) {
        return null;
      }

      const message = this.messageQueue.shift();
      logger.info(`Message received from InProcessSubAgent ${this.id}:`, {
        message,
      });
      return message;
    } catch (error) {
      logger.error(
        `Error receiving message from InProcessSubAgent ${this.id}:`,
        { error }
      );
      throw error;
    }
  }

  /**
   * 获取上下文
   * @returns 上下文
   */
  getContext(): any {
    return this.context;
  }

  /**
   * 设置上下文
   * @param context 上下文
   */
  setContext(context: any): void {
    this.context = context;
  }
}
