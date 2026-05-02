/**
 * 主题管理工具
 */

/**
 * 主题类型
 */
export interface Theme {
  /** 背景色 */
  background: string;
  /** 前景色 */
  foreground: string;
  /** 主色 */
  primary: string;
  /** 次要色 */
  secondary: string;
  /** 成功色 */
  success: string;
  /** 警告色 */
  warning: string;
  /** 错误色 */
  error: string;
  /** 边框色 */
  border: string;
  /** 输入背景色 */
  inputBackground: string;
  /** 输入前景色 */
  inputForeground: string;
  /** 选中文本背景色 */
  selectedTextBackground: string;
  /** 选中文本前景色 */
  selectedTextForeground: string;
}

/**
 * 默认主题
 */
export const defaultTheme: Theme = {
  background: '#000000',
  foreground: '#ffffff',
  primary: '#00ff00',
  secondary: '#00ffff',
  success: '#00ff00',
  warning: '#ffff00',
  error: '#ff0000',
  border: '#444444',
  inputBackground: '#222222',
  inputForeground: '#ffffff',
  selectedTextBackground: '#00ff00',
  selectedTextForeground: '#000000',
};

/**
 * 亮色主题
 */
export const lightTheme: Theme = {
  background: '#ffffff',
  foreground: '#000000',
  primary: '#0000ff',
  secondary: '#008080',
  success: '#008000',
  warning: '#ff8000',
  error: '#ff0000',
  border: '#cccccc',
  inputBackground: '#f0f0f0',
  inputForeground: '#000000',
  selectedTextBackground: '#0000ff',
  selectedTextForeground: '#ffffff',
};