// @ts-nocheck
import React from 'react'
import { Box, Text } from '../../ink.js'

export function renderToolUseMessage(
  input: Partial<{ setting_name: string; setting_value: string }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { setting_name, setting_value } = input

  if (verbose && setting_name && setting_value !== undefined) {
    return (
      <Box flexDirection="row">
        <Text dimColor>Config: </Text>
        <Text bold>{setting_name}</Text>
        <Text> = </Text>
        <Text bold>{String(setting_value).slice(0, 60)}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      <Text dimColor>Config: </Text>
      <Text bold>{setting_name || 'settings'}</Text>
    </Box>
  )
}

export function renderToolResultMessage(
  output: Partial<{ setting: string; value: string; status: string }>,
  _progressMessages: any[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { setting, value, status } = output

  if (status === 'error') {
    return (
      <Box flexDirection="row">
        <Text color="red">✗ Config update failed</Text>
      </Box>
    )
  }

  if (verbose && setting && value !== undefined) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ </Text>
          <Text>{setting} updated</Text>
        </Box>
        <Box marginLeft={2}>
          <Text dimColor>= {String(value).slice(0, 100)}</Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text>{setting || 'Config'} updated</Text>
    </Box>
  )
}

export function getToolUseSummary(
  input: Partial<{ setting_name: string }> | undefined,
): string | null {
  if (!input?.setting_name) return 'Config update'
  return `Config: ${input.setting_name}`
}
