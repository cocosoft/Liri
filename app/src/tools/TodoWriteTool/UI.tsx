// import React from 'react'
import { Box, Text } from '@modules/ink';

export type TodoItem = {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
};

export type TodoWriteOutput = {
  todos: TodoItem[];
  updated: boolean;
};

function getStatusIcon(status: string): string {
  switch (status) {
    case 'completed':
      return '✅';
    case 'in_progress':
      return '🔄';
    case 'pending':
      return '⏳';
    default:
      return '❓';
  }
}

function getPriorityColor(priority: string): string {
  switch (priority) {
    case 'high':
      return 'red';
    case 'medium':
      return 'yellow';
    case 'low':
      return 'green';
    default:
      return 'white';
  }
}

export function renderToolUseMessage(
  input: Partial<{ todos: TodoItem[] }>,
  _options: { verbose: boolean }
): React.ReactNode {
  const count = input.todos?.length || 0;
  return <Text dimColor>更新任务列表 ({count} 项)...</Text>;
}

export function renderToolResultMessage(
  output: TodoWriteOutput,
  _progressMessages: any[],
  _options: { verbose: boolean }
): React.ReactNode {
  const { todos, updated } = output;

  return (
    <Box flexDirection="column">
      <Text bold color={updated ? 'green' : 'yellow'}>
        {updated ? '任务列表已更新' : '任务列表未变更'}
      </Text>
      {todos && todos.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          {todos.map((todo, index) => (
            <Box key={index}>
              <Text>
                {getStatusIcon(todo.status)}{' '}
                <Text color={getPriorityColor(todo.priority)}>
                  [{todo.priority}]
                </Text>{' '}
                {todo.content}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">任务列表更新失败: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ todos: TodoItem[] }> | undefined
): string | null {
  if (!input?.todos || input.todos.length === 0) return null;
  const total = input.todos.length;
  const completed = input.todos.filter((t) => t.status === 'completed').length;
  return `任务列表: ${completed}/${total} 已完成`;
}
