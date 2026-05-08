// import React from 'react'
import { Box, Text } from 'ink'

export type PushNotificationOutput = {
  id: string
  title: string
  body: string
  url?: string
  createdAt: number
  read: boolean
}

export function renderToolUseMessage(
  input: Partial<{ title: string; body: string }>,
  _options: { verbose: boolean },
): React.ReactNode {
  return <Text dimColor>推送通知: {input.title || ''}</Text>
}

export function renderToolResultMessage(
  output: PushNotificationOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color="green">✓ </Text>
        <Text bold>{output.title}</Text>
      </Box>
      {verbose ? (
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>{output.body}</Text>
          {output.url ? (
            <Box marginTop={1}>
              <Text dimColor>链接: {output.url}</Text>
            </Box>
          ) : null}
        </Box>
      ) : (
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>{output.body.slice(0, 80)}</Text>
        </Box>
      )}
    </Box>
  )
}

export function getToolUseSummary(
  input: Partial<{ title: string }> | undefined,
): string | null {
  if (!input?.title) return 'Notification'
  return input.title.slice(0, 40)
}
