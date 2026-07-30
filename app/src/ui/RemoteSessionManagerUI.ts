/**
 * 远程会话管理界面
 * 提供会话管理、状态显示和历史记录功能
 */

import {
  TerminalComponents,
  TableColumn,
  TableRow,
} from '../ui/TerminalComponents.js';
import {
  TerminalUIIntegration,
  TerminalSession,
} from '../ui/TerminalUIIntegration.js';
import { RealtimeTerminalOutput } from '../ui/RealtimeTerminalOutput.js';
import { resolveSessionsDir } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ module: 'ui:remoteSession', level: LogLevel.INFO });

/**
 * 会话历史记录
 */
export interface SessionHistory {
  sessionId: string;
  type: 'ssh' | 'direct_connect';
  startTime: number;
  endTime: number;
  status: 'completed' | 'error' | 'interrupted';
  config: unknown;
  error?: string;
}

/**
 * 会话管理界面配置
 */
export interface SessionManagerConfig {
  maxHistoryEntries?: number;
  historyFilePath?: string;
  autoSaveHistory?: boolean;
}

/**
 * 远程会话管理界面
 */
export class RemoteSessionManagerUI {
  private terminalUI: TerminalUIIntegration;
  private terminalOutput: RealtimeTerminalOutput;
  private config: SessionManagerConfig;
  private history: SessionHistory[] = [];
  private selectedSessionId: string | null = null;

  constructor(
    terminalUI?: TerminalUIIntegration,
    terminalOutput?: RealtimeTerminalOutput,
    config?: SessionManagerConfig
  ) {
    this.terminalUI = terminalUI || TerminalUIIntegration.getInstance();
    this.terminalOutput = terminalOutput || new RealtimeTerminalOutput();
    this.config = {
      maxHistoryEntries: 100,
      autoSaveHistory: true,
      ...config,
    };

    this.initialize();
  }

  /**
   * 初始化
   */
  private initialize(): void {
    logger.info('Initializing Remote Session Manager UI');
    this.loadHistory();
  }

  /**
   * 显示主界面
   */
  showMainScreen(): void {
    TerminalComponents.clearScreen();
    TerminalComponents.printHeader('远程会话管理');

    const activeSessions = this.terminalUI.getAllSessions();
    const activeCount = activeSessions.filter(
      (s) => s.status === 'connected'
    ).length;

    const stats = [
      ['活跃会话', activeCount.toString()],
      ['历史记录', this.history.length.toString()],
    ];

    TerminalComponents.printKeyValue(stats as [string, string][]);
    TerminalComponents.printDivider();

    this.showActiveSessions();
    TerminalComponents.printDivider();

    TerminalComponents.printList(
      [
        '1. 连接新SSH会话',
        '2. 连接新直接连接会话',
        '3. 查看会话历史',
        '4. 查看会话详情',
        '5. 断开所有会话',
        '0. 返回',
      ],
      { bullet: '►' }
    );
  }

  /**
   * 显示活跃会话列表
   */
  showActiveSessions(): void {
    const sessions = this.terminalUI.getAllSessions();

    if (sessions.length === 0) {
      TerminalComponents.printInfo('当前没有活跃的会话');
      return;
    }

    TerminalComponents.printHeader('活跃会话');

    const rows = sessions.map((session, index) => {
      const statusColor =
        session.status === 'connected'
          ? 'green'
          : session.status === 'error'
            ? 'red'
            : 'yellow';
      const tc = TerminalComponents as unknown as {
        getBadgeText: (status: string, color: string) => string;
      };
      const statusBadge = tc.getBadgeText(session.status, statusColor);

      const typeColor = session.type === 'ssh' ? 'blue' : 'cyan';
      const typeBadge = tc.getBadgeText(session.type, typeColor) as string;

      const duration = Math.floor((Date.now() - session.startTime) / 1000);
      const durationText = `${Math.floor(duration / 60)}m ${duration % 60}s`;

      return [
        (index + 1).toString(),
        session.id,
        typeBadge,
        statusBadge,
        durationText,
        this.getSessionHost(session),
      ];
    });

    TerminalComponents.printTable(
      [
        '#',
        '会话ID',
        '类型',
        '状态',
        '运行时间',
        '目标',
      ] as unknown as TableColumn[],
      rows as unknown as TableRow[]
    );
  }

  /**
   * 获取会话目标主机
   */
  private getSessionHost(session: TerminalSession): string {
    const cfg = session.config as Record<string, unknown>;
    if (session.type === 'ssh' && cfg.host) {
      return `${cfg.username}@${cfg.host}`;
    } else if (session.type === 'direct_connect' && cfg.url) {
      return String(cfg.url);
    }
    return '-';
  }

  /**
   * 显示会话历史
   */
  showSessionHistory(): void {
    TerminalComponents.clearScreen();
    TerminalComponents.printHeader('会话历史');

    if (this.history.length === 0) {
      TerminalComponents.printInfo('暂无历史记录');
      return;
    }

    const rows = this.history
      .slice(-20)
      .reverse()
      .map((history, index) => {
        const statusColor =
          history.status === 'completed'
            ? 'green'
            : history.status === 'error'
              ? 'red'
              : 'yellow';
        const tc2 = TerminalComponents as unknown as {
          getBadgeText: (status: string, color: string) => string;
        };
        const statusBadge = tc2.getBadgeText(history.status, statusColor);

        const typeColor = history.type === 'ssh' ? 'blue' : 'cyan';
        const typeBadge = tc2.getBadgeText(history.type, typeColor) as string;

        const startTime = new Date(history.startTime).toLocaleString();
        const duration = Math.floor(
          (history.endTime - history.startTime) / 1000
        );
        const durationText = `${Math.floor(duration / 60)}m ${duration % 60}s`;

        return [
          (this.history.length - index).toString(),
          history.sessionId,
          typeBadge,
          statusBadge,
          startTime,
          durationText,
        ];
      });

    TerminalComponents.printTable(
      [
        '#',
        '会话ID',
        '类型',
        '状态',
        '开始时间',
        '运行时间',
      ] as unknown as TableColumn[],
      rows as unknown as TableRow[]
    );
  }

  /**
   * 显示会话详情
   */
  showSessionDetails(sessionId: string): void {
    const session = this.terminalUI
      .getAllSessions()
      .find((s) => s.id === sessionId);
    const historyEntry = this.history.find((h) => h.sessionId === sessionId);

    if (!session && !historyEntry) {
      TerminalComponents.printError(`未找到会话: ${sessionId}`);
      return;
    }

    TerminalComponents.clearScreen();
    TerminalComponents.printHeader(`会话详情 - ${sessionId}`);

    const details: Array<[string, string]> = [];

    if (session) {
      details.push(['状态', session.status]);
      details.push(['类型', session.type]);
      details.push([
        '运行时间',
        `${Math.floor((Date.now() - session.startTime) / 1000)}s`,
      ]);
      details.push(['开始时间', new Date(session.startTime).toLocaleString()]);

      if (session.config) {
        const cfg = session.config as Record<string, unknown>;
        if (session.type === 'ssh') {
          details.push(['主机', String(cfg.host || '-')]);
          details.push(['端口', String(cfg.port) || '22']);
          details.push(['用户名', String(cfg.username || '-')]);
        } else if (session.type === 'direct_connect') {
          details.push(['URL', String(cfg.url || '-')]);
        }
      }
    } else if (historyEntry) {
      details.push(['状态', historyEntry.status]);
      details.push(['类型', historyEntry.type]);
      details.push([
        '运行时间',
        `${Math.floor((historyEntry.endTime - historyEntry.startTime) / 1000)}s`,
      ]);
      details.push([
        '开始时间',
        new Date(historyEntry.startTime).toLocaleString(),
      ]);
      details.push([
        '结束时间',
        new Date(historyEntry.endTime).toLocaleString(),
      ]);

      if (historyEntry.error) {
        details.push(['错误信息', historyEntry.error]);
      }
    }

    TerminalComponents.printKeyValue(details);
  }

  /**
   * 添加会话到历史记录
   */
  addToHistory(
    sessionId: string,
    type: SessionHistory['type'],
    status: SessionHistory['status'],
    config: unknown,
    error?: string
  ): void {
    const historyEntry: SessionHistory = {
      sessionId,
      type,
      startTime: Date.now(),
      endTime: Date.now(),
      status,
      config,
      error,
    };

    this.history.push(historyEntry);

    // 限制历史记录数量
    if (this.history.length > (this.config.maxHistoryEntries ?? 100)) {
      this.history.shift();
    }

    if (this.config.autoSaveHistory) {
      this.saveHistory();
    }

    logger.debug(`Added session to history: ${sessionId}`);
  }

  /**
   * 保存历史记录
   */
  saveHistory(): void {
    try {
      const fs = require('fs');
      const path = require('path');
      const historyPath =
        this.config.historyFilePath ||
        path.join(resolveSessionsDir(), 'session_history.json');

      fs.writeFileSync(historyPath, JSON.stringify(this.history, null, 2));
    } catch (error) {
      logger.error(
        'Failed to save session history:',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * 加载历史记录
   */
  loadHistory(): void {
    try {
      const fs = require('fs');
      const path = require('path');
      const { resolveDataDir } = require('@modules/core/paths');
      const historyPath =
        this.config.historyFilePath ||
        path.join(resolveDataDir(), 'session_history.json');

      if (fs.existsSync(historyPath)) {
        const content = fs.readFileSync(historyPath, 'utf-8');
        this.history = JSON.parse(content);
        logger.info(`Loaded ${this.history.length} session history entries`);
      }
    } catch (error) {
      logger.debug('No session history found or failed to load');
    }
  }

  /**
   * 清除历史记录
   */
  clearHistory(): void {
    this.history = [];
    this.saveHistory();
    TerminalComponents.printSuccess('历史记录已清除');
  }

  /**
   * 选择会话
   */
  selectSession(sessionId: string): boolean {
    const session = this.terminalUI
      .getAllSessions()
      .find((s) => s.id === sessionId);
    if (session) {
      this.selectedSessionId = sessionId;
      return true;
    }
    return false;
  }

  /**
   * 获取选中的会话
   */
  getSelectedSession(): TerminalSession | null {
    if (!this.selectedSessionId) {
      return null;
    }
    return (
      this.terminalUI
        .getAllSessions()
        .find((s) => s.id === this.selectedSessionId) || null
    );
  }

  /**
   * 显示快速操作菜单
   */
  showQuickActions(): void {
    TerminalComponents.printDivider();
    TerminalComponents.printList(
      [
        'sessions - 显示所有会话',
        'connect ssh <host> - 连接SSH',
        'connect direct <url> - 连接直接连接',
        'close <id> - 关闭会话',
        'history - 查看历史',
        'details <id> - 查看详情',
      ],
      { bullet: '•' }
    );
  }
}

/**
 * 创建远程会话管理界面
 */
export function createRemoteSessionManagerUI(
  terminalUI?: TerminalUIIntegration,
  terminalOutput?: RealtimeTerminalOutput,
  config?: SessionManagerConfig
): RemoteSessionManagerUI {
  return new RemoteSessionManagerUI(terminalUI, terminalOutput, config);
}
