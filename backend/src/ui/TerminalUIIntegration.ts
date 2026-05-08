//
/**
 * 终端UI集成模块
 * 将TerminalComponents与现有系统集成，提供统一的终端交互界面
 */

import { TerminalComponents } from '../ui/TerminalComponents.js';
import { logger } from '../utils/log.js';
import { StartupProfiler } from '../utils/startupProfiler.js';

/**
 * 终端集成器配置
 */
export interface TerminalIntegrationConfig {
  enableStartupProfiler?: boolean;
  defaultTheme?: 'light' | 'dark';
  maxHistoryLines?: number;
}

/**
 * 终端会话状态
 */
export interface TerminalSession {
  id: string;
  type: 'local' | 'ssh' | 'direct_connect';
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  startTime: number;
  lastActiveTime: number;
  config: any;
}

/**
 * 终端UI集成器
 */
export class TerminalUIIntegration {
  private config: TerminalIntegrationConfig;
  private sessions: Map<string, TerminalSession> = new Map();
  private profiler: StartupProfiler | null = null;
  private static instance: TerminalUIIntegration;

  constructor(config?: TerminalIntegrationConfig) {
    this.config = {
      enableStartupProfiler: true,
      defaultTheme: 'dark',
      maxHistoryLines: 1000,
      ...config,
    };

    this.initialize();
  }

  /**
   * 获取单例实例
   */
  static getInstance(
    config?: TerminalIntegrationConfig
  ): TerminalUIIntegration {
    if (!TerminalUIIntegration.instance) {
      TerminalUIIntegration.instance = new TerminalUIIntegration(config);
    }
    return TerminalUIIntegration.instance;
  }

  /**
   * 初始化
   */
  private initialize(): void {
    logger.info('Initializing Terminal UI Integration');

    if (this.config.enableStartupProfiler) {
      this.profiler = new StartupProfiler();
      this.profiler.start();
    }
  }

  /**
   * 显示欢迎界面
   */
  showWelcomeScreen(): void {
    TerminalComponents.printHeader();
    TerminalComponents.printBox('欢迎使用PY_APP', {
      padding: 2,
    });
    TerminalComponents.printInfo('系统已就绪，输入help查看可用命令');
    TerminalComponents.printDivider();
  }

  /**
   * 显示启动性能报告
   */
  showStartupReport(): void {
    if (this.profiler) {
      this.profiler.stop();
      const report = this.profiler.generateReport();

      TerminalComponents.printHeader('启动性能报告');
      TerminalComponents.printKeyValue([
        ['总耗时', `${report.totalDuration.toFixed(2)}ms`],
        ['检查点数量', report.checkpoints.length.toString()],
      ]);

      const steps = report.checkpoints.map((cp) => ({
        title: cp.name,
        description: `${cp.duration.toFixed(2)}ms`,
        status: 'completed' as const,
      }));

      TerminalComponents.printSteps(steps);
    }
  }

  /**
   * 创建新的终端会话
   */
  createSession(
    id: string,
    type: TerminalSession['type'],
    config: any
  ): TerminalSession {
    const session: TerminalSession = {
      id,
      type,
      status: 'connecting',
      startTime: Date.now(),
      lastActiveTime: Date.now(),
      config,
    };

    this.sessions.set(id, session);

    logger.info(`Created terminal session: ${id} (${type})`);

    return session;
  }

  /**
   * 更新会话状态
   */
  updateSessionStatus(
    id: string,
    status: TerminalSession['status'],
    error?: string
  ): void {
    const session = this.sessions.get(id);
    if (session) {
      session.status = status;
      session.lastActiveTime = Date.now();

      if (status === 'connected') {
        TerminalComponents.printSuccess(`会话 ${id} 已连接`);
      } else if (status === 'error') {
        TerminalComponents.printError(`会话 ${id} 连接失败: ${error}`);
      }
    }
  }

  /**
   * 获取所有会话
   */
  getAllSessions(): TerminalSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 显示会话列表
   */
  showSessionList(): void {
    const sessions = this.getAllSessions();

    if (sessions.length === 0) {
      TerminalComponents.printInfo('当前没有活动的会话');
      return;
    }

    TerminalComponents.printHeader('会话列表');

    const tableData = sessions.map((session) => {
      const statusBadge = TerminalComponents.getBadgeText(
        session.status,
        session.status === 'connected'
          ? 'green'
          : session.status === 'error'
            ? 'red'
            : 'yellow'
      );

      const typeBadge = TerminalComponents.getBadgeText(session.type, 'blue');

      const duration = Math.floor((Date.now() - session.startTime) / 1000);
      const durationText = `${duration}s`;

      return [session.id, typeBadge, statusBadge, durationText];
    });

    TerminalComponents.printTable(
      ['ID', '类型', '状态', '运行时间'],
      tableData
    );
  }

  /**
   * 关闭会话
   */
  closeSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (session) {
      this.sessions.delete(id);
      TerminalComponents.printInfo(`会话 ${id} 已关闭`);
      return true;
    }
    return false;
  }

  /**
   * 显示命令执行结果
   */
  showCommandResult(
    command: string,
    success: boolean,
    output?: string,
    error?: string
  ): void {
    TerminalComponents.printDivider();
    TerminalComponents.printBox(`执行命令: ${command}`, {
      borderColor: success ? 'green' : 'red',
    });

    if (output) {
      console.log(output);
    }

    if (error) {
      TerminalComponents.printError(error);
    }

    if (success && !output && !error) {
      TerminalComponents.printSuccess('命令执行成功');
    }
  }

  /**
   * 显示帮助信息
   */
  showHelp(): void {
    TerminalComponents.printHeader('帮助信息');

    const commands = [
      { key: 'help', desc: '显示此帮助信息' },
      { key: 'sessions', desc: '显示所有会话列表' },
      { key: 'connect ssh <host>', desc: '连接SSH会话' },
      { key: 'connect direct <url>', desc: '连接直接连接会话' },
      { key: 'close <id>', desc: '关闭指定会话' },
      { key: 'status', desc: '显示系统状态' },
      { key: 'report', desc: '显示启动性能报告' },
      { key: 'clear', desc: '清除屏幕' },
      { key: 'exit', desc: '退出程序' },
    ];

    TerminalComponents.printList(
      commands.map((c) => `${c.key} - ${c.desc}`),
      { bullet: '►' }
    );
  }

  /**
   * 显示系统状态
   */
  showSystemStatus(): void {
    TerminalComponents.printHeader('系统状态');

    const now = Date.now();
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();

    TerminalComponents.printKeyValue([
      ['运行时间', `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`],
      ['内存使用', `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`],
      ['活跃会话', this.sessions.size.toString()],
      ['Node.js版本', process.version],
    ]);
  }

  /**
   * 清除屏幕
   */
  clearScreen(): void {
    TerminalComponents.clearScreen();
  }

  /**
   * 获取TerminalComponents实例
   */
  getComponents(): typeof TerminalComponents {
    return TerminalComponents;
  }
}

/**
 * 创建终端UI集成器
 */
export function createTerminalUIIntegration(
  config?: TerminalIntegrationConfig
): TerminalUIIntegration {
  return TerminalUIIntegration.getInstance(config);
}
