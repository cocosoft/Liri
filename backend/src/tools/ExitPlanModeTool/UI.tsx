// import React from 'react'
import { Box, Text } from 'ink'

export type ExitPlanModeOutput = {
  success: boolean
  message: string
  mode: string
}

export function renderToolUseMessage(
  _input: Record<string, never>,
  _options: { verbose: boolean },
): React.ReactNode {
  return <Text dimColor>退出计划模式...</Text>
}

export function renderToolResultMessage(
  output: ExitPlanModeOutput,
  _progressMessages: any[],
  _options: { verbose: boolean },
): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text color={output.success ? 'green' : 'red'}>
        {output.success ? '✅ 已退出计划模式' : '❌ 退出计划模式失败'}
      </Text>
      {output.message ? (
        <Box marginTop={1}>
          <Text dimColor>{output.message}</Text>
        </Box>
      ) : null}
    </Box>
  )
}
