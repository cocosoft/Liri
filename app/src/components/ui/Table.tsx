/**
 * Table组件 - 表格显示（含排序支持）
 */

import React, { useMemo } from 'react';
import { Text, Box } from '../ink.js';

type Alignment = 'left' | 'center' | 'right';
type SortDirection = 'asc' | 'desc';

export interface TableColumn {
  header: string;
  key: string;
  width?: number;
  align?: Alignment;
  /** 是否可排序 */
  sortable?: boolean;
}

export interface TableProps {
  columns: TableColumn[];
  data: Record<string, string | number>[];
  showHeader?: boolean;
  showBorder?: boolean;
  headerColor?: string;
  rowColor?: string;
  alternateRowColor?: string;
  /** 当前排序列 (key) */
  sortKey?: string;
  /** 排序方向 */
  sortDirection?: SortDirection;
  /** 空数据提示 */
  emptyText?: string;
}

const SORT_INDICATORS: Record<SortDirection, string> = {
  asc: ' ▲',
  desc: ' ▼',
};

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
  sortKey,
  sortDirection,
  emptyText = '(无数据)',
}: TableProps): React.ReactNode {
  const sortedData = useMemo(() => {
    if (!sortKey || !sortDirection) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return data;

    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...data].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (typeof va === 'number' && typeof vb === 'number') {
        return (va - vb) * dir;
      }
      return String(va ?? '').localeCompare(String(vb ?? '')) * dir;
    });
  }, [data, sortKey, sortDirection, columns]);

  const columnWidths = columns.map((col) => {
    if (col.width) return col.width;
    const headerLen = col.header.length;
    const maxDataLen = Math.max(
      ...sortedData.map((row) => String(row[col.key] ?? '').length),
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

  const headerValues = columns.map((col) => {
    let label = col.header;
    if (sortKey === col.key && sortDirection) {
      label += SORT_INDICATORS[sortDirection];
    } else if (col.sortable) {
      label += '  ';
    }
    return label;
  });

  if (sortedData.length === 0) {
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
      {sortedData.map((row, idx) => {
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
