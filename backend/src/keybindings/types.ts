/**
 * 按键绑定系统类型定义
 */

/**
 * 按键绑定上下文名称
 */
export type KeybindingContextName =
  | 'Global' // 全局上下文，无论焦点在哪里都有效
  | 'Chat' // 聊天输入框聚焦时
  | 'Autocomplete' // 自动完成菜单可见时
  | 'Confirmation' // 确认/权限对话框显示时
  | 'Help' // 帮助覆盖层打开时
  | 'Transcript' // 查看对话记录时
  | 'HistorySearch' // 搜索命令历史时
  | 'Task' // 任务/代理在前台运行时
  | 'ThemePicker' // 主题选择器打开时
  | 'Settings' // 设置菜单打开时
  | 'Tabs' // 标签导航激活时
  | 'Attachments' // 在选择对话框中导航图片附件时
  | 'Footer' // 页脚指示器聚焦时
  | 'MessageSelector' // 消息选择器（回退）打开时
  | 'DiffDialog' // 差异对话框打开时
  | 'ModelPicker' // 模型选择器打开时
  | 'Select' // 选择/列表组件聚焦时
  | 'Plugin'; // 插件对话框打开时

/**
 * 解析后的按键序列
 */
export interface ParsedKeystroke {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  win?: boolean;
  cmd?: boolean;
  command?: boolean;
}

/**
 * 解析后的绑定定义
 */
export interface ParsedBinding {
  action: string;
  context: KeybindingContextName;
  original?: string;
  chord: {
    chords: ParsedKeystroke[];
    displayText: string;
  };
}

/**
 * 和弦解析结果
 */
export interface ChordResolveResult {
  action: string | null;
  isCompleteChord: boolean;
  pendingChord: ParsedKeystroke[] | null;
}

/**
 * 处理器注册信息
 */
export interface HandlerRegistration {
  action: string;
  context: KeybindingContextName;
  handler: () => void;
}

/**
 * 按键绑定配置块
 */
export interface KeybindingBlock {
  context: KeybindingContextName;
  bindings: Record<string, string | null>;
}

/**
 * 按键绑定配置
 */
export interface KeybindingsConfig {
  $schema?: string;
  $docs?: string;
  bindings: KeybindingBlock[];
}

/**
 * 按键绑定验证警告
 */
export interface KeybindingWarning {
  type:
    | 'error'
    | 'warning'
    | 'parse_error'
    | 'reserved'
    | 'invalid_context'
    | 'invalid_action'
    | 'duplicate'
    | 'unused';
  message: string;
  context?: string;
  action?: string;
  key?: string;
}

/**
 * 按键绑定加载结果
 */
export interface KeybindingsLoadResult {
  bindings: ParsedBinding[];
  warnings: KeybindingWarning[];
  hasErrors: boolean;
}

/**
 * 按键修饰符
 */
export type KeyModifier = 'ctrl' | 'alt' | 'shift' | 'meta';

/**
 * 按键绑定定义
 */
export interface KeyBinding {
  key: string;
  modifiers?: KeyModifier[];
  description?: string;
  action: () => void | Promise<void>;
}

/**
 * 按键序列定义
 */
export interface KeySequence {
  keys: string[];
  description?: string;
}

export const KEYBINDING_ACTIONS = {
  COPY: 'edit.copy',
  CUT: 'edit.cut',
  PASTE: 'edit.paste',
  UNDO: 'edit.undo',
  REDO: 'edit.redo',
  SAVE: 'file.save',
  OPEN: 'file.open',
  SEARCH: 'search.find',
  REPLACE: 'search.replace',
} as const;
