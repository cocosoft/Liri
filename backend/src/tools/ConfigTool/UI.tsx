// import React from 'react'
import { Box, Text } from 'ink'

export function renderToolUseMessage(
  input: Partial<{ action: string; key: string }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { action, key } = input

  if (verbose && key && action) {
    return (
      <Box flexDirection="row">
        <Text dimColor>Config: </Text>
        <Text bold>{action}</Text>
        <Text> </Text>
        <Text bold>{key}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      <Text dimColor>Config: </Text>
      <Text bold>{action || 'settings'}</Text>
    </Box>
  )
}

export function renderToolResultMessage(
  output: Partial<{ success: boolean; output: string; error: string }>,
  _progressMessages: any[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { success, output: resultOutput, error } = output

  if (success === false || error) {
    return (
      <Box flexDirection="row">
        <Text color="red">✗ Config failed: {error || 'unknown error'}</Text>
      </Box>
    )
  }

  if (verbose && resultOutput) {
    const displayText = typeof resultOutput === 'string' ? resultOutput : JSON.stringify(resultOutput)
    const preview = displayText.length > 200 ? displayText.slice(0, 197) + '...' : displayText
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ </Text>
          <Text>Config updated</Text>
        </Box>
        <Box marginLeft={2}>
          <Text dimColor>{preview}</Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text>Config updated</Text>
    </Box>
  )
}

export function getToolUseSummary(
  input: Partial<{ action: string; key: string }> | undefined,
): string | null {
  if (!input?.action) return 'Config update'
  if (input.key) return `Config: ${input.action} ${input.key}`
  return `Config: ${input.action}`
}
