//
import React from 'react';
import { Text, Box } from '../ink.js';
import InlineCodeLink from './InlineCodeLink.js';

interface MarkdownBlockProps {
  content: string;
  color?: string;
  width?: number;
}

export function CodeBlock({
  content,
  color = 'green',
}: MarkdownBlockProps): React.ReactNode {
  const lines = content.split('\n');
  return React.createElement(
    Box,
    { flexDirection: 'column', marginTop: 1, marginBottom: 1 },
    React.createElement(Text, { color: 'gray' }, '┌─────'),
    ...lines.map((line, i) =>
      React.createElement(Text, { key: `c_${i}`, color }, `│ ${line}`)
    ),
    React.createElement(Text, { color: 'gray' }, '└─────')
  );
}

export function DiffBlock({
  content,
  color = 'yellow',
}: MarkdownBlockProps): React.ReactNode {
  const lines = content.split('\n');
  return React.createElement(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    ...lines.map((line, i) => {
      let lineColor = color;
      if (line.startsWith('+')) lineColor = 'green';
      else if (line.startsWith('-')) lineColor = 'red';
      else if (line.startsWith('@@')) lineColor = 'cyan';
      return React.createElement(
        Text,
        { key: `d_${i}`, color: lineColor },
        line
      );
    })
  );
}

interface TableBlockProps {
  headers: string[];
  rows: string[][];
  color?: string;
}

export function TableBlock({
  headers,
  rows,
  color = 'white',
}: TableBlockProps): React.ReactNode {
  const colWidths = headers.map((h, ci) => {
    const maxInRows = rows.reduce(
      (max, row) => Math.max(max, (row[ci] || '').length),
      0
    );
    return Math.max(h.length, maxInRows, 5);
  });

  const pad = (s: string, w: number) => {
    const padLen = Math.max(0, w - s.length);
    return s + ' '.repeat(padLen);
  };

  const separator =
    '│ ' + colWidths.map((w) => '─'.repeat(w)).join(' ┼ ') + ' │';

  return React.createElement(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    React.createElement(
      Text,
      { color: 'cyan' },
      '│ ' + headers.map((h, i) => pad(h, colWidths[i])).join(' │ ') + ' │'
    ),
    React.createElement(Text, { color: 'gray' }, separator),
    ...rows.map((row, ri) =>
      React.createElement(
        Text,
        { key: `tr_${ri}`, color },
        '│ ' +
          row.map((cell, ci) => pad(cell, colWidths[ci] || 0)).join(' │ ') +
          ' │'
      )
    ),
    React.createElement(Text, { color: 'gray' }, separator.replace('┼', '┴'))
  );
}

interface StatsBarProps {
  tokenCount?: number;
  costUSD?: number;
  durationMs?: number;
  modelName?: string;
  thinkingTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  showExtended?: boolean;
}

export function StatsBar({
  tokenCount,
  costUSD,
  durationMs,
  modelName,
  thinkingTokens,
  cacheReadTokens,
  cacheCreationTokens,
  showExtended = false,
}: StatsBarProps): React.ReactNode {
  const parts: string[] = [];

  if (modelName) parts.push(`Model: ${modelName}`);
  if (tokenCount !== undefined) {
    const display =
      tokenCount >= 1000
        ? `${(tokenCount / 1000).toFixed(1)}k`
        : String(tokenCount);
    parts.push(`Tokens: ${display}`);
  }
  if (cacheReadTokens !== undefined && cacheReadTokens > 0) {
    const display =
      cacheReadTokens >= 1000
        ? `${(cacheReadTokens / 1000).toFixed(1)}k`
        : String(cacheReadTokens);
    parts.push(`CR: ${display}`);
  }
  if (cacheCreationTokens !== undefined && cacheCreationTokens > 0) {
    const display =
      cacheCreationTokens >= 1000
        ? `${(cacheCreationTokens / 1000).toFixed(1)}k`
        : String(cacheCreationTokens);
    parts.push(`CW: ${display}`);
  }
  if (thinkingTokens !== undefined && showExtended) {
    parts.push(`Thinking: ${thinkingTokens}`);
  }
  if (costUSD !== undefined && costUSD > 0) {
    parts.push(`Cost: $${costUSD.toFixed(4)}`);
  }
  if (durationMs !== undefined) {
    const sec = (durationMs / 1000).toFixed(1);
    parts.push(`Time: ${sec}s`);
  }

  const text = parts.join('  │  ');

  return React.createElement(
    Box,
    { flexDirection: 'row' },
    React.createElement(Text, { color: 'gray', dimColor: true }, text)
  );
}

/**
 * 将行内文本按反引号分割，识别文件路径并用 InlineCodeLink 渲染
 */
function renderInlineContent(
  text: string,
  knownFilePaths: string[] | undefined,
  onPreviewFile: ((path: string) => void) | undefined,
  keyPrefix: string,
  keyIdx: { current: number }
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        React.createElement(Text, {
          key: `${keyPrefix}_t_${keyIdx.current++}`,
          children: text.slice(lastIndex, match.index),
        })
      );
    }

    parts.push(
      React.createElement(InlineCodeLink, {
        key: `${keyPrefix}_ic_${keyIdx.current++}`,
        codeContent: match[1],
        knownFilePaths,
        onPreviewFile,
      })
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(
      React.createElement(Text, {
        key: `${keyPrefix}_t_${keyIdx.current++}`,
        children: text.slice(lastIndex),
      })
    );
  }

  return parts.length > 0
    ? parts
    : [
        React.createElement(
          Text,
          { key: `${keyPrefix}_t_${keyIdx.current++}` },
          text
        ),
      ];
}

interface MarkdownRendererProps {
  content: string;
  searchQuery?: string;
  knownFilePaths?: string[];
  onPreviewFile?: (path: string) => void;
}

export function MarkdownRenderer({
  content,
  searchQuery,
  knownFilePaths,
  onPreviewFile,
}: MarkdownRendererProps): React.ReactNode {
  const blocks: React.ReactNode[] = [];
  const lines = content.split('\n');

  let i = 0;
  let keyIdx = 0;
  const inlineKey = { current: 0 };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      let codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(
        React.createElement(CodeBlock, {
          key: `cb_${keyIdx++}`,
          content: codeLines.join('\n'),
        })
      );
      continue;
    }

    if (line.startsWith('```diff') || line.startsWith('```diff ')) {
      let diffLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        diffLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(
        React.createElement(DiffBlock, {
          key: `db_${keyIdx++}`,
          content: diffLines.join('\n'),
        })
      );
      continue;
    }

    if (line.startsWith('# ')) {
      blocks.push(
        React.createElement(
          Text,
          { key: `h1_${keyIdx++}`, bold: true, color: 'cyan' },
          line.slice(2)
        )
      );
      i++;
      continue;
    }

    if (line.startsWith('## ')) {
      blocks.push(
        React.createElement(
          Text,
          { key: `h2_${keyIdx++}`, bold: true, color: 'blue' },
          line.slice(3)
        )
      );
      i++;
      continue;
    }

    if (line.startsWith('### ')) {
      blocks.push(
        React.createElement(
          Text,
          { key: `h3_${keyIdx++}`, bold: true },
          line.slice(4)
        )
      );
      i++;
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      const bulletLines: string[] = [];
      while (
        i < lines.length &&
        (lines[i].startsWith('- ') ||
          lines[i].startsWith('* ') ||
          lines[i].startsWith('  '))
      ) {
        bulletLines.push(lines[i]);
        i++;
      }
      blocks.push(
        React.createElement(
          Box,
          { key: `ul_${keyIdx++}`, flexDirection: 'column', marginLeft: 2 },
          ...bulletLines.map((bl, bi) => {
            const trimmed = bl.startsWith('  ') ? '  ' + bl.slice(2) : bl;
            const inlineParts = renderInlineContent(
              trimmed,
              knownFilePaths,
              onPreviewFile,
              `li_${bi}`,
              inlineKey
            );
            return React.createElement(
              Box,
              { key: `li_${bi}`, flexDirection: 'row' as const },
              ...inlineParts
            );
          })
        )
      );
      continue;
    }

    if (line.trim() === '') {
      blocks.push(
        React.createElement(Box, { key: `sp_${keyIdx++}`, height: 1 })
      );
      i++;
      continue;
    }

    // 普通段落：解析其中的反引号内容
    const inlineParts = renderInlineContent(
      line,
      knownFilePaths,
      onPreviewFile,
      `p_${keyIdx}`,
      inlineKey
    );
    if (
      inlineParts.length === 1 &&
      (inlineParts[0] as React.ReactElement)?.type === Text
    ) {
      blocks.push(React.createElement(Text, { key: `p_${keyIdx++}` }, line));
    } else {
      blocks.push(
        React.createElement(
          Box,
          { key: `p_${keyIdx++}`, flexDirection: 'row' as const },
          ...inlineParts
        )
      );
    }
    i++;
  }

  return React.createElement(Box, { flexDirection: 'column' }, ...blocks);
}
