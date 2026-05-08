// import React from 'react'
import { Box, Text } from 'ink'

export type SubscribePROutput = {
  id: string
  repo: string
  prNumber?: number
  events: string[]
  createdAt: number
  active: boolean
}

export function renderToolUseMessage(
  input: Partial<{ repo: string; prNumber: number }>,
  _options: { verbose: boolean },
): React.ReactNode {
  const { repo, prNumber } = input
  return <Text dimColor>订阅PR: {repo}{prNumber ? ` #${prNumber}` : ''}</Text>
}

export function renderToolResultMessage(
  output: SubscribePROutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color="green">✓ </Text>
        <Text>{output.repo}</Text>
        {output.prNumber ? <Text bold> #{output.prNumber}</Text> : null}
      </Box>
      {verbose && (
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>事件: {output.events.join(', ')}</Text>
        </Box>
      )}
    </Box>
  )
}

export function getToolUseSummary(
  input: Partial<{ repo: string; prNumber: number }> | undefined,
): string | null {
  if (!input?.repo) return null
  return `${input.repo}${input.prNumber ? ` #${input.prNumber}` : ''}`
}
