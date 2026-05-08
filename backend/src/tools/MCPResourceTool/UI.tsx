// import React from 'react'
import { Box, Text } from 'ink'

export type MCPOutput = {
  serverName?: string
  toolName?: string
  result?: string
  error?: string
  duration?: number
}

export function renderToolUseMessage(
  input: Partial<{ server_name: string; tool_name: string; arguments?: Record<string, unknown> }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { server_name, tool_name } = input

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>MCP: </Text>
          <Text bold>{server_name || 'server'}</Text>
          {tool_name ? <Text bold>.{tool_name}</Text> : null}
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      <Text dimColor>MCP: </Text>
      <Text bold>{tool_name || server_name || 'call'}</Text>
    </Box>
  )
}

export function renderToolResultMessage(
  output: MCPOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { serverName, toolName, result, error, duration } = output

  if (error) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="red">✗ MCP call failed</Text>
          {toolName ? <Text dimColor> [{toolName}]</Text> : null}
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text color="red">{error.slice(0, 300)}</Text>
        </Box>
      </Box>
    )
  }

  if (verbose && result) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ </Text>
          <Text>MCP {toolName || 'call'} completed</Text>
          {duration !== undefined ? (
            <Text dimColor> ({duration}ms)</Text>
          ) : null}
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>{result.slice(0, 500)}</Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text>MCP {toolName || 'call'} completed</Text>
    </Box>
  )
}

export function getToolUseSummary(
  input: Partial<{ server_name: string; tool_name: string }> | undefined,
): string | null {
  if (!input) return 'MCP call'
  return `MCP: ${input.tool_name || input.server_name || 'call'}`
}
