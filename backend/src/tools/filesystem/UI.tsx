import React from 'react'
import { Box, Text } from '../../ink.js'

export type FileEditOutput = {
  filePath?: string
  oldContent?: string
  newContent?: string
  diff?: string
  created?: boolean
  linesChanged?: number
}

export function renderToolUseMessage(
  input: Partial<{ file_path: string; old_string: string; new_string: string }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { file_path, old_string, new_string } = input
  if (!file_path) return null

  const isNew = !old_string
  const operation = isNew ? 'Create' : 'Update'

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Text bold>{operation}: {file_path}</Text>
        {!isNew && old_string ? (
          <Text dimColor>Replacing: {old_string.slice(0, 60)}</Text>
        ) : null}
      </Box>
    )
  }

  return <Text>{file_path}</Text>
}

export function renderToolResultMessage(
  output: FileEditOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { filePath, created, linesChanged, diff } = output

  if (created) {
    return <Text>Created: {filePath}</Text>
  }

  if (verbose && diff) {
    const diffLines = diff.split('\n')
    return (
      <Box flexDirection="column">
        <Text>Updated: {filePath} ({linesChanged ?? 0} lines changed)</Text>
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>{diffLines.slice(0, 30).join('\n')}</Text>
        </Box>
      </Box>
    )
  }

  return <Text>Updated: {filePath} ({linesChanged ?? 0} lines changed)</Text>
}

export function renderToolUseRejectedMessage(
  _input: any,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  return <Text dimColor>Edit rejected</Text>
}

export function getToolUseSummary(
  input: Partial<{ file_path: string }> | undefined,
): string | null {
  if (!input?.file_path) return null
  return input.file_path
}
