import React from 'react'
import { Box, Text } from '../../ink.js'

export type PeersOutput = {
  peers?: Array<{ name: string; team: string; status: string }>
  count?: number
}

export function renderToolUseMessage(
  _input: Record<string, unknown>,
  _options: { verbose: boolean },
): React.ReactNode {
  return <Text dimColor>Listing peers...</Text>
}

export function renderToolResultMessage(
  output: PeersOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { peers, count } = output

  if (verbose && peers && peers.length > 0) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text bold>{count ?? peers.length}</Text>
          <Text> peer{peers.length !== 1 ? 's' : ''} connected</Text>
        </Box>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {peers.map((peer, i) => (
            <Box key={i} flexDirection="row">
              <Text dimColor>• {peer.name}</Text>
              {peer.team ? <Text dimColor> [{peer.team}]</Text> : null}
              {peer.status ? <Text dimColor> - {peer.status}</Text> : null}
            </Box>
          ))}
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      <Text bold>{count ?? peers?.length ?? 0}</Text>
      <Text> peer{peers?.length !== 1 ? 's' : ''} connected</Text>
    </Box>
  )
}

export function getToolUseSummary(
  _input: Record<string, unknown> | undefined,
): string | null {
  return 'List peers'
}
