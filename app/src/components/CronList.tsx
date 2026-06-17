/**
 * CronList 组件 - 终端 Cron 任务列表视图
 * 对标 hermes-web-ui JobCard / OpenClaw-Admin CronPage DataTable
 *
 * 展示 Cron 定时任务的状态、调度表达式、上次触发时间等
 * 支持状态筛选和人类可读的调度表达式展示
 */

import React from 'react';
import { Text, Box } from 'ink';

export interface CronJobItem {
  /** 任务 ID */
  id: string;
  /** 任务名称/描述 */
  name: string;
  /** cron 表达式或人类友好表达式 */
  schedule: string;
  /** 人类可读的调度文本 */
  displayText?: string;
  /** 任务状态 */
  enabled: boolean;
  /** 是否正在运行 */
  running?: boolean;
  /** 上次触发时间 (ISO string or ms) */
  lastFiredAt?: string | number;
  /** 下次触发时间 (ISO string or ms) */
  nextFireAt?: string | number;
  /** 任务类型 */
  taskType?: string;
  /** Agent ID */
  agentId?: string;
}

export interface CronListProps {
  /** Cron 任务列表 */
  jobs: CronJobItem[];
  /** 是否只显示启用的任务 */
  onlyEnabled?: boolean;
  /** 最大显示数 */
  maxJobs?: number;
  /** 标题 */
  title?: string;
}

const FIELD_WIDTHS = {
  id: 10,
  name: 28,
  schedule: 24,
  status: 8,
  lastFired: 20,
  nextFire: 20,
};

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

function formatTimestamp(value?: string | number): string {
  if (!value) return '—';
  const ms = typeof value === 'string' ? new Date(value).getTime() : value;
  if (isNaN(ms)) return '—';
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const now = Date.now();
  const diff = now - ms;

  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderRow(
  job: CronJobItem,
  idWidth: number,
  nameWidth: number,
  schedWidth: number
): React.ReactNode {
  const statusIcon = job.running ? '▶' : job.enabled ? '●' : '○';
  const statusColor = job.running ? 'cyan' : job.enabled ? 'green' : 'red';
  const statusLabel = job.running
    ? 'running'
    : job.enabled
      ? 'enabled'
      : 'disabled';

  const scheduleDisplay = job.displayText || job.schedule;

  return (
    <Box key={job.id} flexDirection="row">
      <Text dimColor>{truncate(job.id, idWidth).padEnd(idWidth)} </Text>
      <Text>{truncate(job.name, nameWidth).padEnd(nameWidth)} </Text>
      <Text dimColor>
        {truncate(scheduleDisplay, schedWidth).padEnd(schedWidth)}{' '}
      </Text>
      <Text color={statusColor}>
        {statusIcon} {statusLabel.padEnd(8)}
      </Text>
      <Text dimColor> {formatTimestamp(job.lastFiredAt).padEnd(20)}</Text>
    </Box>
  );
}

function renderDetailedRow(job: CronJobItem): React.ReactNode {
  const statusIcon = job.running ? '▶' : job.enabled ? '●' : '○';
  const statusColor = job.running ? 'cyan' : job.enabled ? 'green' : 'red';
  const statusLabel = job.running
    ? 'running'
    : job.enabled
      ? 'enabled'
      : 'disabled';

  return (
    <Box key={job.id} flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={statusColor}>{statusIcon} </Text>
        <Text bold>{job.name}</Text>
        <Text dimColor> ({truncate(job.id, 10)})</Text>
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>Schedule: </Text>
        <Text>{job.displayText || job.schedule}</Text>
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>Status: </Text>
        <Text color={statusColor}>{statusLabel}</Text>
        {job.taskType && (
          <>
            <Text dimColor> | Type: </Text>
            <Text>{job.taskType}</Text>
          </>
        )}
        {job.agentId && (
          <>
            <Text dimColor> | Agent: </Text>
            <Text>{truncate(job.agentId, 20)}</Text>
          </>
        )}
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>Last: </Text>
        <Text>{formatTimestamp(job.lastFiredAt)}</Text>
        <Text dimColor> | Next: </Text>
        <Text>{formatTimestamp(job.nextFireAt)}</Text>
      </Box>
    </Box>
  );
}

export function CronList({
  jobs,
  onlyEnabled = false,
  maxJobs,
  title = 'Cron 任务列表',
}: CronListProps): React.ReactNode {
  const filtered = onlyEnabled ? jobs.filter((j) => j.enabled) : jobs;
  const displayJobs = maxJobs ? filtered.slice(0, maxJobs) : filtered;

  const enabledCount = jobs.filter((j) => j.enabled).length;
  const disabledCount = jobs.filter((j) => !j.enabled).length;

  // Use compact mode for many jobs, detailed mode for few
  const compact = displayJobs.length > 5;

  if (displayJobs.length === 0) {
    return (
      <Box>
        <Text color="gray" dim>
          {jobs.length === 0 ? '暂无 Cron 任务' : '无匹配的 Cron 任务'}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>{title} </Text>
        <Text color="gray" dim>
          ({enabledCount} 启用, {disabledCount} 禁用, 共 {jobs.length} 个)
        </Text>
      </Box>

      {compact ? (
        <>
          {/* Column headers */}
          <Box marginBottom={1}>
            <Text bold dimColor>
              {truncate('ID', FIELD_WIDTHS.id).padEnd(FIELD_WIDTHS.id + 1)}
              {truncate('Name', FIELD_WIDTHS.name).padEnd(
                FIELD_WIDTHS.name + 1
              )}
              {truncate('Schedule', FIELD_WIDTHS.schedule).padEnd(
                FIELD_WIDTHS.schedule + 1
              )}
              {'Status'.padEnd(15)}
              {'Last Fire'}
            </Text>
          </Box>
          <Box flexDirection="column" marginBottom={1}>
            <Text dimColor>{'─'.repeat(100)}</Text>
          </Box>
          {/* Rows */}
          {displayJobs.map((job) =>
            renderRow(
              job,
              FIELD_WIDTHS.id,
              FIELD_WIDTHS.name,
              FIELD_WIDTHS.schedule
            )
          )}
        </>
      ) : (
        <>
          {/* Detailed cards */}
          <Box flexDirection="column" marginBottom={1}>
            <Text dimColor>{'─'.repeat(60)}</Text>
          </Box>
          {displayJobs.map((job) => renderDetailedRow(job))}
        </>
      )}

      {maxJobs && filtered.length > maxJobs && (
        <Box marginTop={1}>
          <Text color="gray" dim>
            ... 还有 {filtered.length - maxJobs} 个任务未显示
          </Text>
        </Box>
      )}
    </Box>
  );
}
