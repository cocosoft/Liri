/**
 * 按键绑定动作系统
 * 定义所有支持的动作类型和上下文
 */

import { KeybindingAction, keybindingManager } from './keybindingManager';

/**
 * 动作上下文定义
 */
export const ACTION_CONTEXTS = {
  GLOBAL: 'global',
  EDITOR: 'editor',
  TERMINAL: 'terminal',
  CHAT: 'chat',
  SETTINGS: 'settings',
  FILE_EXPLORER: 'file-explorer',
  SEARCH: 'search',
  HELP: 'help',
  DIALOG: 'dialog',
  NOTIFICATION: 'notification',
  MENU: 'menu',
  TOOLBAR: 'toolbar',
  STATUS_BAR: 'status-bar',
  TAB: 'tab',
  PANEL: 'panel',
  SIDEBAR: 'sidebar',
  MODAL: 'modal',
  FORM: 'form',
  LIST: 'list',
} as const;

export type ActionContext = typeof ACTION_CONTEXTS[keyof typeof ACTION_CONTEXTS];

/**
 * 核心动作定义
 */
export interface CoreAction extends KeybindingAction {
  category: string;
  shortcut?: string;
}

/**
 * 编辑动作
 */
export const EDIT_ACTIONS: CoreAction[] = [
  {
    id: 'edit.copy',
    name: 'Copy',
    description: 'Copy selected text',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Edit',
    shortcut: 'Ctrl+C',
    handler: () => document.execCommand?.('copy'),
  },
  {
    id: 'edit.cut',
    name: 'Cut',
    description: 'Cut selected text',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Edit',
    shortcut: 'Ctrl+X',
    handler: () => document.execCommand?.('cut'),
  },
  {
    id: 'edit.paste',
    name: 'Paste',
    description: 'Paste from clipboard',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Edit',
    shortcut: 'Ctrl+V',
    handler: () => document.execCommand?.('paste'),
  },
  {
    id: 'edit.select-all',
    name: 'Select All',
    description: 'Select all text',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Edit',
    shortcut: 'Ctrl+A',
    handler: () => document.execCommand?.('selectAll'),
  },
  {
    id: 'edit.undo',
    name: 'Undo',
    description: 'Undo last action',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Edit',
    shortcut: 'Ctrl+Z',
    handler: () => document.execCommand?.('undo'),
  },
  {
    id: 'edit.redo',
    name: 'Redo',
    description: 'Redo last undone action',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Edit',
    shortcut: 'Ctrl+Shift+Z',
    handler: () => document.execCommand?.('redo'),
  },
];

/**
 * 导航动作
 */
export const NAVIGATION_ACTIONS: CoreAction[] = [
  {
    id: 'nav.back',
    name: 'Go Back',
    description: 'Navigate back',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Navigation',
    shortcut: 'Alt+Left',
    handler: () => window.history.back(),
  },
  {
    id: 'nav.forward',
    name: 'Go Forward',
    description: 'Navigate forward',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Navigation',
    shortcut: 'Alt+Right',
    handler: () => window.history.forward(),
  },
  {
    id: 'nav.home',
    name: 'Go Home',
    description: 'Navigate to home',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Navigation',
    shortcut: 'Alt+Home',
    handler: () => window.location.href = '/',
  },
];

/**
 * 文件动作
 */
export const FILE_ACTIONS: CoreAction[] = [
  {
    id: 'file.new',
    name: 'New File',
    description: 'Create a new file',
    context: ACTION_CONTEXTS.FILE_EXPLORER,
    category: 'File',
    shortcut: 'Ctrl+N',
    handler: () => {},
  },
  {
    id: 'file.open',
    name: 'Open File',
    description: 'Open a file',
    context: ACTION_CONTEXTS.FILE_EXPLORER,
    category: 'File',
    shortcut: 'Ctrl+O',
    handler: () => {},
  },
  {
    id: 'file.save',
    name: 'Save',
    description: 'Save current file',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'File',
    shortcut: 'Ctrl+S',
    handler: () => document.execCommand?.('save'),
  },
  {
    id: 'file.save-as',
    name: 'Save As',
    description: 'Save file with new name',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'File',
    shortcut: 'Ctrl+Shift+S',
    handler: () => {},
  },
  {
    id: 'file.close',
    name: 'Close',
    description: 'Close current file',
    context: ACTION_CONTEXTS.TAB,
    category: 'File',
    shortcut: 'Ctrl+W',
    handler: () => {},
  },
];

/**
 * 窗口动作
 */
export const WINDOW_ACTIONS: CoreAction[] = [
  {
    id: 'window.minimize',
    name: 'Minimize',
    description: 'Minimize window',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Window',
    shortcut: 'Ctrl+M',
    handler: () => {},
  },
  {
    id: 'window.maximize',
    name: 'Maximize',
    description: 'Maximize window',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Window',
    shortcut: 'Ctrl+Shift+M',
    handler: () => {},
  },
  {
    id: 'window.close',
    name: 'Close Window',
    description: 'Close the window',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Window',
    shortcut: 'Alt+F4',
    handler: () => {},
  },
  {
    id: 'window.reload',
    name: 'Reload',
    description: 'Reload the application',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Window',
    shortcut: 'Ctrl+R',
    handler: () => window.location.reload(),
  },
];

/**
 * 视图动作
 */
export const VIEW_ACTIONS: CoreAction[] = [
  {
    id: 'view.toggle-sidebar',
    name: 'Toggle Sidebar',
    description: 'Show or hide sidebar',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'View',
    shortcut: 'Ctrl+B',
    handler: () => {},
  },
  {
    id: 'view.toggle-panel',
    name: 'Toggle Panel',
    description: 'Show or hide panel',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'View',
    shortcut: 'Ctrl+J',
    handler: () => {},
  },
  {
    id: 'view.toggle-fullscreen',
    name: 'Toggle Fullscreen',
    description: 'Enter or exit fullscreen',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'View',
    shortcut: 'F11',
    handler: () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
    },
  },
];

/**
 * 帮助动作
 */
export const HELP_ACTIONS: CoreAction[] = [
  {
    id: 'help.show',
    name: 'Show Help',
    description: 'Open help documentation',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Help',
    shortcut: 'F1',
    handler: () => {},
  },
  {
    id: 'help.show-shortcuts',
    name: 'Show Keyboard Shortcuts',
    description: 'Display all keyboard shortcuts',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Help',
    shortcut: 'Ctrl+K Ctrl+S',
    handler: () => {},
  },
];

/**
 * 搜索动作
 */
export const SEARCH_ACTIONS: CoreAction[] = [
  {
    id: 'search.find',
    name: 'Find',
    description: 'Open find dialog',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Search',
    shortcut: 'Ctrl+F',
    handler: () => {},
  },
  {
    id: 'search.find-next',
    name: 'Find Next',
    description: 'Find next match',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Search',
    shortcut: 'F3',
    handler: () => {},
  },
  {
    id: 'search.find-previous',
    name: 'Find Previous',
    description: 'Find previous match',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Search',
    shortcut: 'Shift+F3',
    handler: () => {},
  },
  {
    id: 'search.replace',
    name: 'Replace',
    description: 'Open replace dialog',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Search',
    shortcut: 'Ctrl+H',
    handler: () => {},
  },
  {
    id: 'search.quick',
    name: 'Quick Search',
    description: 'Open quick search',
    context: ACTION_CONTEXTS.GLOBAL,
    category: 'Search',
    shortcut: 'Ctrl+K',
    handler: () => {},
  },
];

/**
 * 所有动作列表
 */
export const ALL_ACTIONS: CoreAction[] = [
  ...EDIT_ACTIONS,
  ...NAVIGATION_ACTIONS,
  ...FILE_ACTIONS,
  ...WINDOW_ACTIONS,
  ...VIEW_ACTIONS,
  ...HELP_ACTIONS,
  ...SEARCH_ACTIONS,
];

/**
 * 初始化所有核心动作
 */
export function initializeCoreActions(): void {
  for (const action of ALL_ACTIONS) {
    keybindingManager.registerAction(action);
  }
}

/**
 * 获取指定类别的动作
 */
export function getActionsByCategory(category: string): CoreAction[] {
  return ALL_ACTIONS.filter((action) => action.category === category);
}

/**
 * 获取指定上下文的动作
 */
export function getActionsByContext(context: ActionContext): CoreAction[] {
  return ALL_ACTIONS.filter((action) => action.context === context);
}

/**
 * 获取动作信息
 */
export function getActionInfo(actionId: string): CoreAction | undefined {
  return ALL_ACTIONS.find((action) => action.id === actionId);
}

export function getActionById(id: string): CoreAction | undefined {
  return getActionInfo(id);
}

export const ACTIONS = ALL_ACTIONS;
export type Action = CoreAction;
export type ActionType = ActionContext;
