// import React from 'react'
import { Box, Text } from 'ink'

export type SendMessageOutput = {
  targetTeam?: string
  targetAgent?: string
  message?: string
  delivered?: boolean
}

export function renderToolUseMessage(
  input: Partial<{ team_name: string; agent_name: string; message: string }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { team_name, agent_name, message } = input

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>Message</Text>
          {team_name ? <Text bold> → {team_name}</Text> : null}
          {agent_name ? <Text dimColor>.{agent_name}</Text> : null}
        </Box>
        {message ? (
          <Box marginTop={1} marginLeft={2}>
            <Text dimColor>{message.slice(0, 100)}</Text>
          </Box>
        ) : null}
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      <Text dimColor>→ </Text>
      <Text>{team_name || agent_name || 'peer'}</Text>
    </Box>
  )
}

export function renderToolResultMessage(
  output: SendMessageOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { delivered } = output

  if (delivered) {
    return (
      <Box flexDirection="row">
        <Text color="green">✓ </Text>
        <Text dimColor>Message delivered</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      <Text dimColor>Message sent</Text>
    </Box>
  )
}

export function getToolUseSummary(
  input: Partial<{ team_name: string; message: string }> | undefined,
): string | null {
  if (!input) return 'Message'
  return input.message?.slice(0, 40) || `→ ${input.team_name || 'peer'}`
}
