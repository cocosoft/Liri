/**
 * TaskDetail 组件 - 终端任务详情面板
 * 对标 hermes-web-ui KanbanTaskDrawer / OpenClaw-Admin 详情 Modal
 *
 * 展示单个任务的完整元数据：状态、进度、依赖、历史、Token 用量等
 */

import React from 'react';
import { Text, Box } from 'ink';

export interface TaskDetailData {
  /** 任务 ID */
  id: string;
  /** 任务名称 */
  name: string;
  /** 任务描述 */
  description?: string;
  /** 任务类型 */
  type?: string;
  /** 任务状态 */
  status: string;
  /** 优先级 */
  priority?: string;
  /** 进度 (0-100) */
  progress?: number;
  /** 创建时间 */
  createdAt?: string | number;
  /** 开始时间 */
  startedAt?: string | number;
  /** 完成时间 */
  completedAt?: string | number;
  /** 运行时长 (ms) */
  durationMs?: number;
  /** 错误信息 */
  error?: string;
  /** Token 用量 */
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
  };
  /** 成本 (USD) */
  cost?: number;
  /** 依赖任务 ID 列表 */
  blockedBy?: string[];
  /** 被此任务阻塞的 ID 列表 */
  blocks?: string[];
  /** 子任务数量 */
  childCount?: number;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
  /** 归属 owner key */
  ownerKey?: string;
  /** 关联 session key */
  sessionKey?: string;
}

export interface TaskDetailProps {
  /** 任务数据 */
  task: TaskDetailData;
  /** 面板标题 (默认: 任务详情) */
  title?: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'gray',
  running: 'cyan',
  completed: 'green',
  failed: 'red',
  killed: 'magenta',
  lost: 'yellow',
  cancelled: 'magenta',
};

function formatField(value?: string | number): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'number') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString();
    }
    return String(value);
  }
  return value;
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '—';
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr}h ${min % 60}m ${sec % 60}s`;
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

function formatTokens(val?: number): string {
  if (!val) return '—';
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}k`;
  return String(val);
}

export function TaskDetail({
  task,
  title = '任务详情',
}: TaskDetailProps): React.ReactNode {
  const statusColor = STATUS_COLORS[task.status] ?? 'gray';

  return (
    <Box flexDirection="column" width="100%">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>{title} </Text>
        <Text color="gray" dim>
          #{task.id.slice(0, 8)}
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>

      {/* Primary fields */}
      <Box marginBottom={1} flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>{'Name:     '}</Text>
          <Text bold>{task.name}</Text>
        </Box>
        {task.description && (
          <Box flexDirection="row">
            <Text dimColor>{'Desc:     '}</Text>
            <Text>{task.description}</Text>
          </Box>
        )}
        <Box flexDirection="row">
          <Text dimColor>{'Status:   '}</Text>
          <Text color={statusColor} bold>
            {task.status}
          </Text>
          {task.priority && (
            <>
              <Text dimColor>{' | Priority: '}</Text>
              <Text
                color={
                  task.priority === 'high' || task.priority === 'urgent'
                    ? 'red'
                    : 'yellow'
                }
              >
                {task.priority}
              </Text>
            </>
          )}
          {task.type && (
            <>
              <Text dimColor>{' | Type: '}</Text>
              <Text>{task.type}</Text>
            </>
          )}
        </Box>
      </Box>

      {/* Progress */}
      {task.progress !== undefined && task.status === 'running' && (
        <Box marginBottom={1}>
          <Text dimColor>{'Progress: '}</Text>
          <Text color="cyan">
            {'█'.repeat(Math.round(task.progress / 5))}
            {'░'.repeat(Math.max(0, 20 - Math.round(task.progress / 5)))}
          </Text>
          <Text> {task.progress}%</Text>
        </Box>
      )}

      {/* Timing */}
      <Box marginBottom={1} flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>{'Created:  '}</Text>
          <Text>{formatField(task.createdAt)}</Text>
        </Box>
        {task.startedAt && (
          <Box flexDirection="row">
            <Text dimColor>{'Started:  '}</Text>
            <Text>{formatField(task.startedAt)}</Text>
          </Box>
        )}
        {task.completedAt && (
          <Box flexDirection="row">
            <Text dimColor>{'Completed:'}</Text>
            <Text>{formatField(task.completedAt)}</Text>
          </Box>
        )}
        {task.durationMs && (
          <Box flexDirection="row">
            <Text dimColor>{'Duration: '}</Text>
            <Text>{formatDuration(task.durationMs)}</Text>
          </Box>
        )}
      </Box>

      {/* Token & Cost */}
      {task.tokens && (
        <Box marginBottom={1} flexDirection="row">
          <Text dimColor>{'Tokens:   '}</Text>
          <Text>
            in={formatTokens(task.tokens.input)} out=
            {formatTokens(task.tokens.output)} total=
            {formatTokens(task.tokens.total)}
          </Text>
          {task.cost !== undefined && (
            <>
              <Text dimColor>{' | Cost: '}</Text>
              <Text color="yellow">${task.cost.toFixed(4)}</Text>
            </>
          )}
        </Box>
      )}

      {/* Dependencies */}
      {task.blockedBy && task.blockedBy.length > 0 && (
        <Box marginBottom={1} flexDirection="row">
          <Text dimColor>{'BlockedBy:'}</Text>
          <Text color="yellow">
            {' '}
            {task.blockedBy.map((id) => id.slice(0, 8)).join(', ')}
          </Text>
        </Box>
      )}
      {task.blocks && task.blocks.length > 0 && (
        <Box marginBottom={1} flexDirection="row">
          <Text dimColor>{'Blocks:   '}</Text>
          <Text>{task.blocks.map((id) => id.slice(0, 8)).join(', ')}</Text>
        </Box>
      )}

      {/* Ownership */}
      {(task.ownerKey || task.sessionKey || task.childCount !== undefined) && (
        <Box marginBottom={1} flexDirection="column">
          {task.ownerKey && (
            <Box flexDirection="row">
              <Text dimColor>{'Owner:    '}</Text>
              <Text>{task.ownerKey}</Text>
            </Box>
          )}
          {task.sessionKey && (
            <Box flexDirection="row">
              <Text dimColor>{'Session:  '}</Text>
              <Text>{task.sessionKey}</Text>
            </Box>
          )}
          {task.childCount !== undefined && (
            <Box flexDirection="row">
              <Text dimColor>{'Children: '}</Text>
              <Text>{task.childCount}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Error */}
      {task.error && (
        <Box marginBottom={1} flexDirection="column">
          <Box>
            <Text color="red" bold>
              {'Error:'}
            </Text>
          </Box>
          <Box marginLeft={2}>
            <Text color="red">{task.error}</Text>
          </Box>
        </Box>
      )}

      <Box marginBottom={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>
    </Box>
  );
}
