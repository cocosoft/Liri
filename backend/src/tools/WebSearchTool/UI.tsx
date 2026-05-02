import React from 'react'
import { Box, Text } from '../../ink.js'

export type WebSearchOutput = {
  query?: string
  results?: Array<{ title: string; url: string; snippet: string }>
  resultCount?: number
}

export function renderToolUseMessage(
  input: Partial<{ query: string }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { query } = input
  if (!query) return null

  if (verbose) {
    return (
      <Box flexDirection="row">
        <Text dimColor>Searching the web for </Text>
        <Text bold>{query}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      <Text dimColor>Web search: </Text>
      <Text bold>{query.slice(0, 60)}</Text>
    </Box>
  )
}

export function renderToolResultMessage(
  output: WebSearchOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { query, resultCount, results } = output

  if (verbose && results && results.length > 0) {
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{resultCount ?? results.length}</Text> results for <Text italic>{query}</Text>
        </Text>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {results.slice(0, 5).map((r, i) => (
            <Box key={i} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
              <Text bold>{r.title}</Text>
              <Text dimColor>{r.url}</Text>
              <Text>{r.snippet?.slice(0, 200)}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  }

  return (
    <Text>
      <Text bold>{resultCount ?? results?.length ?? 0}</Text> search results for <Text italic>{query}</Text>
    </Text>
  )
}

export function renderToolUseErrorMessage(
  error: string,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!verbose) {
    return <Text color="red">Search failed</Text>
  }
  return <Text color="red">Search failed: {error}</Text>
}

export function getToolUseSummary(
  input: Partial<{ query: string }> | undefined,
): string | null {
  if (!input?.query) return null
  return `Web search: ${input.query.slice(0, 60)}`
}
