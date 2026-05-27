/**
 * 表格输出工具
 * 用于在命令行中显示表格数据
 */

export interface TableOptions {
  headers: string[];
  rows: string[][];
  align?: ('left' | 'right' | 'center')[];
  border?: boolean;
  padding?: number;
  maxWidth?: number;
  colorizeHeaders?: boolean;
}

export class TableFormatter {
  /**
   * 格式化表格
   */
  static format(options: TableOptions): string {
    const {
      headers,
      rows,
      align = [],
      border = true,
      padding = 2,
      maxWidth = 80,
      colorizeHeaders = true,
    } = options;

    // 计算每列的最大宽度
    const columnWidths = headers.map((_, index) => {
      const headerWidth = headers[index].length;
      const rowWidths = rows.map((row) => row[index]?.length || 0);
      const maxRowWidth = Math.max(...rowWidths);
      return Math.min(
        Math.max(headerWidth, maxRowWidth) + padding * 2,
        maxWidth
      );
    });

    // 构建表格
    let table = '';

    // 添加表头
    if (border) {
      table += TableFormatter.formatBorder(columnWidths, 'top');
    }

    table += TableFormatter.formatRow(
      headers,
      columnWidths,
      align,
      padding,
      colorizeHeaders
    );

    if (border) {
      table += TableFormatter.formatBorder(columnWidths, 'middle');
    }

    // 添加数据行
    for (const row of rows) {
      table += TableFormatter.formatRow(
        row,
        columnWidths,
        align,
        padding,
        false
      );
    }

    if (border) {
      table += TableFormatter.formatBorder(columnWidths, 'bottom');
    }

    return table;
  }

  /**
   * 格式化边框
   */
  private static formatBorder(
    columnWidths: number[],
    type: 'top' | 'middle' | 'bottom'
  ): string {
    const corners = {
      top: { left: '┌', middle: '┬', right: '┐' },
      middle: { left: '├', middle: '┼', right: '┤' },
      bottom: { left: '└', middle: '┴', right: '┘' },
    };

    const corner = corners[type];
    const horizontalLine = columnWidths
      .map((width) => '─'.repeat(width))
      .join(corner.middle);

    return `${corner.left}${horizontalLine}${corner.right}\n`;
  }

  /**
   * 格式化行
   */
  private static formatRow(
    row: string[],
    columnWidths: number[],
    align: ('left' | 'right' | 'center')[],
    padding: number,
    colorize: boolean
  ): string {
    const cells = row.map((cell, index) => {
      const width = columnWidths[index];
      const cellText = cell || '';
      const alignment = align[index] || 'left';

      let formattedCell;
      switch (alignment) {
        case 'left':
          formattedCell = cellText
            .padEnd(width - padding * 2)
            .padStart(width - padding)
            .padEnd(width);
          break;
        case 'right':
          formattedCell = cellText
            .padStart(width - padding * 2)
            .padStart(width - padding)
            .padEnd(width);
          break;
        case 'center':
          const paddingLeft = Math.floor(
            (width - padding * 2 - cellText.length) / 2
          );
          const paddingRight =
            width - padding * 2 - cellText.length - paddingLeft;
          formattedCell =
            ' '.repeat(padding) +
            ' '.repeat(paddingLeft) +
            cellText +
            ' '.repeat(paddingRight) +
            ' '.repeat(padding);
          break;
        default:
          formattedCell = cellText.padEnd(width);
      }

      return formattedCell;
    });

    const rowText = `│${cells.join('│')}│\n`;

    return rowText;
  }

  /**
   * 快速创建表格
   */
  static create(headers: string[], rows: string[][]): string {
    return TableFormatter.format({ headers, rows });
  }

  /**
   * 格式化对象数组为表格
   */
  static fromObjects(
    objects: any[],
    keys: string[],
    headers?: string[]
  ): string {
    const tableHeaders = headers || keys;
    const tableRows = objects.map((obj) => {
      return keys.map((key) => String(obj[key] || ''));
    });

    return TableFormatter.format({ headers: tableHeaders, rows: tableRows });
  }
}
