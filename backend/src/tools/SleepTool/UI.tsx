import React from 'react'
import { Box, Text } from '../../ink.js'

export type SleepOutput = {
  duration_ms: number
  elapsed_ms: number
}

export function renderToolUseMessage(
  input: Partial<{ duration_ms: number }>,
  _options: { verbose: boolean },
): React.ReactNode {
  const duration = input.duration_ms || 0
  return <Text dimColor>等待 {duration}ms...</Text>
}

export function renderToolResultMessage(
  output: SleepOutput,
  _progressMessages: any[],
  _options: { verbose: boolean },
): React.ReactNode {
  return (
    <Box>
      <Text dimColor>已等待 {output.elapsed_ms}ms</Text>
    </Box>
  )
}
