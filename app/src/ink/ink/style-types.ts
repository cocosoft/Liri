/**
 * 样式类型定义 — 从 styles.ts 和 render-border.ts 中提取，避免模块间循环依赖。
 *
 * 仅包含类型定义和纯常量，不引用任何可能形成循环依赖的模块。
 */

import type { Boxes, BoxStyle } from 'cli-boxes';

export type RGBColor = `rgb(${number},${number},${number})`;
export type HexColor = `#${string}`;
export type Ansi256Color = `ansi256(${number})`;
export type AnsiColor =
  | 'ansi:black'
  | 'ansi:red'
  | 'ansi:green'
  | 'ansi:yellow'
  | 'ansi:blue'
  | 'ansi:magenta'
  | 'ansi:cyan'
  | 'ansi:white'
  | 'ansi:blackBright'
  | 'ansi:redBright'
  | 'ansi:greenBright'
  | 'ansi:yellowBright'
  | 'ansi:blueBright'
  | 'ansi:magentaBright'
  | 'ansi:cyanBright'
  | 'ansi:whiteBright';

/** 原始颜色值 — 非主题键 */
export type Color = RGBColor | HexColor | Ansi256Color | AnsiColor | string;

/**
 * 结构化文本样式属性。
 * 用于不依赖 ANSI 字符串转换的文本样式化。
 * 颜色为原始值 — 主题解析在组件层完成。
 */
export type TextStyles = {
  color?: Color;
  backgroundColor?: Color;
  dim?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
};

export const CUSTOM_BORDER_STYLES = {
  dashed: {
    top: '╌',
    left: '╎',
    right: '╎',
    bottom: '╌',
    topLeft: ' ',
    topRight: ' ',
    bottomLeft: ' ',
    bottomRight: ' ',
  },
} as const;

export type BorderStyle =
  | keyof Boxes
  | keyof typeof CUSTOM_BORDER_STYLES
  | BoxStyle;

export type BorderTextOptions = {
  content: string;
  position: 'top' | 'bottom';
  align: 'start' | 'end' | 'center';
  offset?: number;
};
