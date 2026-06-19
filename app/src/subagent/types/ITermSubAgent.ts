/**
 * iTerm子agent
 */
import {
  SubAgent,
  SubAgentConfig,
  SubAgentStatus,
  SubAgentType,
  SubAgentTask,
  SubAgentResult,
  ITermSubAgentConfig,
} from './SubAgent';
import { Logger, LogLevel } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * iTerm子agent
 */
export class ITermSubAgent implements SubAgent {
  id: string;
  name: string;
  type: SubAgentType;
  status: SubAgentStatus;
  config: ITermSubAgentConfig;
  metadata: any;

  private windowId: string;
  private tabId: string;
  private paneId: string;
  private messageQueue: any[] = [];

  /**
   * 构造函数
   * @param config iTerm子agent配置
   */
  constructor(config: ITermSubAgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.type = SubAgentType.ITERM;
    this.status = SubAgentStatus.CREATED;
    this.config = config;
    this.metadata = {};

    this.windowId = config.windowId || `window_${this.id}`;
    this.tabId = config.tabId || `tab_${this.id}`;
    this.paneId = config.paneId || `pane_${this.id}`;
  }

  /**
   * 启动子agent
   */
  async start(): Promise<void> {
    if (this.status === SubAgentStatus.RUNNING) {
      return;
    }

    try {
      // 检查iTerm是否安装
      // 注意：在Windows系统上，iTerm可能不可用
      // 这里只是模拟iTerm子agent的启动
      logger.info(`Starting ITermSubAgent ${this.id}`);

      // 初始化子agent
      this.metadata = {
        startedAt: Date.now(),
        windowId: this.windowId,
        tabId: this.tabId,
        paneId: this.paneId,
      };

      this.status = SubAgentStatus.RUNNING;
      logger.info(`ITermSubAgent ${this.id} started`);
    } catch (error) {
      this.status = SubAgentStatus.ERROR;
      logger.error(`Error starting ITermSubAgent ${this.id}:`, { error });
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

      this.status = SubAgentStatus.TERMINATED;
      logger.info(`ITermSubAgent ${this.id} stopped`);
    } catch (error) {
      logger.error(`Error stopping ITermSubAgent ${this.id}:`, { error });
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
      logger.info(`ITermSubAgent ${this.id} paused`);
    } catch (error) {
      logger.error(`Error pausing ITermSubAgent ${this.id}:`, { error });
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
      logger.info(`ITermSubAgent ${this.id} resumed`);
    } catch (error) {
      logger.error(`Error resuming ITermSubAgent ${this.id}:`, { error });
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
      logger.info(`Executing task ${task.id} in ITermSubAgent ${this.id}:`, {
        task,
      });

      // 模拟任务执行
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const result: SubAgentResult = {
        id: `result_${Date.now()}`,
        taskId: task.id,
        status: 'success',
        content: `Task ${task.id} executed successfully in ITermSubAgent ${this.id}`,
        metadata: {
          executionTime: 1000,
          windowId: this.windowId,
          tabId: this.tabId,
          paneId: this.paneId,
        },
      };

      logger.info(
        `Task ${task.id} executed successfully in ITermSubAgent ${this.id}`
      );
      return result;
    } catch (error) {
      logger.error(
        `Error executing task ${task.id} in ITermSubAgent ${this.id}:`,
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
  async updateConfig(config: Partial<ITermSubAgentConfig>): Promise<void> {
    try {
      this.config = {
        ...this.config,
        ...config,
      };

      // 更新窗口、标签和面板ID
      if (config.windowId) {
        this.windowId = config.windowId;
      }
      if (config.tabId) {
        this.tabId = config.tabId;
      }
      if (config.paneId) {
        this.paneId = config.paneId;
      }

      logger.info(`Updated config for ITermSubAgent ${this.id}:`, { config });
    } catch (error) {
      logger.error(`Error updating config for ITermSubAgent ${this.id}:`, {
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
      logger.info(`Message sent to ITermSubAgent ${this.id}:`, { message });
    } catch (error) {
      logger.error(`Error sending message to ITermSubAgent ${this.id}:`, {
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
      logger.info(`Message received from ITermSubAgent ${this.id}:`, {
        message,
      });
      return message;
    } catch (error) {
      logger.error(`Error receiving message from ITermSubAgent ${this.id}:`, {
        error,
      });
      throw error;
    }
  }
}
