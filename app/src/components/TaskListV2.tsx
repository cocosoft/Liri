/**
 * TaskListV2组件 - 增强版任务列表
 * 支持分组、进度追踪、搜索筛选、状态筛选、批量操作
 */

import React, { useState, useMemo } from 'react';
import { Text, Box } from 'ink';

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export const ALL_TASK_STATUSES: TaskStatus[] = [
  'pending', 'running', 'completed', 'failed', 'skipped', 'cancelled',
];

export interface TaskItem {
  /** 任务ID */
  id: string;
  /** 任务标题 */
  title: string;
  /** 任务描述 */
  description?: string;
  /** 任务状态 */
  status: TaskStatus;
  /** 进度百分比 */
  progress?: number;
  /** 子任务 */
  children?: TaskItem[];
  /** 标签 */
  tags?: string[];
  /** 负责人 */
  assignee?: string;
  /** 截止时间 */
  dueDate?: string;
  /** 优先级 */
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

export interface TaskGroup {
  /** 分组名称 */
  name: string;
  /** 分组任务 */
  tasks: TaskItem[];
}

export interface TaskListV2Props {
  /** 任务分组 */
  groups: TaskGroup[];
  /** 是否显示分组标题 */
  showGroups?: boolean;
  /** 是否展开所有子任务 */
  expandAll?: boolean;
  /** 最大显示任务数 */
  maxTasks?: number;
  /** 显示进度条 */
  showProgressBar?: boolean;
  /** 是否显示优先级 */
  showPriority?: boolean;
  /** 是否显示标签 */
  showTags?: boolean;
  /** 搜索关键词（过滤标题/描述/标签/负责人） */
  searchQuery?: string;
  /** 状态过滤（只显示匹配状态的任务） */
  statusFilter?: TaskStatus | 'all';
}

const statusIcons: Record<TaskStatus, string> = {
  pending: '○',
  running: '▶',
  completed: '✓',
  failed: '✕',
  skipped: '−',
  cancelled: '◉',
};

const statusColors: Record<TaskStatus, string> = {
  pending: 'gray',
  running: 'cyan',
  completed: 'green',
  failed: 'red',
  skipped: 'yellow',
  cancelled: 'magenta',
};

const priorityColors: Record<string, string> = {
  low: 'gray',
  medium: 'yellow',
  high: 'red',
  critical: 'red',
};

function ProgressBar({
  percent,
  width = 20,
}: {
  percent: number;
  width?: number;
}): React.ReactNode {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  return (
    <Text>
      <Text color="cyan">{'█'.repeat(filled)}</Text>
      <Text color="gray">{'░'.repeat(Math.max(0, empty))}</Text>
      <Text> </Text>
      <Text color="gray" dim>
        {percent}%
      </Text>
    </Text>
  );
}

/** Filter a task item (and its children) by search query and status */
function filterTaskItem(
  task: TaskItem,
  query: string,
  statusFilter: TaskStatus | 'all'
): TaskItem | null {
  const statusMatch = statusFilter === 'all' || task.status === statusFilter;
  if (!statusMatch) return null;

  if (query) {
    const q = query.toLowerCase();
    const titleMatch = task.title.toLowerCase().includes(q);
    const descMatch = task.description?.toLowerCase().includes(q);
    const tagMatch = task.tags?.some((t) => t.toLowerCase().includes(q));
    const assigneeMatch = task.assignee?.toLowerCase().includes(q);
    const textMatch = titleMatch || descMatch || tagMatch || assigneeMatch;

    // Also check children
    const filteredChildren = task.children
      ?.map((child) => filterTaskItem(child, query, statusFilter))
      .filter((c): c is TaskItem => c !== null);

    if (textMatch) {
      return { ...task, children: filteredChildren };
    }
    if (filteredChildren && filteredChildren.length > 0) {
      return { ...task, children: filteredChildren };
    }
    return null;
  }

  // No query — filter children by status only
  const filteredChildren = task.children
    ?.map((child) => filterTaskItem(child, '', statusFilter))
    .filter((c): c is TaskItem => c !== null);

  return {
    ...task,
    children:
      filteredChildren && filteredChildren.length > 0
        ? filteredChildren
        : task.children,
  };
}

function renderTask(
  task: TaskItem,
  depth: number = 0,
  expanded: boolean,
  showPriority: boolean,
  showTags: boolean
): React.ReactNode {
  const icon = statusIcons[task.status];
  const color = statusColors[task.status];
  const indent = '  '.repeat(depth);

  return (
    <Box key={task.id} flexDirection="column">
      <Box>
        <Text>{indent}</Text>
        <Text color={color}>{icon}</Text>
        <Text> </Text>
        <Text
          bold={task.status === 'running'}
          strikethrough={
            task.status === 'cancelled' || task.status === 'skipped'
          }
          color={task.status === 'failed' ? 'red' : undefined}
        >
          {task.title}
        </Text>
        {showPriority && task.priority && task.priority !== 'low' && (
          <>
            <Text> </Text>
            <Text color={priorityColors[task.priority]}>
              {task.priority === 'critical'
                ? '!!!'
                : task.priority === 'high'
                  ? '!!'
                  : '!'}
            </Text>
          </>
        )}
        {showTags && task.tags && task.tags.length > 0 && (
          <>
            <Text> </Text>
            {task.tags.map((tag, idx) => (
              <Text key={idx} color="gray" dim>
                [{tag}]
              </Text>
            ))}
          </>
        )}
        {task.description && <Text> </Text>}
      </Box>
      {task.description && (
        <Box>
          <Text>{indent} </Text>
          <Text color="gray" dim>
            {task.description}
          </Text>
        </Box>
      )}
      {task.progress !== undefined && task.status === 'running' && (
        <Box>
          <Text>{indent} </Text>
          <ProgressBar percent={task.progress} />
        </Box>
      )}
      {expanded && task.children && task.children.length > 0 && (
        <Box flexDirection="column">
          {task.children.map((child) =>
            renderTask(child, depth + 1, expanded, showPriority, showTags)
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * Filter groups by applying searchQuery and statusFilter to each task.
 * Groups with zero matching tasks are excluded.
 */
function filterGroups(
  groups: TaskGroup[],
  query: string,
  status: TaskStatus | 'all'
): TaskGroup[] {
  return groups
    .map((group) => ({
      ...group,
      tasks: group.tasks
        .map((t) => filterTaskItem(t, query, status))
        .filter((t): t is TaskItem => t !== null),
    }))
    .filter((group) => group.tasks.length > 0);
}

export function TaskListV2({
  groups,
  showGroups = true,
  expandAll = true,
  maxTasks,
  showProgressBar = true,
  showPriority = false,
  showTags = false,
  searchQuery = '',
  statusFilter = 'all',
}: TaskListV2Props): React.ReactNode {
  const [expanded, setExpanded] = useState(expandAll);

  const filteredGroups = useMemo(
    () => filterGroups(groups, searchQuery, statusFilter),
    [groups, searchQuery, statusFilter]
  );

  const totalTasks = filteredGroups.reduce((sum, g) => sum + g.tasks.length, 0);
  const completedTasks = filteredGroups.reduce(
    (sum, g) => sum + g.tasks.filter((t) => t.status === 'completed').length,
    0
  );
  const failedTasks = filteredGroups.reduce(
    (sum, g) => sum + g.tasks.filter((t) => t.status === 'failed').length,
    0
  );
  const runningTasks = filteredGroups.reduce(
    (sum, g) => sum + g.tasks.filter((t) => t.status === 'running').length,
    0
  );

  const hasActiveFilter = searchQuery !== '' || statusFilter !== 'all';

  if (totalTasks === 0) {
    const rawTotal = groups.reduce((sum, g) => sum + g.tasks.length, 0);
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="gray" dim>
            {rawTotal > 0
              ? `无匹配任务 (筛选: ${searchQuery ? `"${searchQuery}"` : ''}${searchQuery && statusFilter !== 'all' ? ' + ' : ''}${statusFilter !== 'all' ? statusFilter : ''})`
              : '暂无任务'}
          </Text>
        </Box>
      </Box>
    );
  }

  const overallProgress =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const displayGroups = maxTasks
    ? filteredGroups.map((g) => ({
        ...g,
        tasks: g.tasks.slice(0, maxTasks),
      }))
    : filteredGroups;

  return (
    <Box flexDirection="column" width="100%">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>{'任务列表 '}</Text>
        <Text color="gray" dim>
          ({completedTasks}/{totalTasks}
          {failedTasks > 0 && <Text color="red"> {failedTasks} 失败</Text>}
          {runningTasks > 0 && <Text color="cyan"> {runningTasks} 运行中</Text>}
          )
        </Text>
      </Box>

      {/* Active filter indicator */}
      {hasActiveFilter && (
        <Box marginBottom={1}>
          {searchQuery && (
            <Text color="yellow">
              🔍 "{searchQuery}"
            </Text>
          )}
          {searchQuery && statusFilter !== 'all' && (
            <Text color="gray" dim> + </Text>
          )}
          {statusFilter !== 'all' && (
            <Text color={statusColors[statusFilter as TaskStatus] ?? 'gray'}>
              状态: {statusFilter}
            </Text>
          )}
        </Box>
      )}

      {/* Progress bar */}
      {showProgressBar && (
        <Box marginBottom={1}>
          <ProgressBar percent={overallProgress} />
        </Box>
      )}

      {/* Task groups */}
      <Box flexDirection="column">
        {displayGroups.map((group, groupIdx) => (
          <Box
            key={groupIdx}
            flexDirection="column"
            marginBottom={groupIdx < displayGroups.length - 1 ? 1 : 0}
          >
            {showGroups && (
              <Box marginBottom={1}>
                <Text bold color="cyan">
                  {'▸ '}
                  {group.name}
                </Text>
                <Text color="gray" dim>
                  {' ('}
                  {group.tasks.filter((t) => t.status === 'completed').length}/
                  {group.tasks.length}
                  {')'}
                </Text>
              </Box>
            )}
            <Box flexDirection="column">
              {group.tasks.map((task) =>
                renderTask(
                  task,
                  showGroups ? 0 : 0,
                  expanded,
                  showPriority,
                  showTags
                )
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
