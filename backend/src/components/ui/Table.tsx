/**
 * Table组件 - 表格显示
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
}

function padText(
  text: string,
  width: number,
  align: Alignment = 'left'
): string {
  const padding = width - text.length;
  if (padding <= 0) return text.substring(0, width);

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
}: TableProps): React.ReactNode {
  const columnWidths = columns.map((col) => {
    if (col.width) return col.width;
    const headerLen = col.header.length;
    const maxDataLen = Math.max(
      ...data.map((row) => String(row[col.key] ?? '').length),
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
      <Box key={values.join('-')}>
        <Text>│</Text>
        {cells}
        <Text>│</Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column">
      {showBorder && <Text dimColor>{getBorderLine(totalWidth)}</Text>}
      {showHeader &&
        renderRow(
          columns.map((c) => c.header),
          headerColor,
          true
        )}
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
