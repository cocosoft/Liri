/**
 * 会话处理器
 * 处理 session 命令组，提供会话的查看、检查和导出功能
 */

import chalk from 'chalk';
import { t } from '@modules/system/i18n/extended';
import { getLogger } from '@modules/monitoring';
import { SessionGateway, createSessionGateway } from '@modules/session';
import type { UnifiedSession } from '@modules/session/types/Session';
import type { UnifiedMessage } from '@modules/session/types/Message';
import type { Transcript } from '@modules/session/types/Transcript';

const logger = getLogger('sessionHandler');

export interface SessionHandlerOptions {
  verbose?: boolean;
}

export class SessionHandler {
  private sessionGateway: SessionGateway | null = null;
  private options: SessionHandlerOptions;

  constructor(options?: SessionHandlerOptions) {
    this.options = { verbose: false, ...options };
  }

  /**
   * 延迟初始化 SessionGateway
   */
  private async getGateway(): Promise<SessionGateway> {
    if (!this.sessionGateway) {
      this.sessionGateway = createSessionGateway({ wireServices: true });
      await this.sessionGateway.initialize();
    }
    return this.sessionGateway;
  }

  /**
   * 主分发方法
   */
  async handle(command: string, args: string[]): Promise<boolean> {
    switch (command) {
      case 'list':
        await this.handleList();
        return true;
      case 'inspect':
        await this.handleInspect(args);
        return true;
      case 'export':
        await this.handleExport(args);
        return true;
      default:
        return false;
    }
  }

  /**
   * 列出所有会话
   * session list
   */
  async handleList(): Promise<void> {
    if (this.options.verbose) {
      logger.info('Fetching session list...');
    }

    try {
      const gateway = await this.getGateway();
      const sessions = await gateway.listSessions();

      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold(`  ${t('session.list_header')}`));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log();

      if (sessions.length === 0) {
        console.log(chalk.yellow('⚠'), t('session.empty'));
        console.log();
        console.log(chalk.cyan('═'.repeat(60)));
        return;
      }

      sessions.forEach((session, index) => {
        const statusColor = getStatusColor(session.status);
        const timeStr = new Date(session.createdAt).toLocaleString('zh-CN');
        console.log(
          chalk.green(`${String(index + 1).padStart(3)}.`),
          chalk.bold(session.id.slice(0, 8) + '...'),
          statusColor(session.status)
        );
        if (session.title) {
          console.log(`     ${t('prompt.input')}: ${session.title}`);
        }
        console.log(`     ${t('common.status')}: ${chalk.gray(timeStr)}`);
      });

      console.log();
      console.log(
        chalk.gray(t('session.list_footer', { count: sessions.length }))
      );
      console.log(chalk.cyan('═'.repeat(60)));
    } catch (error) {
      logger.error(
        '获取会话列表失败',
        error instanceof Error ? error : undefined
      );
      console.log(
        chalk.red('✕'),
        t('session.list_error', { detail: (error as Error).message })
      );
    }
  }

  /**
   * 查看会话详情
   * session inspect <id>
   */
  async handleInspect(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log(chalk.yellow('⚠'), t('session.inspect_usage'));
      console.log(
        chalk.gray(`   ${t('common.example')}: session inspect abc123`)
      );
      return;
    }

    const sessionId = args[0];

    if (this.options.verbose) {
      logger.info('Inspecting session', { sessionId });
    }

    try {
      const gateway = await this.getGateway();
      const session = await gateway.getSession(sessionId);

      if (!session) {
        console.log(
          chalk.yellow('⚠'),
          t('session.not_found', { id: sessionId })
        );
        return;
      }

      const messages = await gateway.getMessages(sessionId, { limit: 10 });

      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold(`  ${t('session.detail_header')}`));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log();

      printSessionDetail(session);
      console.log();

      console.log(chalk.cyan(t('session.recent_messages')));
      if (messages.length === 0) {
        console.log(chalk.gray(`  ${t('session.no_messages')}`));
      } else {
        messages.forEach((msg, i) => {
          const roleColor = msg.role === 'user' ? chalk.green : chalk.blue;
          const preview = msg.content
            ? msg.content.slice(0, 80) + (msg.content.length > 80 ? '...' : '')
            : t('session.no_content');
          console.log(
            `  ${chalk.gray(`#${i + 1}`)} ${roleColor(msg.role)}: ${preview}`
          );
        });
      }

      console.log();
      console.log(chalk.cyan('═'.repeat(60)));
    } catch (error) {
      logger.error(
        '获取会话详情失败',
        error instanceof Error ? error : undefined
      );
      console.log(
        chalk.red('✕'),
        t('session.inspect_error', { detail: (error as Error).message })
      );
    }
  }

  /**
   * 导出会话
   * session export <id> --format json|md
   */
  async handleExport(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log(chalk.yellow('⚠'), t('session.export_usage'));
      console.log(
        chalk.gray(`   ${t('common.example')}: session export abc123`)
      );
      console.log(
        chalk.gray(
          `   ${t('common.example')}: session export abc123 --format md`
        )
      );
      return;
    }

    const sessionId = args[0];
    const formatFlag = args.indexOf('--format');
    const format: 'json' | 'md' =
      formatFlag !== -1 && formatFlag + 1 < args.length
        ? (args[formatFlag + 1] as 'json' | 'md')
        : 'json';

    if (format !== 'json' && format !== 'md') {
      console.log(
        chalk.yellow('⚠'),
        t('session.export_format_error', { format })
      );
      return;
    }

    if (this.options.verbose) {
      logger.info('Exporting session', { sessionId, format });
    }

    try {
      const gateway = await this.getGateway();
      const session = await gateway.getSession(sessionId);

      if (!session) {
        console.log(
          chalk.yellow('⚠'),
          t('session.not_found', { id: sessionId })
        );
        return;
      }

      const messages = await gateway.getMessages(sessionId);
      const transcript = await gateway.loadTranscript(sessionId);

      if (format === 'json') {
        const summary = transcript?.entries?.find(
          (e): e is { type: 'summary'; summary: string; summaryId: string } =>
            'type' in e && e.type === 'summary'
        );

        const output: Record<string, unknown> = {
          session: {
            id: session.id,
            title: session.title,
            type: session.type,
            status: session.status,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            metadata: session.metadata,
          },
          messages: messages.map((msg) => ({
            role: msg.role,
            content:
              typeof msg.content === 'string'
                ? msg.content
                : JSON.stringify(msg.content),
            timestamp: msg.timestamp,
            metadata: msg.metadata,
          })),
        };

        if (summary) {
          output.summary = summary.summary;
        }

        console.log(JSON.stringify(output, null, 2));
      } else {
        const title = session.title || sessionId;
        console.log(`# 会话: ${title}`);
        console.log();
        console.log(`- **ID**: ${session.id}`);
        console.log(`- **状态**: ${session.status}`);
        console.log(
          `- **创建时间**: ${new Date(session.createdAt).toLocaleString('zh-CN')}`
        );
        console.log(
          `- **更新时间**: ${new Date(session.updatedAt).toLocaleString('zh-CN')}`
        );
        console.log();

        const summaryEntry = transcript?.entries?.find(
          (e): e is { type: 'summary'; summary: string; summaryId: string } =>
            'type' in e && e.type === 'summary'
        );
        if (summaryEntry) {
          console.log(`## 摘要`);
          console.log();
          console.log(summaryEntry.summary);
          console.log();
        }

        console.log(`## 消息记录`);
        console.log();
        for (const msg of messages) {
          const roleLabel = msg.role === 'user' ? '👤 用户' : '🤖 助手';
          const time = msg.timestamp
            ? new Date(msg.timestamp).toLocaleString('zh-CN')
            : '';
          console.log(`### ${roleLabel} (${time})`);
          console.log();
          console.log(
            typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content)
          );
          console.log();
        }
      }
    } catch (error) {
      logger.error('导出会话失败', error instanceof Error ? error : undefined);
      console.log(
        chalk.red('✕'),
        t('session.export_error', { detail: (error as Error).message })
      );
    }
  }

  /**
   * 显示会话帮助
   */
  showHelp(): void {
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold(`  session - ${t('session.help_description')}`));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();
    console.log(chalk.green(t('command.help')));
    console.log(
      chalk.gray('  session list                 - ', t('session.list'))
    );
    console.log(
      chalk.gray('  session inspect <id>         - ', t('session.inspect'))
    );
    console.log(
      chalk.gray('  session export <id> [opts]   - ', t('session.export'))
    );
    console.log();
    console.log(chalk.green(t('session.export_options')));
    console.log(chalk.gray('  --format json   JSON ', t('common.default')));
    console.log(chalk.gray('  --format md     Markdown'));
    console.log();
    console.log(chalk.green(t('common.example')));
    console.log(chalk.gray('  session list'));
    console.log(chalk.gray('  session inspect abc123'));
    console.log(chalk.gray('  session export abc123 --format md'));
    console.log(chalk.cyan('═'.repeat(60)));
  }
}

/**
 * 打印会话详情
 */
function printSessionDetail(session: UnifiedSession): void {
  console.log(`  ${chalk.gray('ID:')}       ${session.id}`);
  console.log(`  ${chalk.gray('标题:')}     ${session.title || '(无)'}`);
  console.log(`  ${chalk.gray('类型:')}     ${session.type}`);
  console.log(
    `  ${chalk.gray('状态:')}     ${getStatusColor(session.status)(session.status)}`
  );
  console.log(
    `  ${chalk.gray('创建:')}     ${new Date(session.createdAt).toLocaleString('zh-CN')}`
  );
  console.log(
    `  ${chalk.gray('更新:')}     ${new Date(session.updatedAt).toLocaleString('zh-CN')}`
  );

  if (session.metadata) {
    const meta = session.metadata;
    if (meta.tags && meta.tags.length > 0) {
      console.log(`  ${chalk.gray('标签:')}     ${meta.tags.join(', ')}`);
    }
    if (meta.mode) {
      console.log(`  ${chalk.gray('模式:')}     ${meta.mode}`);
    }
  }

  if (session.storage) {
    console.log(`  ${chalk.gray('存储:')}     ${session.storage.type}`);
  }
}

/**
 * 根据状态返回对应颜色
 */
function getStatusColor(status: string) {
  const colorMap: Record<string, (s: string) => string> = {
    active: chalk.green,
    running: chalk.green,
    paused: chalk.yellow,
    idle: chalk.blue,
    ended: chalk.gray,
    archived: chalk.gray,
    error: chalk.red,
    completed: chalk.green,
  };
  return colorMap[status] || chalk.white;
}

/**
 * 创建会话处理器
 */
export function createSessionHandler(
  options?: SessionHandlerOptions
): SessionHandler {
  return new SessionHandler(options);
}
