//
import React, { useState } from 'react'
import { Box, Text } from '../../ink.js'

interface ThinkingBlockProps {
  thinking: string
  effort?: 'low' | 'medium' | 'high'
  budgetTokens?: number
  color?: string
  defaultExpanded?: boolean
}

export function ThinkingBlock({
  thinking,
  effort,
  budgetTokens,
  color = 'gray',
  defaultExpanded = false,
}: ThinkingBlockProps): React.ReactNode {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const isPressed = React.useRef(false)

  const toggle = () => {
    setExpanded(prev => !prev)
  }

  const handleClick = React.useCallback(() => {
    isPressed.current = true
    toggle()
    setTimeout(() => { isPressed.current = false }, 100)
  }, [])

  const lines = thinking.split('\n')
  const previewLines = expanded ? lines : lines.slice(0, 3)
  const hasMore = lines.length > 3
  const estimatedTokens = Math.ceil(thinking.length / 4)

  const headerParts: string[] = ['Thinking']
  if (effort) headerParts.push(`effort: ${effort}`)
  if (estimatedTokens) headerParts.push(`~${estimatedTokens} tokens`)
  if (budgetTokens) headerParts.push(`budget: ${budgetTokens}`)

  const header = headerParts.join(' · ')

  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Box, { flexDirection: 'row', onClick: handleClick },
      React.createElement(Text, { color: 'cyan', dimColor: true },
        expanded ? '▼' : '▶',
      ),
      React.createElement(Text, { color: 'cyan', dimColor: true }, ` ${header}`),
    ),
    ...(expanded ? [
      React.createElement(Text, { key: 'sep', color: 'gray', dimColor: true }, '┌─ thinking ─'.padEnd(40, '─')),
      ...previewLines.map((line, i) =>
        React.createElement(Text, { key: `t_${i}`, color, dimColor: true }, `│ ${line}`),
      ),
      ...(hasMore && expanded ? [
        React.createElement(Text, { key: 'more', color: 'cyan', dimColor: true },
          `│ ... (${lines.length - previewLines.length} more lines)`,
        ),
      ] : []),
      React.createElement(Text, { key: 'end', color: 'gray', dimColor: true }, '└'.padEnd(40, '─')),
    ] : [
      ...(previewLines.length > 0 ? [
        React.createElement(Text, { key: 'preview', color, dimColor: true },
          `  ${previewLines[0]?.slice(0, 80)}${(previewLines[0]?.length || 0) > 80 ? '...' : ''}`,
        ),
        hasMore ? React.createElement(Text, {
          key: 'ellipsis',
          color: 'gray',
          dimColor: true,
        }, `  ... (${lines.length} lines total)`) : null,
      ] : []),
    ]),
  )
}

interface RedactedThinkingBlockProps {
  data: string
  color?: string
}

export function RedactedThinkingBlock({
  data,
  color = 'gray',
}: RedactedThinkingBlockProps): React.ReactNode {
  const preview = data.slice(0, 100)

  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Text, { color: 'yellow', dimColor: true }, '▶ Thinking (redacted)'),
    React.createElement(Text, { color, dimColor: true }, `  ${preview}${data.length > 100 ? '...' : ''}`),
  )
}
