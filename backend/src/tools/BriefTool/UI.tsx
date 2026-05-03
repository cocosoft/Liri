// @ts-nocheck
import React from 'react'
import { Box, Text } from '../../ink.js'

export type BriefOutput = {
  fileCount?: number
  contentSummary?: string
  attachments?: Array<{ name: string; type: string }>
  result?: string
}

export function renderToolUseMessage(
  input: Partial<{ description: string; include_patterns: string[] }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (verbose) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>Preparing brief</Text>
          {input.include_patterns?.length ? (
            <Text dimColor> (patterns: {input.include_patterns.join(', ')})</Text>
          ) : null}
        </Box>
      </Box>
    )
  }

  return <Text dimColor>Preparing brief...</Text>
}

export function renderToolResultMessage(
  output: BriefOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { fileCount, contentSummary, attachments, result } = output

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ Brief ready</Text>
          {fileCount !== undefined ? (
            <Text dimColor> ({fileCount} file{fileCount !== 1 ? 's' : ''})</Text>
          ) : null}
        </Box>
        {attachments?.length ? (
          <Box marginTop={1} marginLeft={2} flexDirection="column">
            {attachments.map((a, i) => (
              <Box key={i} flexDirection="row">
                <Text dimColor>📎 </Text>
                <Text>{a.name}</Text>
                <Text dimColor> [{a.type}]</Text>
              </Box>
            ))}
          </Box>
        ) : null}
        {contentSummary ? (
          <Box marginTop={1} marginLeft={2}>
            <Text dimColor>{contentSummary.slice(0, 300)}</Text>
          </Box>
        ) : null}
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text>Brief ready</Text>
      {fileCount !== undefined ? (
        <Text dimColor> ({fileCount} file{fileCount !== 1 ? 's' : ''})</Text>
      ) : null}
    </Box>
  )
}

export function getToolUseSummary(
  input: Partial<{ description: string }> | undefined,
): string | null {
  if (!input?.description) return 'Brief'
  return input.description.slice(0, 60)
}
