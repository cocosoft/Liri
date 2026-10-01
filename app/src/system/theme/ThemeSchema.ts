/**
 * 主题配置文件 Schema
 *
 * 定义主题 JSON 文件的统一格式，支持三层颜色配置：
 * - colors: 终端 16 色 ANSI 调色板
 * - ansi256: 扩展 256 色调色板
 * - ui: 组件级颜色（Ink/React 组件使用）
 */

/**
 * 终端 16 色 ANSI 调色板
 */
export interface ThemeTerminalColors {
  foreground: string;
  background: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/**
 * 扩展 256 色调色板（可选）
 * key 为 0-255 的色号，value 为十六进制颜色值
 */
export type ThemeAnsi256Palette = Record<number, string>;

/**
 * UI 组件级颜色
 */
export interface ThemeUIColorPalette {
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  text: string;
  textSecondary: string;
  background: string;
  border: string;
  accent: string;
  muted: string;
  highlight: string;
}

/**
 * 主题定义
 */
export interface ThemeDefinition {
  /** 主题名称 */
  name: string;
  /** 主题显示名称 */
  displayName?: string;
  /** 主题描述 */
  description?: string;
  /** 主题类型 */
  type?: 'light' | 'dark';
  /** 终端 16 色 */
  colors: ThemeTerminalColors;
  /** 扩展 256 色调色板（可选） */
  ansi256?: ThemeAnsi256Palette;
  /** UI 组件级颜色（可选） */
  ui?: ThemeUIColorPalette;
  /** 作者 */
  author?: string;
  /** 版本 */
  version?: string;
}

/**
 * 主题文件格式（与 ThemeDefinition 一致，用于 JSON 文件读写时的类型标注）
 */
export type ThemeFileFormat = ThemeDefinition;

/**
 * 主题元数据（用于主题列表展示）
 */
export interface ThemeMetadata {
  name: string;
  displayName: string;
  description: string;
  type: 'light' | 'dark';
  author: string;
  version: string;
  isBuiltIn: boolean;
  filePath?: string;
}

/**
 * 验证主题定义是否合法
 * @param theme 待验证的主题定义
 * @returns 验证结果，包含错误信息列表
 */
export function validateThemeDefinition(theme: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!theme || typeof theme !== 'object') {
    errors.push('主题定义必须是一个对象');
    return { valid: false, errors };
  }

  const t = theme as Record<string, unknown>;

  if (!t.name || typeof t.name !== 'string') {
    errors.push('主题必须包含字符串类型的 name 字段');
  }

  if (!t.colors || typeof t.colors !== 'object') {
    errors.push('主题必须包含 colors 字段');
  } else {
    const requiredFields = [
      'foreground',
      'background',
      'cursor',
      'cursorAccent',
      'selectionBackground',
      'selectionForeground',
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'brightBlack',
      'brightRed',
      'brightGreen',
      'brightYellow',
      'brightBlue',
      'brightMagenta',
      'brightCyan',
      'brightWhite',
    ];

    for (const field of requiredFields) {
      const val = (t.colors as Record<string, unknown>)[field];
      if (!val || typeof val !== 'string') {
        errors.push(`colors.${field} 必须为有效的颜色字符串`);
      } else if (!isValidHexColor(val as string)) {
        errors.push(`colors.${field} 必须为有效的十六进制颜色值（如 #ffffff）`);
      }
    }
  }

  if (t.ansi256 !== undefined) {
    if (typeof t.ansi256 !== 'object') {
      errors.push('ansi256 必须是一个对象');
    } else {
      for (const [key, value] of Object.entries(
        t.ansi256 as Record<string, unknown>
      )) {
        const numKey = Number(key);
        if (!Number.isInteger(numKey) || numKey < 0 || numKey > 255) {
          errors.push(`ansi256 的 key 必须在 0-255 之间，非法值: ${key}`);
        }
        if (typeof value !== 'string' || !isValidHexColor(value)) {
          errors.push(
            `ansi256[${key}] 必须为有效的十六进制颜色值，非法值: ${value}`
          );
        }
      }
    }
  }

  if (t.ui !== undefined) {
    if (typeof t.ui !== 'object') {
      errors.push('ui 必须是一个对象');
    } else {
      const uiRequiredFields = [
        'primary',
        'secondary',
        'success',
        'warning',
        'error',
        'info',
        'text',
        'textSecondary',
        'background',
        'border',
        'accent',
        'muted',
        'highlight',
      ];

      for (const field of uiRequiredFields) {
        const val = (t.ui as Record<string, unknown>)[field];
        if (
          val !== undefined &&
          (typeof val !== 'string' || !isValidHexColor(val as string))
        ) {
          errors.push(`ui.${field} 必须为有效的十六进制颜色值`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 验证十六进制颜色格式
 */
function isValidHexColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}
