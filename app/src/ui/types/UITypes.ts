/**
 * UI组件类型定义
 * 定义UI组件的基础类型和接口
 */

import { ReactNode } from 'react';

/**
 * 主题类型定义
 */
export interface UITheme {
  colors: {
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
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  borderRadius: {
    sm: number;
    md: number;
    lg: number;
  };
  typography: {
    fontSize: {
      xs: number;
      sm: number;
      md: number;
      lg: number;
      xl: number;
    };
    fontWeight: {
      normal: number;
      medium: number;
      bold: number;
    };
  };
}

/**
 * 主题名称类型
 */
export type ThemeName = 'light' | 'dark' | 'auto';

/**
 * 主题设置类型
 */
export type ThemeSetting = ThemeName;

/**
 * 主题上下文值类型
 */
export interface ThemeContextValue {
  /** 保存的用户偏好，可能是'auto' */
  themeSetting: ThemeSetting;
  setThemeSetting: (setting: ThemeSetting) => void;
  setPreviewTheme: (setting: ThemeSetting) => void;
  savePreview: () => void;
  cancelPreview: () => void;
  /** 用于渲染的已解析主题，永远不会是'auto' */
  currentTheme: ThemeName;
}

/**
 * 对话框属性类型
 */
export interface DialogProps {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  onCancel: () => void;
  onConfirm?: () => void;
  color?: keyof UITheme['colors'];
  hideInputGuide?: boolean;
  hideBorder?: boolean;
  isCancelActive?: boolean;
  confirmText?: string;
  cancelText?: string;
}

/**
 * 面板属性类型
 */
export interface PaneProps {
  children: ReactNode;
  color?: keyof UITheme['colors'];
  hideBorder?: boolean;
  padding?: number;
  margin?: number;
  flexDirection?: 'row' | 'column';
  alignItems?: 'flex-start' | 'center' | 'flex-end';
  justifyContent?:
    | 'flex-start'
    | 'center'
    | 'flex-end'
    | 'space-between'
    | 'space-around';
}

/**
 * 文本属性类型
 */
export interface TextProps {
  children: ReactNode;
  color?: keyof UITheme['colors'];
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  size?: keyof UITheme['typography']['fontSize'];
  align?: 'left' | 'center' | 'right';
  wrap?: 'wrap' | 'nowrap' | 'truncate';
}

/**
 * 按钮属性类型
 */
export interface ButtonProps {
  children: ReactNode;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  color?: keyof UITheme['colors'];
}

/**
 * 输入框属性类型
 */
export interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'password' | 'number' | 'email';
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  color?: keyof UITheme['colors'];
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (event: unknown) => void;
  onSubmit?: () => void;
}

/**
 * 选择框属性类型
 */
export interface SelectOption<T = unknown> {
  label: string;
  value: T;
  disabled?: boolean;
  description?: string;
}

export interface SelectProps<T = any> {
  options: SelectOption<T>[];
  value?: T;
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  color?: keyof UITheme['colors'];
}

/**
 * 标签页属性类型
 */
export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
  orientation?: 'horizontal' | 'vertical';
  size?: 'sm' | 'md' | 'lg';
  color?: keyof UITheme['colors'];
}

/**
 * 进度条属性类型
 */
export interface ProgressBarProps {
  value: number;
  max?: number;
  color?: keyof UITheme['colors'];
  size?: 'sm' | 'md' | 'lg';
  showPercentage?: boolean;
  label?: string;
}

/**
 * 加载状态属性类型
 */
export interface LoadingStateProps {
  text?: string;
  size?: 'sm' | 'md' | 'lg';
  color?: keyof UITheme['colors'];
  type?: 'spinner' | 'dots' | 'bar';
}

/**
 * 分隔线属性类型
 */
export interface DividerProps {
  color?: keyof UITheme['colors'];
  orientation?: 'horizontal' | 'vertical';
  thickness?: number;
  margin?: number;
}

/**
 * 键盘快捷键提示属性类型
 */
export interface KeyboardShortcutHintProps {
  keys: string[];
  description: string;
  color?: keyof UITheme['colors'];
  size?: 'sm' | 'md' | 'lg';
}

/**
 * 模糊搜索选择器属性类型
 */
export interface FuzzyPickerProps<T = unknown> {
  items: T[];
  onSelect: (item: T) => void;
  itemToString: (item: T) => string;
  placeholder?: string;
  limit?: number;
  color?: keyof UITheme['colors'];
}

/**
 * 列表项属性类型
 */
export interface ListItemProps {
  children: ReactNode;
  onPress?: () => void;
  selected?: boolean;
  disabled?: boolean;
  color?: keyof UITheme['colors'];
  padding?: number;
  margin?: number;
}

/**
 * 状态图标属性类型
 */
export interface StatusIconProps {
  status: 'success' | 'warning' | 'error' | 'info' | 'loading';
  size?: 'sm' | 'md' | 'lg';
  color?: keyof UITheme['colors'];
}

/**
 * 底部信息栏属性类型
 */
export interface BylineProps {
  children: ReactNode;
  color?: keyof UITheme['colors'];
  align?: 'left' | 'center' | 'right';
  padding?: number;
}

/**
 * 组件尺寸类型
 */
export type ComponentSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * 组件变体类型
 */
export type ComponentVariant =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

/**
 * 组件状态类型
 */
export type ComponentState =
  | 'default'
  | 'hover'
  | 'focus'
  | 'active'
  | 'disabled';

/**
 * 布局方向类型
 */
export type LayoutDirection =
  | 'row'
  | 'column'
  | 'row-reverse'
  | 'column-reverse';

/**
 * 对齐方式类型
 */
export type Alignment = 'start' | 'center' | 'end' | 'stretch' | 'baseline';

/**
 * 分布方式类型
 */
export type Distribution =
  | 'start'
  | 'center'
  | 'end'
  | 'space-between'
  | 'space-around'
  | 'space-evenly';

/**
 * 响应式断点类型
 */
export interface Breakpoints {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

/**
 * 响应式属性类型
 */
export type ResponsiveProp<T> = T | { [K in keyof Breakpoints]?: T };

export // 导出所有类型
 {};
