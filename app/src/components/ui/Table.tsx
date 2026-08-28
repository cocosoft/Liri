/**
 * Table组件 - 终端表格显示
 */

import React from 'react';
import { Text, Box } from '../ink.js';

type Alignment = 'left' | 'center' | 'right';

export interface TableColumn {
  header: string;
  key: string;
  width?: number;
  align?: Alignment;
}

export interface TableProps {
  columns: TableColumn[];
  data: Record<string, string | number>[];
  showHeader?: boolean;
  showBorder?: boolean;
  headerColor?: string;
  rowColor?: string;
  alternateRowColor?: string;
  /** 空数据提示 */
  emptyText?: string;
}

/** 终端显示宽度：CJK 全角字符按 2 列计（表格对齐的关键） */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    // 中文/日文/韩文全角字符及其扩展区
    w +=
      /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(
        ch
      )
        ? 2
        : 1;
  }
  return w;
}

/** 按显示宽度截断，避免截断多字节字符；截断时以省略号结尾 */
export function truncateToWidth(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  let w = 0;
  let out = '';
  for (const ch of text) {
    const cw = displayWidth(ch);
    if (w + cw > width - 1) break;
    w += cw;
    out += ch;
  }
  return out + '…';
}

function padText(
  text: string,
  width: number,
  align: Alignment = 'left'
): string {
  const padding = width - displayWidth(text);
  if (padding <= 0) return text;

  switch (align) {
    case 'left':
      return text + ' '.repeat(padding);
    case 'center': {
      const leftPad = Math.floor(padding / 2);
      const rightPad = padding - leftPad;
      return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
    }
    case 'right':
      return ' '.repeat(padding) + text;
    default:
      return text + ' '.repeat(padding);
  }
}

function getBorderLine(totalWidth: number): string {
  return '─'.repeat(totalWidth);
}

export function Table({
  columns,
  data,
  showHeader = true,
  showBorder = true,
  headerColor = 'cyan',
  rowColor = 'white',
  alternateRowColor,
  emptyText = '(无数据)',
}: TableProps): React.ReactNode {
  const columnWidths = columns.map((col) => {
    if (col.width) return col.width;
    const headerLen = displayWidth(col.header);
    const maxDataLen = Math.max(
      ...data.map((row) => displayWidth(String(row[col.key] ?? ''))),
      0
    );
    return Math.max(headerLen, maxDataLen) + 2;
  });

  const totalWidth =
    columnWidths.reduce((sum, w) => sum + w, 0) + columns.length + 1;

  const renderRow = (
    values: string[],
    color: string,
    isHeader = false
  ): React.ReactNode => {
    const cells = values.map((val, idx) => {
      const col = columns[idx];
      const width = columnWidths[idx];
      const align = col.align || 'left';
      const padded = padText(val, width, align);
      return (
        <Text key={idx} color={color} bold={isHeader}>
          {padded}
        </Text>
      );
    });

    return (
      <Box>
        <Text>│</Text>
        {cells}
        <Text>│</Text>
      </Box>
    );
  };

  const headerValues = columns.map((col) => col.header);

  if (data.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>{emptyText}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {showBorder && <Text dimColor>{getBorderLine(totalWidth)}</Text>}
      {showHeader && renderRow(headerValues, headerColor, true)}
      {showBorder && <Text dimColor>{getBorderLine(totalWidth)}</Text>}
      {data.map((row, idx) => {
        const values = columns.map((col) => String(row[col.key] ?? ''));
        const color =
          alternateRowColor && idx % 2 === 1 ? alternateRowColor : rowColor;
        return (
          <React.Fragment key={idx}>{renderRow(values, color)}</React.Fragment>
        );
      })}
      {showBorder && <Text dimColor>{getBorderLine(totalWidth)}</Text>}
    </Box>
  );
}
