/**
 * 默认按键绑定配置
 */
import type { ParsedBinding, KeybindingContextName } from './types.js';
import { parseChord, formatChord } from './parser.js';

/**
 * 默认按键绑定配置
 */
const DEFAULT_BINDINGS_CONFIG = {
  bindings: [
    {
      context: 'Global' as KeybindingContextName,
      bindings: {
        'ctrl+c': 'app:interrupt', // 中断当前操作
        'ctrl+z': 'app:undo', // 撤销
        'ctrl+d': 'app:copy', // 复制
        'ctrl+u': 'app:clearLine', // 清除行
        'ctrl+l': 'app:clearScreen', // 清屏
        'ctrl+r': 'history:search', // 搜索历史
        'ctrl+p': 'app:quickOpen', // 快速打开
        'ctrl+t': 'app:toggleTodos', // 切换待办事项
        'ctrl+g': 'chat:externalEditor', // 外部编辑器
        'ctrl+k': 'app:globalSearch', // 全局搜索
        escape: 'app:exit', // 退出
      },
    },
    {
      context: 'Chat' as KeybindingContextName,
      bindings: {
        enter: 'chat:submit', // 提交
        'shift+enter': 'chat:newline', // 换行
        'ctrl+enter': 'chat:submit', // 提交（备用）
        up: 'history:previous', // 上一条历史
        down: 'history:next', // 下一条历史
        'ctrl+up': 'history:previous', // 上一条历史
        'ctrl+down': 'history:next', // 下一条历史
        tab: 'autocomplete:accept', // 接受自动完成
        'ctrl+space': 'autocomplete:dismiss', // 关闭自动完成
        'ctrl+v': 'chat:imagePaste', // 粘贴图片
      },
    },
    {
      context: 'Autocomplete' as KeybindingContextName,
      bindings: {
        enter: 'autocomplete:accept', // 接受
        tab: 'autocomplete:accept', // 接受
        escape: 'autocomplete:dismiss', // 关闭
        up: 'autocomplete:previous', // 上一个
        down: 'autocomplete:next', // 下一个
        'ctrl+p': 'autocomplete:previous', // 上一个
        'ctrl+n': 'autocomplete:next', // 下一个
      },
    },
    {
      context: 'Confirmation' as KeybindingContextName,
      bindings: {
        y: 'confirm:yes', // 是
        n: 'confirm:no', // 否
        enter: 'confirm:yes', // 是（回车）
        escape: 'confirm:no', // 否（退出）
      },
    },
    {
      context: 'Help' as KeybindingContextName,
      bindings: {
        escape: 'help:close', // 关闭帮助
        q: 'help:close', // 关闭帮助
        enter: 'help:close', // 关闭帮助
      },
    },
    {
      context: 'Transcript' as KeybindingContextName,
      bindings: {
        q: 'transcript:exit', // 退出对话记录
        escape: 'transcript:exit', // 退出对话记录
        'ctrl+e': 'transcript:toggleShowAll', // 切换显示全部
      },
    },
    {
      context: 'Settings' as KeybindingContextName,
      bindings: {
        escape: 'settings:close', // 关闭设置
        enter: 'settings:close', // 关闭设置
        '/': 'settings:search', // 设置搜索
      },
    },
    {
      context: 'Select' as KeybindingContextName,
      bindings: {
        enter: 'select:accept', // 接受选择
        escape: 'select:cancel', // 取消选择
        up: 'select:previous', // 上一个
        down: 'select:next', // 下一个
        tab: 'select:next', // 下一个
        'shift+tab': 'select:previous', // 上一个
      },
    },
  ],
};

/**
 * 和弦绑定配置
 */
const CHORD_BINDINGS_CONFIG = {
  bindings: [
    {
      context: 'Global' as KeybindingContextName,
      bindings: {
        'ctrl+k ctrl+s': 'app:save', // 保存
        'ctrl+k ctrl+c': 'app:copyAll', // 复制全部
        'ctrl+k ctrl+l': 'app:clearAll', // 清除全部
        'ctrl+k ctrl+r': 'app:reload', // 重新加载
      },
    },
  ],
};

/**
 * 加载默认绑定
 */
export function loadDefaultBindings(): ParsedBinding[] {
  const bindings: ParsedBinding[] = [];

  // 处理单键绑定
  for (const block of DEFAULT_BINDINGS_CONFIG.bindings) {
    for (const [keyString, action] of Object.entries(block.bindings)) {
      const chord = parseChord(keyString);
      if (chord.length > 0) {
        bindings.push({
          action,
          context: block.context,
          chord: {
            chords: chord,
            displayText: formatChord(chord),
          },
        });
      }
    }
  }

  // 处理和弦绑定
  for (const block of CHORD_BINDINGS_CONFIG.bindings) {
    for (const [chordString, action] of Object.entries(block.bindings)) {
      const chord = parseChord(chordString);
      if (chord.length > 0) {
        bindings.push({
          action,
          context: block.context,
          chord: {
            chords: chord,
            displayText: formatChord(chord),
          },
        });
      }
    }
  }

  return bindings;
}

/**
 * 获取特定上下文的默认绑定
 */
export function getDefaultBindingsForContext(
  context: KeybindingContextName
): ParsedBinding[] {
  const allBindings = loadDefaultBindings();
  return allBindings.filter((binding) => binding.context === context);
}

/**
 * 获取特定动作的默认绑定
 */
export function getDefaultBindingForAction(
  action: string
): ParsedBinding | undefined {
  const allBindings = loadDefaultBindings();
  return allBindings.find((binding) => binding.action === action);
}

/**
 * 获取所有默认绑定的显示文本
 */
export function getDefaultBindingDisplayTexts(): Record<string, string> {
  const allBindings = loadDefaultBindings();
  const displayTexts: Record<string, string> = {};

  for (const binding of allBindings) {
    const key = `${binding.context}:${binding.action}`;
    displayTexts[key] = binding.chord.displayText;
  }

  return displayTexts;
}

/**
 * 检查是否是默认绑定
 */
export function isDefaultBinding(binding: ParsedBinding): boolean {
  const defaultBindings = loadDefaultBindings();
  return defaultBindings.some(
    (defaultBinding) =>
      defaultBinding.action === binding.action &&
      defaultBinding.context === binding.context &&
      defaultBinding.chord.displayText === binding.chord.displayText
  );
}
