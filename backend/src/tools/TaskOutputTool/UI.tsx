// import React from 'react'
import { Box, Text } from 'ink'

export type TaskOutputResult = {
  retrieval_status: 'success' | 'timeout' | 'not_ready'
  task: {
    task_id: string
    task_type: string
    status: string
    description: string
    output: string
    exitCode?: number | null
    error?: string
    prompt?: string
    result?: string
  } | null
}

export function renderToolUseMessage(
  input: Partial<{ task_id: string; block: boolean }>,
  _options: { verbose: boolean },
): React.ReactNode {
  const { task_id, block } = input
  return <Text dimColor>获取任务输出: {task_id}{block ? ' (阻塞模式)' : ''}</Text>
}

export function renderToolResultMessage(
  output: TaskOutputResult,
  _progressMessages: any[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { retrieval_status, task } = output

  if (!task) {
    return <Text color="red">任务未找到</Text>
  }

  const statusColor = task.status === 'completed' || task.status === 'success' ? 'green'
    : task.status === 'failed' || task.status === 'error' ? 'red'
    : 'yellow'

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color="green">✓ </Text>
        <Text>任务 {task.task_id}</Text>
        <Text color={statusColor} bold> [{task.status}]</Text>
        {task.exitCode !== undefined && task.exitCode !== null ? (
          <Text dimColor> exit={task.exitCode}</Text>
        ) : null}
      </Box>
      <Box marginTop={1} marginLeft={2} flexDirection="column">
        <Text dimColor>{task.description}</Text>
        {verbose && task.output ? (
          <Box marginTop={1}>
            <Text dimColor>{task.output.slice(0, 500)}</Text>
          </Box>
        ) : null}
        {task.error ? (
          <Box marginTop={1}>
            <Text color="red">{task.error}</Text>
          </Box>
        ) : null}
      </Box>
      {retrieval_status === 'timeout' ? (
        <Box marginTop={1}>
          <Text color="yellow">⏱ 超时: 任务仍在运行</Text>
        </Box>
      ) : null}
    </Box>
  )
}

export function getToolUseSummary(
  input: Partial<{ task_id: string }> | undefined,
): string | null {
  if (!input?.task_id) return null
  return `Task output: ${input.task_id}`
}
