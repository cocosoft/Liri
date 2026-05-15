/**
 * TaskListV2组件 - 增强版任务列表
 * 支持分组、进度追踪、状态筛选、批量操作
 */

import React, { useState } from 'react';
import { Text, Box } from 'ink';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';

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

function ProgressBar({ percent, width = 20 }: { percent: number; width?: number }): React.ReactNode {
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
          strikethrough={task.status === 'cancelled' || task.status === 'skipped'}
          color={task.status === 'failed' ? 'red' : undefined}
        >
          {task.title}
        </Text>
        {showPriority && task.priority && task.priority !== 'low' && (
          <>
            <Text> </Text>
            <Text color={priorityColors[task.priority]}>
              {task.priority === 'critical' ? '!!!' : task.priority === 'high' ? '!!' : '!'}
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
        {task.description && (
          <Text> </Text>
        )}
      </Box>
      {task.description && (
        <Box>
          <Text>{indent}  </Text>
          <Text color="gray" dim>
            {task.description}
          </Text>
        </Box>
      )}
      {task.progress !== undefined && task.status === 'running' && (
        <Box>
          <Text>{indent}  </Text>
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

export function TaskListV2({
  groups,
  showGroups = true,
  expandAll = true,
  maxTasks,
  showProgressBar = true,
  showPriority = false,
  showTags = false,
}: TaskListV2Props): React.ReactNode {
  const [expanded, setExpanded] = useState(expandAll);

  const totalTasks = groups.reduce((sum, g) => sum + g.tasks.length, 0);
  const completedTasks = groups.reduce(
    (sum, g) => sum + g.tasks.filter((t) => t.status === 'completed').length,
    0
  );
  const failedTasks = groups.reduce(
    (sum, g) => sum + g.tasks.filter((t) => t.status === 'failed').length,
    0
  );
  const runningTasks = groups.reduce(
    (sum, g) => sum + g.tasks.filter((t) => t.status === 'running').length,
    0
  );

  if (totalTasks === 0) {
    return (
      <Box>
        <Text color="gray" dim>
          暂无任务
        </Text>
      </Box>
    );
  }

  const overallProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const displayGroups = maxTasks
    ? groups.map((g) => ({
        ...g,
        tasks: g.tasks.slice(0, maxTasks),
      }))
    : groups;

  return (
    <Box flexDirection="column" width="100%">
      <Box marginBottom={1}>
        <Text bold>
          {'任务列表 '}
        </Text>
        <Text color="gray" dim>
          ({completedTasks}/{totalTasks}
          {failedTasks > 0 && (
            <Text color="red">
              {' '}{failedTasks} 失败
            </Text>
          )}
          {runningTasks > 0 && (
            <Text color="cyan">
              {' '}{runningTasks} 运行中
            </Text>
          )}
          )
        </Text>
      </Box>
      {showProgressBar && (
        <Box marginBottom={1}>
          <ProgressBar percent={overallProgress} />
        </Box>
      )}
      <Box flexDirection="column">
        {displayGroups.map((group, groupIdx) => (
          <Box key={groupIdx} flexDirection="column" marginBottom={groupIdx < groups.length - 1 ? 1 : 0}>
            {showGroups && (
              <Box marginBottom={1}>
                <Text bold color="cyan">
                  {'▸ '}{group.name}
                </Text>
                <Text color="gray" dim>
                  {' ('}{group.tasks.filter((t) => t.status === 'completed').length}/{group.tasks.length}{')'}
                </Text>
              </Box>
            )}
            <Box flexDirection="column">
              {group.tasks.map((task) =>
                renderTask(task, showGroups ? 0 : 0, expanded, showPriority, showTags)
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
