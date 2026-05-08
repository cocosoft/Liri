// import React from 'react'
import { Box, Text } from 'ink'

export type ChronosOutput = {
  cronExpression?: string
  command?: string
  jobId?: string
  nextRunAt?: string
  status?: string
  error?: string
}

export function renderToolUseMessage(
  input: Partial<{ cron_expression: string; command: string; description: string }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { cron_expression, command, description } = input

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>Scheduling: </Text>
          <Text bold>{description || command || 'cron job'}</Text>
        </Box>
        {cron_expression ? (
          <Box marginTop={1} marginLeft={2}>
            <Text dimColor>Cron: {cron_expression}</Text>
          </Box>
        ) : null}
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      <Text dimColor>Cron: </Text>
      <Text bold>{cron_expression || 'scheduled'}</Text>
    </Box>
  )
}

export function renderToolResultMessage(
  output: ChronosOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { jobId, cronExpression, nextRunAt, status, error } = output

  if (error) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="red">✗ Cron job failed</Text>
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text color="red">{error.slice(0, 300)}</Text>
        </Box>
      </Box>
    )
  }

  if (status === 'deleted') {
    return (
      <Box flexDirection="row">
        <Text color="yellow">✓ </Text>
        <Text>Cron job deleted</Text>
        {jobId ? <Text dimColor> [{jobId}]</Text> : null}
      </Box>
    )
  }

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ </Text>
          <Text>Scheduled</Text>
          {jobId ? <Text dimColor> [{jobId}]</Text> : null}
        </Box>
        {cronExpression ? (
          <Box marginLeft={2}>
            <Text dimColor>{cronExpression}</Text>
          </Box>
        ) : null}
        {nextRunAt ? (
          <Box marginLeft={2}>
            <Text dimColor>Next: {nextRunAt}</Text>
          </Box>
        ) : null}
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text>Scheduled</Text>
      {jobId ? <Text dimColor> [{jobId}]</Text> : null}
    </Box>
  )
}

export function getToolUseSummary(
  input: Partial<{ cron_expression: string; command: string; description: string }> | undefined,
): string | null {
  if (!input) return 'Cron job'
  return input.description?.slice(0, 50) || input.command?.slice(0, 50) || 'Cron job'
}
