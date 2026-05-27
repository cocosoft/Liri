/**
 * UI组件框架
 *
 * 提供终端UI渲染的基础组件
 */

export interface TextStyle {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  hidden?: boolean;
  strikethrough?: boolean;
  color?: string;
  backgroundColor?: string;
}

export interface BoxProps {
  width?: number | string;
  height?: number | string;
  minWidth?: number;
  minHeight?: number;
  flexDirection?: 'row' | 'column';
  justifyContent?:
    | 'flex-start'
    | 'center'
    | 'flex-end'
    | 'space-between'
    | 'space-around';
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch';
  gap?: number;
  padding?: number | string;
  margin?: number | string;
  borderStyle?: 'single' | 'double' | 'round' | 'bold' | 'none';
  borderColor?: string;
}

export interface TextProps {
  children?: string | TextSegment[];
  style?: TextStyle;
  truncate?: boolean;
  wrap?: boolean;
}

export interface TextSegment {
  text: string;
  style?: TextStyle;
}

export interface ProgressProps {
  value: number;
  max?: number;
  label?: string;
  showPercentage?: boolean;
  width?: number;
}

export interface SpinnerProps {
  label?: string;
  color?: string;
}

export interface InputProps {
  label?: string;
  placeholder?: string;
  value?: string;
  type?: 'text' | 'password' | 'number';
  onChange?: (value: string) => void;
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  label?: string;
  onChange?: (value: string) => void;
}

export class Box {
  children: (Box | Text | Progress | Spinner | Select | null)[];
  props: BoxProps;

  constructor(
    props: BoxProps = {},
    children: (Box | Text | Progress | Spinner | Select | null)[] = []
  ) {
    this.props = props;
    this.children = children;
  }

  addChild(child: Box | Text | Progress | Spinner | Select | null): void {
    this.children.push(child);
  }

  render(): string {
    const renderedChildren = this.children
      .filter((child) => child !== null)
      .map((child) => child?.render() || '')
      .join('\n');
    return renderedChildren;
  }
}

export class Text {
  content: string | TextSegment[];
  props: TextProps;

  constructor(content: string | TextSegment[], props: TextProps = {}) {
    this.content = content;
    this.props = props;
  }

  render(): string {
    if (Array.isArray(this.content)) {
      return this.content
        .map((segment) =>
          typeof segment === 'string' ? segment : segment.text
        )
        .join('');
    }
    return this.content;
  }

  getStyleString(): string {
    const styles: string[] = [];
    if (this.props.style?.bold) styles.push('bold');
    if (this.props.style?.dim) styles.push('dim');
    if (this.props.style?.italic) styles.push('italic');
    if (this.props.style?.underline) styles.push('underline');
    return styles.join(' ');
  }
}

export class Progress {
  value: number;
  max: number;
  props: ProgressProps;

  constructor(props: ProgressProps) {
    this.value = props.value;
    this.max = props.max ?? 100;
    this.props = props;
  }

  render(): string {
    const percentage = Math.round((this.value / this.max) * 100);
    const barWidth = this.props.width ?? 40;
    const filledWidth = Math.round((this.value / this.max) * barWidth);
    const emptyWidth = barWidth - filledWidth;

    const label = this.props.label ?? '';
    const percentageDisplay =
      this.props.showPercentage !== false ? ` ${percentage}%` : '';

    const bar = `[${'#'.repeat(filledWidth)}${' '.repeat(emptyWidth)}]`;

    return `${label}${bar}${percentageDisplay}`;
  }
}

export class Spinner {
  label?: string;
  color?: string;
  frame: number = 0;
  frames: string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  constructor(props: SpinnerProps) {
    this.label = props.label;
    this.color = props.color;
  }

  next(): string {
    this.frame = (this.frame + 1) % this.frames.length;
    return this.render();
  }

  render(): string {
    return `${this.frames[this.frame]}${this.label ? ' ' + this.label : ''}`;
  }
}

export class Select {
  options: SelectOption[];
  value?: string;
  label?: string;
  onChange?: (value: string) => void;

  constructor(props: SelectProps) {
    this.options = props.options;
    this.value = props.value;
    this.label = props.label;
    this.onChange = props.onChange;
  }

  render(): string {
    let result = '';

    if (this.label) {
      result += `${this.label}\n`;
    }

    for (let i = 0; i < this.options.length; i++) {
      const option = this.options[i];
      const isSelected = option.value === this.value;
      const marker = isSelected ? '>' : ' ';

      result += `${marker} ${option.label}`;

      if (option.description) {
        result += ` - ${option.description}`;
      }

      result += '\n';
    }

    return result.trim();
  }

  select(value: string): void {
    if (this.onChange) {
      this.onChange(value);
    }
    this.value = value;
  }
}

export class Table {
  headers: string[];
  rows: string[][];
  columnWidths?: number[];

  constructor(headers: string[], rows: string[][]) {
    this.headers = headers;
    this.rows = rows;
  }

  render(): string {
    if (this.columnWidths === undefined) {
      this.calculateColumnWidths();
    }

    const headerRow = this.headers
      .map((h, i) => h.padEnd(this.columnWidths![i]))
      .join(' | ');
    const separator = this.columnWidths!.map((w) => '-'.repeat(w)).join('-+-');
    const dataRows = this.rows.map((row) =>
      row.map((cell, i) => cell.padEnd(this.columnWidths![i])).join(' | ')
    );

    return [headerRow, separator, ...dataRows].join('\n');
  }

  private calculateColumnWidths(): void {
    this.columnWidths = this.headers.map((h, i) => {
      let maxWidth = h.length;
      for (const row of this.rows) {
        if (row[i] && row[i].length > maxWidth) {
          maxWidth = row[i].length;
        }
      }
      return maxWidth;
    });
  }
}

export class List {
  items: string[];
  ordered: boolean;

  constructor(items: string[], ordered: boolean = false) {
    this.items = items;
    this.ordered = ordered;
  }

  render(): string {
    return this.items
      .map((item, i) => {
        if (this.ordered) {
          return `${i + 1}. ${item}`;
        }
        return `- ${item}`;
      })
      .join('\n');
  }
}

export class Divider {
  char: string;
  width: number;

  constructor(char: string = '-', width: number = 80) {
    this.char = char;
    this.width = width;
  }

  render(): string {
    return this.char.repeat(this.width);
  }
}

export function renderMultiple(
  ...components: (
    | Box
    | Text
    | Progress
    | Spinner
    | Select
    | Table
    | List
    | Divider
    | null
  )[]
): string {
  return components
    .filter((c) => c !== null)
    .map((c) => c?.render() || '')
    .filter((s) => s.length > 0)
    .join('\n\n');
}

export default {
  Box,
  Text,
  Progress,
  Spinner,
  Select,
  Table,
  List,
  Divider,
  renderMultiple,
};
