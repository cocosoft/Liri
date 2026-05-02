/**
 * 按键序列解析器
 */
import type { ParsedKeystroke, KeyModifier } from './types.js';

/**
 * 解析按键字符串为ParsedKeystroke对象
 * @param keystroke 按键字符串，如 "ctrl+a" 或 "shift+tab"
 * @returns 解析后的按键对象
 */
export function parseKeystroke(keystroke: string): ParsedKeystroke {
  const parts = keystroke.toLowerCase().split('+');
  const result: ParsedKeystroke = { key: '' };

  for (const part of parts) {
    switch (part) {
      case 'ctrl':
      case 'control':
        result.ctrl = true;
        break;
      case 'alt':
      case 'opt':
      case 'option':
        result.alt = true;
        break;
      case 'shift':
        result.shift = true;
        break;
      case 'meta':
      case 'cmd':
      case 'command':
        result.meta = true;
        break;
      case 'escape':
      case 'esc':
        result.key = 'escape';
        break;
      case 'enter':
      case 'return':
        result.key = 'enter';
        break;
      case 'tab':
        result.key = 'tab';
        break;
      case 'space':
        result.key = 'space';
        break;
      case 'backspace':
        result.key = 'backspace';
        break;
      case 'delete':
        result.key = 'delete';
        break;
      case 'up':
        result.key = 'up';
        break;
      case 'down':
        result.key = 'down';
        break;
      case 'left':
        result.key = 'left';
        break;
      case 'right':
        result.key = 'right';
        break;
      default:
        // 如果是单个字符，直接作为键值
        if (part.length === 1) {
          result.key = part;
        } else {
          // 特殊键处理
          result.key = part;
        }
        break;
    }
  }

  // 如果没有设置键值，使用最后一个部分作为键值
  if (!result.key && parts.length > 0) {
    const lastPart = parts[parts.length - 1];
    if (lastPart.length === 1) {
      result.key = lastPart;
    }
  }

  return result;
}

/**
 * 解析和弦序列
 * @param chordString 和弦字符串，如 "ctrl+k ctrl+s"
 * @returns 解析后的按键序列数组
 */
export function parseChord(chordString: string): ParsedKeystroke[] {
  if (!chordString.trim()) {
    return [];
  }

  const keystrokes = chordString.split(' ').filter(Boolean);
  return keystrokes.map(parseKeystroke);
}

/**
 * 将ParsedKeystroke格式化为显示文本
 * @param keystroke 解析后的按键
 * @returns 格式化后的按键文本
 */
export function formatKeystroke(keystroke: ParsedKeystroke): string {
  const parts: string[] = [];

  if (keystroke.ctrl) parts.push('ctrl');
  if (keystroke.alt) parts.push('alt');
  if (keystroke.shift) parts.push('shift');
  if (keystroke.meta) parts.push('meta');

  // 处理特殊键的显示
  let displayKey = keystroke.key;
  switch (keystroke.key) {
    case 'escape':
      displayKey = 'esc';
      break;
    case 'enter':
      displayKey = 'enter';
      break;
    case 'space':
      displayKey = 'space';
      break;
    case 'backspace':
      displayKey = 'backspace';
      break;
    case 'delete':
      displayKey = 'delete';
      break;
    default:
      // 保持原样
      break;
  }

  parts.push(displayKey);
  return parts.join('+');
}

/**
 * 将和弦序列格式化为显示文本
 * @param chord 和弦序列
 * @returns 格式化后的和弦文本
 */
export function formatChord(chord: ParsedKeystroke[]): string {
  return chord.map(formatKeystroke).join(' ');
}

/**
 * 比较两个按键是否相同
 * @param a 第一个按键
 * @param b 第二个按键
 * @returns 是否相同
 */
export function keystrokesEqual(a: ParsedKeystroke, b: ParsedKeystroke): boolean {
  return (
    a.key === b.key &&
    !!a.ctrl === !!b.ctrl &&
    !!a.alt === !!b.alt &&
    !!a.shift === !!b.shift &&
    !!a.meta === !!b.meta
  );
}

/**
 * 比较两个和弦序列是否相同
 * @param a 第一个和弦
 * @param b 第二个和弦
 * @returns 是否相同
 */
export function chordsEqual(a: ParsedKeystroke[], b: ParsedKeystroke[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (!keystrokesEqual(a[i], b[i])) {
      return false;
    }
  }

  return true;
}

/**
 * 检查按键是否匹配
 * @param input 输入的按键
 * @param binding 绑定的按键
 * @returns 是否匹配
 */
export function keystrokeMatches(input: ParsedKeystroke, binding: ParsedKeystroke): boolean {
  return (
    input.key === binding.key &&
    (input.ctrl || false) === (binding.ctrl || false) &&
    (input.alt || false) === (binding.alt || false) &&
    (input.shift || false) === (binding.shift || false) &&
    (input.meta || false) === (binding.meta || false)
  );
}

/**
 * 检查和弦序列是否匹配
 * @param input 输入的序列
 * @param binding 绑定的序列
 * @returns 是否匹配
 */
export function chordMatches(input: ParsedKeystroke[], binding: ParsedKeystroke[]): boolean {
  if (input.length < binding.length) {
    return false;
  }

  for (let i = 0; i < binding.length; i++) {
    if (!keystrokeMatches(input[i], binding[i])) {
      return false;
    }
  }

  return true;
}

/**
 * 检查按键是否包含修饰符
 * @param keystroke 按键
 * @returns 是否包含修饰符
 */
export function hasModifiers(keystroke: ParsedKeystroke): boolean {
  return !!(keystroke.ctrl || keystroke.alt || keystroke.shift || keystroke.meta);
}

/**
 * 获取按键的修饰符列表
 * @param keystroke 按键
 * @returns 修饰符列表
 */
export function getModifiers(keystroke: ParsedKeystroke): KeyModifier[] {
  const modifiers: KeyModifier[] = [];
  if (keystroke.ctrl) modifiers.push('ctrl');
  if (keystroke.alt) modifiers.push('alt');
  if (keystroke.shift) modifiers.push('shift');
  if (keystroke.meta) modifiers.push('meta');
  return modifiers;
}