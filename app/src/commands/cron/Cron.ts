/**
 * Cron 命令实现
 * 定时作业管理：创建/查看/暂停/恢复/删除/统计
 */

import type { CommandContext, CommandResult } from '@modules/commands/types';
import { CronJobStore } from '@modules/tasks/cron/CronJobStore';
import type {
  CronJob,
  CronSchedule,
  CronJobFilter,
} from '@modules/tasks/cron/types';
import { resolveDbPath } from '@modules/config/paths';
import { join } from 'path';

const CRON_DATA_DIR = process.env.CRON_DATA_DIR || '';

function getStorePath(): string {
  if (CRON_DATA_DIR) {
    return `${CRON_DATA_DIR}/cron.db`;
  }
  return resolveDbPath();
}

let storeInstance: CronJobStore | null = null;

async function getStore(): Promise<CronJobStore> {
  if (!storeInstance) {
    storeInstance = new CronJobStore(getStorePath());
    await storeInstance.init();
  }
  return storeInstance;
}

function formatSchedule(s: CronSchedule): string {
  switch (s.kind) {
    case 'once':
      return `一次性 @ ${s.runAt ?? 'N/A'}`;
    case 'interval':
      return `每 ${s.minutes ?? 30} 分钟`;
    case 'cron':
      return `Cron: ${s.expr ?? 'N/A'}`;
    default:
      return '未知';
  }
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatJobTable(jobs: CronJob[]): string {
  if (jobs.length === 0) return '暂无作业';

  const header =
    'ID         | 名称                | 调度            | 状态        | 下次运行   ';
  const sep =
    '-----------+---------------------+-----------------+-------------+-------------';
  const rows = jobs.map((j) => {
    const id = j.id.padEnd(10).slice(0, 10);
    const name = j.name.padEnd(20).slice(0, 20);
    const schedule = formatSchedule(j.schedule).padEnd(16).slice(0, 16);
    const state = j.state.padEnd(12).slice(0, 12);
    const nextRun = formatDate(j.nextRunAt).padEnd(12).slice(0, 12);
    return `${id} | ${name} | ${schedule} | ${state} | ${nextRun}`;
  });

  return [header, sep, ...rows].join('\n');
}

export default {
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase() || '';

    if (!subcommand || subcommand === 'list' || subcommand === 'ls') {
      return this.handleList(parts.slice(1));
    }

    if (subcommand === 'add' || subcommand === 'create') {
      return this.handleAdd(parts.slice(1));
    }

    if (subcommand === 'pause' || subcommand === 'hold') {
      return this.handlePause(parts[1]);
    }

    if (subcommand === 'resume' || subcommand === 'unhold') {
      return this.handleResume(parts[1]);
    }

    if (subcommand === 'delete' || subcommand === 'rm') {
      return this.handleDelete(parts[1]);
    }

    if (subcommand === 'status' || subcommand === 'stats') {
      return this.handleStats();
    }

    if (subcommand === 'view' || subcommand === 'show') {
      return this.handleView(parts[1]);
    }

    return this.handleHelp();
  },

  async handleList(filterArgs: string[]): Promise<CommandResult> {
    try {
      const store = await getStore();
      const filter: CronJobFilter = {};
      const filterStr = filterArgs.join(' ').toLowerCase();

      if (filterStr) {
        if (filterStr === 'enabled' || filterStr === 'active') {
          filter.enabled = true;
        } else if (filterStr === 'paused' || filterStr === 'held') {
          filter.state = 'paused';
        } else if (filterStr === 'completed' || filterStr === 'done') {
          filter.state = 'completed';
        } else if (filterStr === 'failed') {
          filter.state = 'failed';
        } else {
          filter.skill = filterStr;
        }
      }

      const jobs = await store.loadJobs(filter);

      if (jobs.length === 0) {
        return {
          success: true,
          type: 'text',
          message: filterStr
            ? `没有匹配 "${filterStr}" 的作业`
            : '暂无定时作业。使用 /cron add 创建新作业',
        };
      }

      return {
        success: true,
        type: 'text',
        message: `📋 定时作业列表 (共 ${jobs.length} 个)\n\n${formatJobTable(jobs)}`,
      };
    } catch (error) {
      return {
        success: false,
        type: 'text',
        message: `获取作业列表失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  async handleAdd(args: string[]): Promise<CommandResult> {
    const store = await getStore();
    const job: CronJob = {
      id: generateId(),
      name: args[0] || '未命名作业',
      prompt: args.slice(1).join(' ') || undefined,
      skills: [],
      schedule: { kind: 'interval', minutes: 30, display: '每 30 分钟' },
      repeat: { times: null, completed: 0 },
      enabled: true,
      state: 'scheduled',
      createdAt: new Date().toISOString(),
      deliver: 'local',
    };

    await store.upsertJob(job);

    return {
      success: true,
      type: 'text',
      message: `✅ 作业已创建\n\nID: ${job.id}\n名称: ${job.name}\n调度: ${formatSchedule(job.schedule)}`,
    };
  },

  async handlePause(jobId?: string): Promise<CommandResult> {
    if (!jobId) {
      return {
        success: false,
        type: 'text',
        message: '请提供作业 ID: /cron pause <ID>',
      };
    }

    try {
      const store = await getStore();
      const job = await store.getJob(jobId);
      if (!job) {
        return {
          success: false,
          type: 'text',
          message: `作业 "${jobId}" 不存在`,
        };
      }

      await store.pauseJob(jobId, '用户手动暂停');

      return {
        success: true,
        type: 'text',
        message: `⏸️ 作业 "${job.name}" (${jobId}) 已暂停`,
      };
    } catch (error) {
      return {
        success: false,
        type: 'text',
        message: `暂停失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  async handleResume(jobId?: string): Promise<CommandResult> {
    if (!jobId) {
      return {
        success: false,
        type: 'text',
        message: '请提供作业 ID: /cron resume <ID>',
      };
    }

    try {
      const store = await getStore();
      const job = await store.getJob(jobId);
      if (!job) {
        return {
          success: false,
          type: 'text',
          message: `作业 "${jobId}" 不存在`,
        };
      }

      const nextRun = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      await store.resumeJob(jobId, nextRun);

      return {
        success: true,
        type: 'text',
        message: `▶️ 作业 "${job.name}" (${jobId}) 已恢复，下次运行: ${formatDate(nextRun)}`,
      };
    } catch (error) {
      return {
        success: false,
        type: 'text',
        message: `恢复失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  async handleDelete(jobId?: string): Promise<CommandResult> {
    if (!jobId) {
      return {
        success: false,
        type: 'text',
        message: '请提供作业 ID: /cron delete <ID>',
      };
    }

    try {
      const store = await getStore();
      const job = await store.getJob(jobId);
      if (!job && jobId.length >= 4) {
        // 尝试部分匹配
        const all = await store.loadJobs();
        const match = all.find(
          (j: CronJob) => j.id.startsWith(jobId) || j.name.includes(jobId)
        );
        if (match) {
          await store.deleteJob(match.id);
          return {
            success: true,
            type: 'text',
            message: `🗑️ 作业 "${match.name}" (${match.id}) 已删除`,
          };
        }
        return {
          success: false,
          type: 'text',
          message: `没有匹配的作业: ${jobId}`,
        };
      }

      if (!job) {
        return {
          success: false,
          type: 'text',
          message: `作业 "${jobId}" 不存在`,
        };
      }

      await store.deleteJob(jobId);

      return {
        success: true,
        type: 'text',
        message: `🗑️ 作业 "${job.name}" (${jobId}) 已删除`,
      };
    } catch (error) {
      return {
        success: false,
        type: 'text',
        message: `删除失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  async handleStats(): Promise<CommandResult> {
    try {
      const store = await getStore();
      const stats = await store.getStats();

      return {
        success: true,
        type: 'text',
        message:
          `📊 Cron 作业统计\n\n` +
          `总计:    ${stats.total}\n` +
          `启用:    ${stats.enabled}\n` +
          `暂停:    ${stats.paused}\n` +
          `完成:    ${stats.completed}\n` +
          `失败:    ${stats.failed}`,
      };
    } catch (error) {
      return {
        success: false,
        type: 'text',
        message: `获取统计失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  async handleView(jobId?: string): Promise<CommandResult> {
    if (!jobId) {
      return {
        success: false,
        type: 'text',
        message: '请提供作业 ID: /cron view <ID>',
      };
    }

    try {
      const store = await getStore();
      const job = await store.getJob(jobId);
      if (!job) {
        return {
          success: false,
          type: 'text',
          message: `作业 "${jobId}" 不存在`,
        };
      }

      const lines: string[] = [
        `📋 作业详情`,
        `──`,
        `ID:        ${job.id}`,
        `名称:      ${job.name}`,
        `调度:      ${formatSchedule(job.schedule)}`,
        `状态:      ${job.state}`,
        `启用:      ${job.enabled ? '是' : '否'}`,
        `重复:      ${job.repeat.times === null ? '无限' : `${job.repeat.times} 次 (已完成 ${job.repeat.completed})`}`,
        `创建:      ${formatDate(job.createdAt)}`,
        `交付:      ${job.deliver}`,
      ];

      if (job.prompt) lines.push(`Prompt:    ${job.prompt}`);
      if (job.skills.length > 0)
        lines.push(`技能:      ${job.skills.join(', ')}`);
      if (job.nextRunAt) lines.push(`下次运行:  ${formatDate(job.nextRunAt)}`);
      if (job.lastRunAt) lines.push(`上次运行:  ${formatDate(job.lastRunAt)}`);
      if (job.lastStatus) lines.push(`上次状态:  ${job.lastStatus}`);
      if (job.lastError) lines.push(`上次错误:  ${job.lastError}`);
      if (job.workdir) lines.push(`工作目录:  ${job.workdir}`);
      if (job.model) lines.push(`模型:      ${job.model}`);
      if (job.script) lines.push(`脚本:      ${job.script}`);
      if (job.noAgent) lines.push(`模式:      无 Agent（脚本输出直投）`);
      if (job.origin)
        lines.push(`来源:      ${job.origin.platform}/${job.origin.chatId}`);
      if (job.ownerKey) lines.push(`所有者:   ${job.ownerKey}`);
      if (job.sessionKey) lines.push(`会话:      ${job.sessionKey}`);

      return {
        success: true,
        type: 'text',
        message: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        type: 'text',
        message: `查看作业失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  handleHelp(): CommandResult {
    return {
      success: true,
      type: 'text',
      message:
        `📋 Cron 定时作业管理\n\n` +
        `用法:\n` +
        `  /cron                   查看帮助\n` +
        `  /cron list [filter]     列出作业 (filter: enabled/paused/failed/completed)\n` +
        `  /cron add <name>        创建新作业\n` +
        `  /cron view <ID>         查看作业详情\n` +
        `  /cron pause <ID>        暂停作业\n` +
        `  /cron resume <ID>       恢复作业\n` +
        `  /cron delete <ID>       删除作业\n` +
        `  /cron stats             查看统计`,
    };
  },
};

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}
