/**
 * 进程外子agent
 */
import {
  SubAgent,
  SubAgentConfig,
  SubAgentStatus,
  SubAgentType,
  SubAgentTask,
  SubAgentResult,
  ProcessSubAgentConfig,
} from './SubAgent';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { resolveProjectRoot } from '@modules/config/paths';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 进程外子agent
 */
export class ProcessSubAgent implements SubAgent {
  id: string;
  name: string;
  type: SubAgentType;
  status: SubAgentStatus;
  config: ProcessSubAgentConfig;
  metadata: any;

  private process: ChildProcess | null = null;
  private messageQueue: any[] = [];

  /**
   * 构造函数
   * @param config 进程外子agent配置
   */
  constructor(config: ProcessSubAgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.type = SubAgentType.PROCESS;
    this.status = SubAgentStatus.CREATED;
    this.config = config;
    this.metadata = {};
  }

  /**
   * 启动子agent
   */
  async start(): Promise<void> {
    if (this.status === SubAgentStatus.RUNNING) {
      return;
    }

    try {
      // 准备启动参数
      const executable = this.config.executable || process.execPath;
      const args = this.config.args || [
        join(
          resolveProjectRoot(),
          'app',
          'src',
          'subagent',
          'types',
          'process-subagent.js'
        ),
      ];
      const cwd = this.config.cwd || process.cwd();
      const env = {
        ...process.env,
        SUBAGENT_ID: this.id,
        SUBAGENT_NAME: this.name,
        ...this.config.env,
      };

      // 启动子进程
      this.process = spawn(executable, args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });

      // 监听进程事件
      this.process.on('exit', (code, signal) => {
        logger.info(
          `ProcessSubAgent ${this.id} exited with code ${code}, signal ${signal}`
        );
        this.status = SubAgentStatus.TERMINATED;
      });

      this.process.on('error', (error) => {
        logger.error(`ProcessSubAgent ${this.id} error:`, { error });
        this.status = SubAgentStatus.ERROR;
      });

      this.process.stdout?.on('data', (data) => {
        logger.info(`ProcessSubAgent ${this.id} stdout:`, {
          data: data.toString(),
        });
      });

      this.process.stderr?.on('data', (data) => {
        logger.error(`ProcessSubAgent ${this.id} stderr:`, {
          data: data.toString(),
        });
      });

      // 初始化子agent
      this.metadata = {
        startedAt: Date.now(),
        processId: this.process.pid,
        executable,
        args,
        cwd,
      };

      this.status = SubAgentStatus.RUNNING;
      logger.info(
        `ProcessSubAgent ${this.id} started with PID ${this.process.pid}`
      );
    } catch (error) {
      this.status = SubAgentStatus.ERROR;
      logger.error(`Error starting ProcessSubAgent ${this.id}:`, { error });
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
      if (this.process) {
        // 发送终止信号
        this.process.kill();
        this.process = null;
      }

      // 清理资源
      this.messageQueue = [];

      this.status = SubAgentStatus.TERMINATED;
      logger.info(`ProcessSubAgent ${this.id} stopped`);
    } catch (error) {
      logger.error(`Error stopping ProcessSubAgent ${this.id}:`, { error });
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
      if (this.process) {
        // 发送暂停信号
        this.process.kill('SIGSTOP');
      }

      this.status = SubAgentStatus.PAUSED;
      logger.info(`ProcessSubAgent ${this.id} paused`);
    } catch (error) {
      logger.error(`Error pausing ProcessSubAgent ${this.id}:`, { error });
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
      if (this.process) {
        // 发送恢复信号
        this.process.kill('SIGCONT');
      }

      this.status = SubAgentStatus.RUNNING;
      logger.info(`ProcessSubAgent ${this.id} resumed`);
    } catch (error) {
      logger.error(`Error resuming ProcessSubAgent ${this.id}:`, { error });
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
      logger.info(`Executing task ${task.id} in ProcessSubAgent ${this.id}:`, {
        task,
      });

      // 发送任务到子进程
      if (this.process && this.process.connected) {
        this.process.send({ type: 'task', task });
      }

      // 模拟任务执行
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const result: SubAgentResult = {
        id: `result_${Date.now()}`,
        taskId: task.id,
        status: 'success',
        content: `Task ${task.id} executed successfully in ProcessSubAgent ${this.id}`,
        metadata: {
          executionTime: 1000,
          processId: this.process?.pid,
        },
      };

      logger.info(
        `Task ${task.id} executed successfully in ProcessSubAgent ${this.id}`
      );
      return result;
    } catch (error) {
      logger.error(
        `Error executing task ${task.id} in ProcessSubAgent ${this.id}:`,
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
      processId: this.process?.pid,
    };
  }

  /**
   * 更新配置
   * @param config 配置
   */
  async updateConfig(config: Partial<ProcessSubAgentConfig>): Promise<void> {
    try {
      this.config = {
        ...this.config,
        ...config,
      };
      logger.info(`Updated config for ProcessSubAgent ${this.id}:`, { config });

      // 发送配置更新到子进程
      if (this.process && this.process.connected) {
        this.process.send({ type: 'config', config });
      }
    } catch (error) {
      logger.error(`Error updating config for ProcessSubAgent ${this.id}:`, {
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

      // 发送消息到子进程
      if (this.process && this.process.connected) {
        this.process.send({ type: 'message', message });
      }

      logger.info(`Message sent to ProcessSubAgent ${this.id}:`, { message });
    } catch (error) {
      logger.error(`Error sending message to ProcessSubAgent ${this.id}:`, {
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
      logger.info(`Message received from ProcessSubAgent ${this.id}:`, {
        message,
      });
      return message;
    } catch (error) {
      logger.error(`Error receiving message from ProcessSubAgent ${this.id}:`, {
        error,
      });
      throw error;
    }
  }
}
