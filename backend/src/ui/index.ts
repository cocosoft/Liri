/**
 * UI组件模块主入口（基于CC源码）
 * 导出所有UI组件和类型定义
 */

// 导出类型定义
export * from './types/UITypes';

// 导出设计系统组件
export { 
  ThemeProvider, 
  useTheme, 
  useThemeColor, 
  useThemeSpacing, 
  useThemeFontSize 
} from './design-system/ThemeProvider';

export { 
  Dialog, 
  ConfirmDialog, 
  AlertDialog, 
  ErrorDialog 
} from './design-system/Dialog';

export { 
  Pane, 
  CardPane, 
  SidebarPane, 
  ContentPane 
} from './design-system/Pane';

export { 
  ThemedText,
  HeadingText,
  SubtitleText,
  EmphasisText,
  CodeText,
  LinkText,
  SuccessText,
  WarningText,
  ErrorText,
  InfoText,
  MutedText
} from './design-system/ThemedText';

export { 
  KeyboardShortcutHint, 
  KeyboardShortcutList 
} from './design-system/KeyboardShortcutHint';

export { 
  ProgressBar, 
  IndeterminateProgressBar, 
  StepProgressBar 
} from './design-system/ProgressBar';

export { 
  LoadingState,
  FullScreenLoadingState,
  InlineLoadingState,
  SkeletonLoadingState,
  ProgressLoadingState
} from './design-system/LoadingState';

export { 
  Divider, 
  TextDivider, 
  DashedDivider, 
  DoubleDivider 
} from './design-system/Divider';

export { 
  Byline,
  StatusByline,
  ProgressByline,
  TimeByline,
  CountByline,
  MultiInfoByline
} from './design-system/Byline';

export { 
  ListItem,
  IconListItem,
  DescriptionListItem,
  ActionListItem,
  StatusListItem,
  CheckboxListItem,
  RadioListItem
} from './design-system/ListItem';

// 导出表单和输入组件
export { 
  Button,
  IconButton,
  TextButton,
  IconTextButton,
  ButtonGroup
} from './components/Button';

export { 
  Input, 
  TextArea 
} from './components/Input';

// 导出导航和交互组件
export { 
  Tabs,
  IconTabs,
  ScrollableTabs,
  StepTabs
} from './components/Tabs';

/**
 * 默认主题配置（基于CC源码）
 */
export const defaultTheme = {
  colors: {
    primary: '#007AFF',
    secondary: '#5856D6',
    success: '#34C759',
    warning: '#FF9500',
    error: '#FF3B30',
    info: '#5AC8FA',
    text: '#000000',
    textSecondary: '#8E8E93',
    background: '#FFFFFF',
    border: '#C6C6C8',
    accent: '#007AFF',
    muted: '#F2F2F7'
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48
  },
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12
  },
  typography: {
    fontSize: {
      xs: 12,
      sm: 14,
      md: 16,
      lg: 18,
      xl: 20
    },
    fontWeight: {
      normal: 400,
      medium: 500,
      bold: 700
    }
  }
};

/**
 * 深色主题配置（基于CC源码）
 */
export const darkTheme = {
  ...defaultTheme,
  colors: {
    primary: '#0A84FF',
    secondary: '#5E5CE6',
    success: '#30D158',
    warning: '#FF9F0A',
    error: '#FF453A',
    info: '#64D2FF',
    text: '#FFFFFF',
    textSecondary: '#8E8E93',
    background: '#000000',
    border: '#38383A',
    accent: '#0A84FF',
    muted: '#1C1C1E'
  }
};

/**
 * UI组件版本信息（基于CC源码）
 */
export const UI_VERSION = '1.0.0';

// 导入组件用于默认导出
import { ThemeProvider } from './design-system/ThemeProvider';
import { Dialog } from './design-system/Dialog';
import { Pane } from './design-system/Pane';
import { ThemedText } from './design-system/ThemedText';
import { Button } from './components/Button';
import { Input } from './components/Input';
import { Tabs } from './components/Tabs';

// 导出默认对象
export default {
  ThemeProvider,
  Dialog,
  Pane,
  ThemedText,
  Button,
  Input,
  Tabs,
  defaultTheme,
  darkTheme,
  UI_VERSION
};