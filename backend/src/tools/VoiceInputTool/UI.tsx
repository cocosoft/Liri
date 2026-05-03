// @ts-nocheck
import React from 'react'
import { Box, Text } from '../../ink.js'

export type VoiceInputResult = {
  action: string
  text?: string
  message: string
  duration?: number
}

export function renderToolUseMessage(
  input: Partial<{ action: string; language: string }>,
  _options: { verbose: boolean },
): React.ReactNode {
  const { action, language } = input
  if (action === 'start') {
    return <Text dimColor>开始语音识别{language ? ` (${language})` : ''}...</Text>
  }
  if (action === 'stop') {
    return <Text dimColor>停止语音识别...</Text>
  }
  return <Text dimColor>检查语音识别状态...</Text>
}

export function renderToolResultMessage(
  output: VoiceInputResult,
  _progressMessages: any[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { action, text, message } = output

  if (action === 'stop' && text) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ </Text>
          <Text dimColor>语音识别结果</Text>
        </Box>
        {verbose ? (
          <Box marginTop={1} marginLeft={2}>
            <Text>{text}</Text>
          </Box>
        ) : (
          <Box marginTop={1} marginLeft={2}>
            <Text dimColor>{text.slice(0, 100)}{text.length > 100 ? '...' : ''}</Text>
          </Box>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text dimColor>{message}</Text>
    </Box>
  )
}

export function getToolUseSummary(
  input: Partial<{ action: string }> | undefined,
): string | null {
  if (!input?.action) return null
  return `语音 ${input.action}`
}
