// @ts-nocheck
import React from 'react'
import { Box, Text } from '../../ink.js'

export type TungstenOutput = {
  action: string
  session_id?: string
  session_name?: string
  sessions?: any[]
  message: string
}

export function renderToolUseMessage(
  input: Partial<{ action: string; session_name: string }>,
  _options: { verbose: boolean },
): React.ReactNode {
  const { action, session_name } = input
  return <Text dimColor>终端: {action}{session_name ? ` ${session_name}` : ''}</Text>
}

export function renderToolResultMessage(
  output: TungstenOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { action, session_name, sessions, message } = output

  if (sessions) {
    return (
      <Box flexDirection="column">
        <Text color="green">✓ {sessions.length} 个终端会话</Text>
        {verbose && sessions.map((s, i) => (
          <Box key={i} marginTop={1} marginLeft={2}>
            <Text>{s.name || s.id}</Text>
            <Text dimColor> ({s.id})</Text>
          </Box>
        ))}
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text dimColor>{message}</Text>
      {session_name ? <Text bold> {session_name}</Text> : null}
    </Box>
  )
}

export function getToolUseSummary(
  input: Partial<{ action: string; session_name: string }> | undefined,
): string | null {
  if (!input?.action) return null
  return `${input.action}${input.session_name ? `: ${input.session_name}` : ''}`
}
