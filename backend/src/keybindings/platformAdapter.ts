//
/**
 * 平台适配器
 * 处理Windows和macOS之间的按键差异
 */
import { platform } from 'os';
import type { ParsedKeystroke } from './types.js';

/**
 * 平台类型
 */
export type Platform = 'windows' | 'macos' | 'linux';

/**
 * 当前平台
 */
export const CURRENT_PLATFORM: Platform = (() => {
  const osPlatform = platform();
  switch (osPlatform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    default:
      return 'linux';
  }
})();

/**
 * 平台特定的按键映射
 */
export const PLATFORM_KEY_MAPPINGS = {
  windows: {
    meta: 'win',
    command: 'win',
    cmd: 'win'
  },
  macos: {
    meta: 'cmd',
    command: 'cmd',
    win: 'cmd',
    ctrl: 'ctrl' // macOS上ctrl键通常用于特殊功能
  },
  linux: {
    meta: 'meta',
    command: 'meta',
    cmd: 'meta',
    win: 'meta'
  }
} as const;

/**
 * 平台特定的按键显示名称
 */
export const PLATFORM_DISPLAY_NAMES = {
  windows: {
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
    meta: 'Win',
    command: 'Win',
    cmd: 'Win'
  },
  macos: {
    ctrl: 'Ctrl',
    alt: 'Opt',
    shift: 'Shift',
    meta: 'Cmd',
    command: 'Cmd',
    cmd: 'Cmd'
  },
  linux: {
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
    meta: 'Meta',
    command: 'Meta',
    cmd: 'Meta'
  }
} as const;

/**
 * 平台特定的保留快捷键
 */
export const PLATFORM_RESERVED_SHORTCUTS = {
  windows: [
    'ctrl+alt+delete', // 系统安全选项
    'alt+f4',          // 关闭窗口
    'win',             // 开始菜单
    'win+r',           // 运行对话框
    'win+e',           // 文件资源管理器
    'win+d',           // 显示桌面
    'win+l',           // 锁定计算机
  ],
  macos: [
    'cmd+space',       // Spotlight搜索
    'cmd+tab',         // 应用切换器
    'cmd+q',           // 退出应用
    'cmd+w',           // 关闭窗口
    'cmd+h',           // 隐藏应用
    'cmd+option+esc',  // 强制退出
    'ctrl+cmd+q',      // 锁定屏幕
  ],
  linux: [
    'ctrl+alt+f1',     // 切换到TTY1
    'ctrl+alt+delete', // 系统菜单
    'alt+tab',         // 应用切换
    'super',           // 应用启动器
  ]
} as const;

/**
 * 将按键适配到当前平台
 */
export function adaptKeystrokeToPlatform(keystroke: ParsedKeystroke): ParsedKeystroke {
  const platformMapping = PLATFORM_KEY_MAPPINGS[CURRENT_PLATFORM];
  const adapted: ParsedKeystroke = { ...keystroke };

  // 处理meta键的映射
  if (adapted.meta) {
    // 根据平台映射meta键
    const mappedKey = platformMapping.meta;
    if (mappedKey !== 'meta') {
      // 清除meta标志，设置对应的平台特定标志
      adapted.meta = undefined;
      
      switch (mappedKey) {
        case 'win':
          adapted.win = true;
          break;
        case 'cmd':
          adapted.cmd = true;
          break;
        case 'ctrl':
          adapted.ctrl = true;
          break;
      }
    }
  }

  // 处理command键的映射（macOS特定）
  if (adapted.command) {
    const mappedKey = platformMapping.command;
    adapted.command = undefined;
    
    switch (mappedKey) {
      case 'win':
        adapted.win = true;
        break;
      case 'cmd':
        adapted.cmd = true;
        break;
      case 'meta':
        adapted.meta = true;
        break;
    }
  }

  return adapted;
}

/**
 * 将按键显示名称适配到当前平台
 */
export function getPlatformDisplayName(key: string): string {
  const displayNames = PLATFORM_DISPLAY_NAMES[CURRENT_PLATFORM];
  return displayNames[key as keyof typeof displayNames] || key;
}

/**
 * 格式化按键为平台特定的显示文本
 */
export function formatKeystrokeForPlatform(keystroke: ParsedKeystroke): string {
  const parts: string[] = [];
  
  // 按特定顺序添加修饰键
  if (keystroke.ctrl) parts.push(getPlatformDisplayName('ctrl'));
  if (keystroke.alt) parts.push(getPlatformDisplayName('alt'));
  if (keystroke.shift) parts.push(getPlatformDisplayName('shift'));
  
  // 平台特定的修饰键
  if (keystroke.meta) parts.push(getPlatformDisplayName('meta'));
  if (keystroke.win) parts.push(getPlatformDisplayName('win'));
  if (keystroke.cmd) parts.push(getPlatformDisplayName('cmd'));
  if (keystroke.command) parts.push(getPlatformDisplayName('command'));
  
  // 添加主键
  if (keystroke.key) {
    const displayKey = getKeyDisplayName(keystroke.key);
    parts.push(displayKey);
  }
  
  return parts.join('+');
}

/**
 * 获取键的显示名称
 */
function getKeyDisplayName(key: string): string {
  const keyMappings: Record<string, string> = {
    'escape': 'Esc',
    'enter': 'Enter',
    'tab': 'Tab',
    'space': 'Space',
    'backspace': 'Backspace',
    'delete': 'Delete',
    'insert': 'Insert',
    'home': 'Home',
    'end': 'End',
    'pageup': 'Page Up',
    'pagedown': 'Page Down',
    'up': '↑',
    'down': '↓',
    'left': '←',
    'right': '→',
    'f1': 'F1',
    'f2': 'F2',
    'f3': 'F3',
    'f4': 'F4',
    'f5': 'F5',
    'f6': 'F6',
    'f7': 'F7',
    'f8': 'F8',
    'f9': 'F9',
    'f10': 'F10',
    'f11': 'F11',
    'f12': 'F12',
  };
  
  return keyMappings[key.toLowerCase()] || key.toUpperCase();
}

/**
 * 检查是否为平台保留的快捷键
 */
export function isPlatformReservedShortcut(keystroke: ParsedKeystroke): boolean {
  const platformShortcuts = PLATFORM_RESERVED_SHORTCUTS[CURRENT_PLATFORM];
  const keystrokeText = formatKeystrokeForPlatform(keystroke).toLowerCase();
  
  return platformShortcuts.some(shortcut => 
    shortcut.toLowerCase() === keystrokeText
  );
}

/**
 * 获取当前平台的按键绑定建议
 */
export function getPlatformKeybindingSuggestions(): Record<string, string> {
  const suggestions: Record<string, string> = {};
  
  switch (CURRENT_PLATFORM) {
    case 'windows':
      suggestions['ctrl+shift+esc'] = '任务管理器';
      suggestions['win+shift+s'] = '截图工具';
      suggestions['win+v'] = '剪贴板历史';
      suggestions['win+i'] = '设置';
      break;
      
    case 'macos':
      suggestions['cmd+shift+3'] = '全屏截图';
      suggestions['cmd+shift+4'] = '区域截图';
      suggestions['cmd+space'] = 'Spotlight搜索';
      suggestions['cmd+option+esc'] = '强制退出';
      break;
      
    case 'linux':
      suggestions['ctrl+alt+t'] = '打开终端';
      suggestions['super'] = '应用启动器';
      suggestions['alt+tab'] = '应用切换';
      suggestions['printscreen'] = '截图';
      break;
  }
  
  return suggestions;
}

/**
 * 平台特定的按键绑定配置
 */
export function getPlatformSpecificBindings(): Record<string, string> {
  const bindings: Record<string, string> = {};
  
  switch (CURRENT_PLATFORM) {
    case 'windows':
      // Windows特定的绑定
      bindings['win+`'] = 'app:switchWindow';
      bindings['win+1'] = 'app:quickAccess1';
      bindings['win+2'] = 'app:quickAccess2';
      break;
      
    case 'macos':
      // macOS特定的绑定
      bindings['cmd+`'] = 'app:switchWindow';
      bindings['cmd+option+space'] = 'app:emojiPicker';
      bindings['ctrl+cmd+space'] = 'app:characterViewer';
      break;
      
    case 'linux':
      // Linux特定的绑定
      bindings['super+tab'] = 'app:switchWindow';
      bindings['ctrl+alt+l'] = 'app:lockScreen';
      break;
  }
  
  return bindings;
}

/**
 * 检测按键冲突
 */
export function detectKeybindingConflicts(
  bindings: Array<{ chord: ParsedKeystroke[]; action: string; context: string }>
): Array<{ conflict: string; actions: string[] }> {
  const conflicts: Array<{ conflict: string; actions: string[] }> = [];
  const chordMap = new Map<string, string[]>();
  
  // 收集所有和弦序列
  for (const binding of bindings) {
    const chordKey = binding.chord.map(k => JSON.stringify(k)).join('|');
    if (!chordMap.has(chordKey)) {
      chordMap.set(chordKey, []);
    }
    chordMap.get(chordKey)!.push(`${binding.action} (${binding.context})`);
  }
  
  // 检查冲突
  for (const [chordKey, actions] of chordMap.entries()) {
    if (actions.length > 1) {
      conflicts.push({
        conflict: chordKey,
        actions: actions
      });
    }
  }
  
  return conflicts;
}

/**
 * 平台适配的绑定加载器
 */
export function loadPlatformAdaptedBindings(
  defaultBindings: Array<{ chord: ParsedKeystroke[]; action: string; context: string }>
): Array<{ chord: ParsedKeystroke[]; action: string; context: string }> {
  const adaptedBindings = [...defaultBindings];
  
  // 添加平台特定的绑定
  const platformBindings = getPlatformSpecificBindings();
  for (const [chordString, action] of Object.entries(platformBindings)) {
    // 这里需要解析和弦字符串，但为了简化，我们假设已经解析好了
    // 在实际实现中，需要调用parseChord函数
    adaptedBindings.push({
      chord: [], // 这里需要实际解析
      action,
      context: 'Global'
    });
  }
  
  return adaptedBindings;
}

/**
 * 平台信息工具
 */
export function getPlatformInfo() {
  return {
    platform: CURRENT_PLATFORM,
    displayNames: PLATFORM_DISPLAY_NAMES[CURRENT_PLATFORM],
    reservedShortcuts: PLATFORM_RESERVED_SHORTCUTS[CURRENT_PLATFORM],
    suggestions: getPlatformKeybindingSuggestions()
  };
}