import React from 'react'
import { Box, Text } from '../../ink.js'

export type AgentOutput = {
  agentType?: string
  agentName?: string
  description?: string
  result?: string
  error?: string
  tokenUsage?: { input: number; output: number }
  duration?: number
  completed?: boolean
}

export function renderToolUseMessage(
  input: Partial<{ description: string; subagent_type: string; name: string }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { description, subagent_type, name } = input
  const label = name || subagent_type || 'Agent'

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>Agent: </Text>
          <Text bold>{label}</Text>
          {subagent_type ? <Text dimColor> [{subagent_type}]</Text> : null}
        </Box>
        {description ? (
          <Box marginTop={1} marginLeft={2}>
            <Text dimColor>{description.slice(0, 100)}</Text>
          </Box>
        ) : null}
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      <Text dimColor>Agent: </Text>
      <Text bold>{label}</Text>
      {subagent_type ? <Text dimColor> [{subagent_type}]</Text> : null}
    </Box>
  )
}

export function renderToolResultMessage(
  output: AgentOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { agentType, agentName, error, result, tokenUsage, duration, completed } = output
  const label = agentName || agentType || 'Agent'

  if (error) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="red">✗ {label} failed</Text>
          {duration ? <Text dimColor> ({formatMs(duration)})</Text> : null}
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text color="red">{error.slice(0, 300)}</Text>
        </Box>
      </Box>
    )
  }

  if (verbose && result) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ {label} completed</Text>
          {duration ? <Text dimColor> ({formatMs(duration)})</Text> : null}
          {tokenUsage ? (
            <Text dimColor>
              {' '}Tokens: {tokenUsage.input}↑ {tokenUsage.output}↓
            </Text>
          ) : null}
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>{result.slice(0, 500)}</Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text>{label} completed</Text>
      {duration ? <Text dimColor> ({formatMs(duration)})</Text> : null}
      {tokenUsage ? (
        <Text dimColor>
          {' '}Tokens: {tokenUsage.input}↑ {tokenUsage.output}↓
        </Text>
      ) : null}
    </Box>
  )
}

export function renderToolUseProgressMessage(
  data: Partial<{ message: string; progress: number }>,
): React.ReactNode {
  const { message, progress } = data
  return (
    <Box flexDirection="row">
      <Text dimColor>Agent working</Text>
      {progress !== undefined ? (
        <Text dimColor> [{Math.round(progress * 100)}%]</Text>
      ) : null}
      {message ? <Text dimColor> - {message.slice(0, 80)}</Text> : null}
    </Box>
  )
}

export function getToolUseSummary(
  input: Partial<{ description: string; subagent_type: string; name: string }> | undefined,
): string | null {
  if (!input) return null
  const label = input.name || input.subagent_type || 'Agent'
  return input.description ? `${label}: ${input.description.slice(0, 60)}` : label
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60000)
  const secs = Math.round((ms % 60000) / 1000)
  return `${mins}m ${secs}s`
}
