import React from 'react'
import { Box, Text } from '../../ink.js'

type BorderStyle = 'single' | 'double' | 'round' | 'bold' | 'singleDouble' | 'dashed'

type BorderTextPosition = 'top' | 'bottom'
type BorderTextAlign = 'start' | 'end' | 'center'

interface BorderBoxProps {
  borderStyle?: BorderStyle
  borderColor?: string
  borderText?: string
  borderTextPosition?: BorderTextPosition
  borderTextAlign?: BorderTextAlign
  borderTextOffset?: number
  borderTop?: boolean
  borderBottom?: boolean
  borderLeft?: boolean
  borderRight?: boolean
  dimBorder?: boolean
  children?: React.ReactNode
  width?: number
  height?: number
}

const STYLE_CHARS: Record<BorderStyle, {
  top: string; bottom: string; left: string; right: string
  topLeft: string; topRight: string; bottomLeft: string; bottomRight: string
}> = {
  single: { top: '─', bottom: '─', left: '│', right: '│', topLeft: '┌', topRight: '┐', bottomLeft: '└', bottomRight: '┘' },
  double: { top: '═', bottom: '═', left: '║', right: '║', topLeft: '╔', topRight: '╗', bottomLeft: '╚', bottomRight: '╝' },
  round: { top: '─', bottom: '─', left: '│', right: '│', topLeft: '╭', topRight: '╮', bottomLeft: '╰', bottomRight: '╯' },
  bold: { top: '━', bottom: '━', left: '┃', right: '┃', topLeft: '┏', topRight: '┓', bottomLeft: '┗', bottomRight: '┛' },
  singleDouble: { top: '═', bottom: '═', left: '│', right: '│', topLeft: '╒', topRight: '╕', bottomLeft: '╘', bottomRight: '╛' },
  dashed: { top: '╌', bottom: '╌', left: '╎', right: '╎', topLeft: ' ', topRight: ' ', bottomLeft: ' ', bottomRight: ' ' },
}

export function BorderBox({
  borderStyle = 'single',
  borderColor = 'white',
  borderText,
  borderTextPosition = 'top',
  borderTextAlign = 'center',
  borderTextOffset = 0,
  borderTop = true,
  borderBottom = true,
  borderLeft = true,
  borderRight = true,
  dimBorder = false,
  children,
  width,
  height,
}: BorderBoxProps): React.ReactNode {
  const chars = STYLE_CHARS[borderStyle]
  const boxChildren: React.ReactNode[] = []

  const renderBorderLine = (
    text: string,
    fullWidth: number,
    styleChar: string,
  ): string => {
    if (!text) {
      return borderLeft ? chars.topLeft + styleChar.repeat(Math.max(0, fullWidth - 2)) + chars.topRight
        : styleChar.repeat(fullWidth)
    }
    const availableWidth = Math.max(0, fullWidth - 2)
    if (text.length >= availableWidth) return text.slice(0, availableWidth)
    const space = availableWidth - text.length
    let before: number
    let after: number
    if (borderTextAlign === 'center') {
      before = Math.floor(space / 2)
      after = space - before
    } else if (borderTextAlign === 'start') {
      before = borderTextOffset
      after = space - before
    } else {
      before = space - borderTextOffset
      after = borderTextOffset
    }
    before = Math.max(0, Math.min(before, space))
    after = space - before
    if (borderLeft && borderRight) {
      return chars.topLeft + styleChar.repeat(before) + text + styleChar.repeat(after) + chars.topRight
    }
    return styleChar.repeat(before) + text + styleChar.repeat(after)
  }

  const colorAttr = dimBorder ? 'gray' : borderColor

  if (borderTop && borderText && borderTextPosition === 'top') {
    boxChildren.push(
      React.createElement(Text, { key: 'border-top-text', color: colorAttr },
        renderBorderLine(borderText, width || 40, chars.top),
      ),
    )
  } else if (borderTop) {
    const topLine = borderLeft && borderRight
      ? chars.topLeft + chars.top.repeat(Math.max(0, (width || 40) - 2)) + chars.topRight
      : chars.top.repeat(width || 40)
    boxChildren.push(
      React.createElement(Text, { key: 'border-top', color: colorAttr }, topLine)
    )
  }

  boxChildren.push(
    React.createElement(Box, { key: 'content' }, children)
  )

  if (borderBottom && borderText && borderTextPosition === 'bottom') {
    boxChildren.push(
      React.createElement(Text, { key: 'border-bottom-text', color: colorAttr },
        renderBorderLine(borderText, width || 40, chars.bottom),
      ),
    )
  } else if (borderBottom) {
    const bottomLine = borderLeft && borderRight
      ? chars.bottomLeft + chars.bottom.repeat(Math.max(0, (width || 40) - 2)) + chars.bottomRight
      : chars.bottom.repeat(width || 40)
    boxChildren.push(
      React.createElement(Text, { key: 'border-bottom', color: colorAttr }, bottomLine)
    )
  }

  return React.createElement(Box, { flexDirection: 'column' }, ...boxChildren)
}
