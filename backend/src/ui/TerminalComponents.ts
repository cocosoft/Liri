/**
 * 终端UI组件库
 * 提供丰富的交互式UI组件
 */

import chalk from 'chalk';

export interface TableColumn {
  header: string;
  width: number;
  align?: 'left' | 'center' | 'right';
}

export interface TableRow {
  cells: string[];
}

export class TerminalComponents {
  private static readonly DEFAULT_WIDTH = 80;
  private static readonly DEFAULT_PADDING = 2;

  public static printDivider(char: string = '─', width?: number): void {
    const w = width || this.DEFAULT_WIDTH;
    console.log(char.repeat(w));
  }

  public static printHeader(
    title?: string,
    width?: number,
    color: chalk.Chalk = chalk.cyan
  ): void {
    const w = width || this.DEFAULT_WIDTH;
    const displayTitle = title || '';
    const padding = Math.max(0, Math.floor((w - displayTitle.length - 4) / 2));
    const paddedTitle = ' '.repeat(padding) + displayTitle + ' '.repeat(padding);

    console.log(color('╔' + '═'.repeat(w) + '╗'));
    console.log(color('║' + paddedTitle + '║'));
    console.log(color('╚' + '═'.repeat(w) + '╝'));
  }

  public static printBox(
    content: string[],
    width?: number,
    borderColor: chalk.Chalk = chalk.cyan
  ): void {
    const w = width || this.DEFAULT_WIDTH;

    console.log(borderColor('┌' + '─'.repeat(w) + '┐'));

    for (const line of content) {
      const padding = w - line.length;
      const leftPad = Math.floor(padding / 2);
      const rightPad = padding - leftPad;
      console.log(
        borderColor('│') +
          ' '.repeat(leftPad) +
          line +
          ' '.repeat(rightPad) +
          borderColor('│')
      );
    }

    console.log(borderColor('└' + '─'.repeat(w) + '┘'));
  }

  public static printTable(
    columns: TableColumn[],
    rows: TableRow[],
    options?: { maxWidth?: number }
  ): void {
    const maxWidth = options?.maxWidth || this.DEFAULT_WIDTH;

    const calculateWidth = (col: TableColumn) => {
      const maxCellLength = Math.max(
        col.header.length,
        ...rows.map((r) => (r.cells[columns.indexOf(col)] || '').length)
      );
      return Math.min(
        Math.max(col.width, maxCellLength),
        Math.floor(maxWidth / columns.length)
      );
    };

    const colWidths = columns.map(calculateWidth);
    const totalWidth =
      colWidths.reduce((a, b) => a + b, 0) + columns.length + 1;

    const formatCell = (
      cell: string,
      width: number,
      align?: 'left' | 'center' | 'right'
    ) => {
      const padding = width - cell.length;
      switch (align) {
        case 'right':
          return ' '.repeat(padding) + cell;
        case 'center':
          const leftPad = Math.floor(padding / 2);
          return ' '.repeat(leftPad) + cell + ' '.repeat(padding - leftPad);
        default:
          return cell + ' '.repeat(padding);
      }
    };

    const headerLine =
      '│ ' +
      columns
        .map((col, i) =>
          formatCell(col.header, colWidths[i], col.align || 'left')
        )
        .join(' │ ') +
      ' │';

    console.log('┌─' + colWidths.map((w) => '─'.repeat(w)).join('─┬─') + '─┐');
    console.log(chalk.cyan(headerLine));
    console.log('├─' + colWidths.map((w) => '─'.repeat(w)).join('─┼─') + '─┤');

    for (const row of rows) {
      const rowLine =
        '│ ' +
        row.cells
          .map((cell, i) =>
            formatCell(cell, colWidths[i], columns[i].align || 'left')
          )
          .join(' │ ') +
        ' │';
      console.log(rowLine);
    }

    console.log('└─' + colWidths.map((w) => '─'.repeat(w)).join('─┴─') + '─┘');
  }

  public static printList(
    items: string[],
    options?: { bullet?: string; color?: chalk.Chalk; indent?: number }
  ): void {
    const bullet = options?.bullet || '•';
    const color = options?.color || chalk.white;
    const indent = options?.indent || 2;

    for (const item of items) {
      console.log(' '.repeat(indent) + color(bullet) + ' ' + item);
    }
  }

  public static printProgressBar(
    progress: number,
    total: number,
    options?: { width?: number; showPercentage?: boolean }
  ): void {
    const width = options?.width || 40;
    const showPercentage = options?.showPercentage ?? true;

    const percentage = Math.min(100, Math.max(0, (progress / total) * 100));
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;

    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const percentageText = showPercentage ? ` ${Math.round(percentage)}%` : '';

    process.stdout.write(`\r[${bar}]${percentageText}`);

    if (progress >= total) {
      process.stdout.write('\n');
    }
  }

  public static printSteps(
    steps: Array<{
      title: string;
      description?: string;
      status?: 'pending' | 'active' | 'completed' | 'error';
    }>
  ): void {
    const statusSymbols: Record<string, string> = {
      pending: chalk.gray('○'),
      active: chalk.yellow('◐'),
      completed: chalk.green('●'),
      error: chalk.red('✗'),
    };

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const symbol = statusSymbols[step.status || 'pending'];
      const stepNum = chalk.gray(`${i + 1}.`);
      const title =
        step.status === 'completed'
          ? chalk.green(step.title)
          : step.status === 'error'
            ? chalk.red(step.title)
            : step.status === 'active'
              ? chalk.yellow(step.title)
              : chalk.white(step.title);

      console.log(`  ${symbol} ${stepNum} ${title}`);

      if (step.description) {
        const descColor =
          step.status === 'error'
            ? chalk.red
            : step.status === 'completed'
              ? chalk.gray
              : chalk.gray;
        console.log(`      ${descColor(step.description)}`);
      }
    }
  }

  public static printKeyValue(
    data: Array<{ key: string; value: string } | [string, string]>,
    options?: {
      keyColor?: chalk.Chalk;
      valueColor?: chalk.Chalk;
      indent?: number;
    }
  ): void {
    const keyColor = options?.keyColor || chalk.cyan;
    const valueColor = options?.valueColor || chalk.white;
    const indent = options?.indent || 2;

    const normalized = data.map((d) =>
      Array.isArray(d) ? { key: d[0], value: d[1] } : d
    );

    const maxKeyLength = Math.max(...normalized.map((d) => d.key.length));

    for (const { key, value } of normalized) {
      console.log(
        ' '.repeat(indent) +
          keyColor(key.padEnd(maxKeyLength)) +
          chalk.gray(' : ') +
          valueColor(value)
      );
    }
  }

  public static async printSpinner(
    message: string,
    asyncTask: () => Promise<any>
  ): Promise<any> {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let currentFrame = 0;

    const interval = setInterval(() => {
      process.stdout.write(`\r${frames[currentFrame]} ${message}`);
      currentFrame = (currentFrame + 1) % frames.length;
    }, 80);

    try {
      const result = await asyncTask();
      clearInterval(interval);
      process.stdout.write(`\r${chalk.green('✓')} ${message}\n`);
      return result;
    } catch (error) {
      clearInterval(interval);
      process.stdout.write(`\r${chalk.red('✗')} ${message}\n`);
      throw error;
    }
  }

  public static printBadge(
    text: string,
    options?: { color?: chalk.Chalk; background?: chalk.Chalk }
  ): void {
    const color = options?.color || chalk.white;
    const background = options?.background || chalk.bgBlue;

    const padded = ` ${text} `;
    const border = '─'.repeat(padded.length);

    console.log(background(color(`┌${border}┐`)));
    console.log(background(color(`│${padded}│`)));
    console.log(background(color(`└${border}┘`)));
  }

  public static printInfo(
    message: string,
    options?: { icon?: string; color?: chalk.Chalk }
  ): void {
    const icon = options?.icon || 'ℹ';
    const color = options?.color || chalk.blue;

    console.log(`${chalk.cyan(icon)} ${color(message)}`);
  }

  public static printSuccess(
    message: string,
    options?: { icon?: string }
  ): void {
    const icon = options?.icon || '✓';

    console.log(`${chalk.green('✓')} ${chalk.green(message)}`);
  }

  public static printWarning(
    message: string,
    options?: { icon?: string }
  ): void {
    const icon = options?.icon || '⚠';

    console.log(`${chalk.yellow('⚠')} ${chalk.yellow(message)}`);
  }

  public static printError(message: string, options?: { icon?: string }): void {
    const icon = options?.icon || '✗';

    console.log(`${chalk.red('✗')} ${chalk.red(message)}`);
  }

  public static clearScreen(): void {
    process.stdout.write('\x1B[2J\x1B[0f');
  }

  public static moveCursorUp(lines: number = 1): void {
    process.stdout.write(`\x1B[${lines}A`);
  }

  public static moveCursorDown(lines: number = 1): void {
    process.stdout.write(`\x1B[${lines}B`);
  }

  public static clearLine(): void {
    process.stdout.write('\x1B[2K');
  }
}

export default TerminalComponents;
