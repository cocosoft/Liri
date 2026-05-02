/**
 * Heredoc 处理
 *
 * 处理 Bash heredoc（<<, <<-）语法。
 * 参考 CC源码 cc_code/backend/utils/bash/heredoc.ts
 */

export interface HeredocInfo {
  marker: string
  content: string
  indented: boolean
  quoted: boolean
}

export function extractHeredocs(command: string): {
  processedCommand: string
  heredocs: HeredocInfo[]
} {
  const heredocs: HeredocInfo[] = []
  const heredocPattern = /(<<[-]?)(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2\s*$/gm
  const lines = command.split('\n')
  const processedLines: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!
    const match = heredocPattern.exec(line)

    if (match) {
      const indented = match[1]!.includes('-')
      const quoted = match[2]!.length > 0
      const marker = match[3]!
      const contentLines: string[] = []
      i++

      while (i < lines.length) {
        const contentLine = lines[i]!
        const trimmedLine = indented ? contentLine.trimStart() : contentLine
        if (trimmedLine === marker) {
          i++
          break
        }
        contentLines.push(contentLine)
        i++
      }

      heredocs.push({
        marker,
        content: contentLines.join('\n'),
        indented,
        quoted,
      })

      processedLines.push(line.replace(match[0], ''))
    } else {
      processedLines.push(line)
      i++
    }
  }

  return { processedCommand: processedLines.join('\n'), heredocs }
}

export function restoreHeredocs(command: string, heredocs: HeredocInfo[]): string {
  let result = command
  for (const heredoc of heredocs) {
    const delimiter = heredoc.indented ? '<<-' : '<<'
    const quote = heredoc.quoted ? "'" : ''
    const marker = heredoc.quoted ? `'${heredoc.marker}'` : heredoc.marker
    const body = heredoc.indented
      ? heredoc.content.split('\n').map(l => '\t' + l).join('\n')
      : heredoc.content
    result += ` ${delimiter}${quote}${marker}${quote}\n${body}\n${heredoc.marker}`
  }
  return result
}
