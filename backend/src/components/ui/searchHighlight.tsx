//
import React from 'react'
import { Text } from '../../ink.js'

export function highlightText(
  text: string,
  query: string,
  baseColor: string = 'white',
  highlightColor: string = 'yellow',
): React.ReactNode {
  if (!query || query.length === 0) {
    return React.createElement(Text, { color: baseColor }, text)
  }

  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let searchFrom = 0
  let keyIndex = 0

  while (searchFrom < lowerText.length) {
    const foundIdx = lowerText.indexOf(lowerQuery, searchFrom)
    if (foundIdx === -1) break

    if (foundIdx > lastIndex) {
      parts.push(
        React.createElement(Text, { key: `t_${keyIndex++}`, color: baseColor },
          text.slice(lastIndex, foundIdx),
        ),
      )
    }

    parts.push(
      React.createElement(Text, {
        key: `h_${keyIndex++}`,
        color: highlightColor,
        inverse: true,
      }, text.slice(foundIdx, foundIdx + query.length)),
    )

    lastIndex = foundIdx + query.length
    searchFrom = foundIdx + 1
  }

  if (lastIndex < text.length) {
    parts.push(
      React.createElement(Text, { key: `t_${keyIndex++}`, color: baseColor },
        text.slice(lastIndex),
      ),
    )
  }

  if (parts.length === 0) {
    return React.createElement(Text, { color: baseColor }, text)
  }

  return React.createElement(Text, null, ...parts)
}

export function searchHighlightLines(
  lines: string[],
  query: string,
  baseColor: string = 'white',
  highlightColor: string = 'yellow',
  maxLines: number = 50,
): Array<{ line: React.ReactNode; index: number }> {
  const lowerQuery = query.toLowerCase()
  const result: Array<{ line: React.ReactNode; index: number }> = []

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(lowerQuery)) {
      result.push({
        line: highlightText(lines[i], query, baseColor, highlightColor),
        index: i,
      })
      if (result.length >= maxLines) break
    }
  }

  return result
}

export function findSearchMatches(
  text: string,
  query: string,
  textColor: string = 'white',
  matchColor: string = 'green',
): Array<{ start: number; end: number; text: string }> {
  if (!query) return []
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const matches: Array<{ start: number; end: number; text: string }> = []
  let from = 0

  while (from < lowerText.length) {
    const idx = lowerText.indexOf(lowerQuery, from)
    if (idx === -1) break
    matches.push({
      start: idx,
      end: idx + query.length,
      text: text.slice(idx, idx + query.length),
    })
    from = idx + 1
  }

  return matches
}
