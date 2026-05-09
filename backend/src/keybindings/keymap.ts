/**
 * 键位映射模块
 * 定义键位映射表
 */

export interface KeyMapEntry {
  key: string;
  label: string;
  description: string;
}

export const KEY_MAP: Record<string, KeyMapEntry> = {
  // 基本方向键
  h: { key: 'h', label: 'h', description: 'Left' },
  j: { key: 'j', label: 'j', description: 'Down' },
  k: { key: 'k', label: 'k', description: 'Up' },
  l: { key: 'l', label: 'l', description: 'Right' },

  // 方向键别名
  Left: { key: 'Left', label: '←', description: 'Left Arrow' },
  Right: { key: 'Right', label: '→', description: 'Right Arrow' },
  Up: { key: 'Up', label: '↑', description: 'Up Arrow' },
  Down: { key: 'Down', label: '↓', description: 'Down Arrow' },

  // 控制键
  Ctrl: { key: 'Ctrl', label: 'Ctrl', description: 'Control' },
  Shift: { key: 'Shift', label: 'Shift', description: 'Shift' },
  Alt: { key: 'Alt', label: 'Alt', description: 'Alt' },
  Meta: { key: 'Meta', label: 'Meta', description: 'Meta' },

  // 功能键
  Enter: { key: 'Enter', label: 'Enter', description: 'Enter' },
  Escape: { key: 'Escape', label: 'Esc', description: 'Escape' },
  Tab: { key: 'Tab', label: 'Tab', description: 'Tab' },
  Backspace: { key: 'Backspace', label: 'Backspace', description: 'Backspace' },
  Delete: { key: 'Delete', label: 'Del', description: 'Delete' },
  Space: { key: 'Space', label: 'Space', description: 'Space' },

  // 功能键 F1-F12
  F1: { key: 'F1', label: 'F1', description: 'F1' },
  F2: { key: 'F2', label: 'F2', description: 'F2' },
  F3: { key: 'F3', label: 'F3', description: 'F3' },
  F4: { key: 'F4', label: 'F4', description: 'F4' },
  F5: { key: 'F5', label: 'F5', description: 'F5' },
  F6: { key: 'F6', label: 'F6', description: 'F6' },
  F7: { key: 'F7', label: 'F7', description: 'F7' },
  F8: { key: 'F8', label: 'F8', description: 'F8' },
  F9: { key: 'F9', label: 'F9', description: 'F9' },
  F10: { key: 'F10', label: 'F10', description: 'F10' },
  F11: { key: 'F11', label: 'F11', description: 'F11' },
  F12: { key: 'F12', label: 'F12', description: 'F12' },

  // 数字键
  '0': { key: '0', label: '0', description: 'Zero' },
  '1': { key: '1', label: '1', description: 'One' },
  '2': { key: '2', label: '2', description: 'Two' },
  '3': { key: '3', label: '3', description: 'Three' },
  '4': { key: '4', label: '4', description: 'Four' },
  '5': { key: '5', label: '5', description: 'Five' },
  '6': { key: '6', label: '6', description: 'Six' },
  '7': { key: '7', label: '7', description: 'Seven' },
  '8': { key: '8', label: '8', description: 'Eight' },
  '9': { key: '9', label: '9', description: 'Nine' },

  // 字母键
  a: { key: 'a', label: 'a', description: 'A' },
  b: { key: 'b', label: 'b', description: 'B' },
  c: { key: 'c', label: 'c', description: 'C' },
  d: { key: 'd', label: 'd', description: 'D' },
  e: { key: 'e', label: 'e', description: 'E' },
  f: { key: 'f', label: 'f', description: 'F' },
  g: { key: 'g', label: 'g', description: 'G' },
  i: { key: 'i', label: 'i', description: 'I' },
  m: { key: 'm', label: 'm', description: 'M' },
  n: { key: 'n', label: 'n', description: 'N' },
  o: { key: 'o', label: 'o', description: 'O' },
  p: { key: 'p', label: 'p', description: 'P' },
  q: { key: 'q', label: 'q', description: 'Q' },
  r: { key: 'r', label: 'r', description: 'R' },
  s: { key: 's', label: 's', description: 'S' },
  t: { key: 't', label: 't', description: 'T' },
  u: { key: 'u', label: 'u', description: 'U' },
  v: { key: 'v', label: 'v', description: 'V' },
  w: { key: 'w', label: 'w', description: 'W' },
  x: { key: 'x', label: 'x', description: 'X' },
  y: { key: 'y', label: 'y', description: 'Y' },
  z: { key: 'z', label: 'z', description: 'Z' },

  // 特殊字符
  ':': { key: ':', label: ':', description: 'Colon' },
  '/': { key: '/', label: '/', description: 'Slash' },
  '?': { key: '?', label: '?', description: 'Question' },
  '!': { key: '!', label: '!', description: 'Exclamation' },
};

/**
 * 获取键位信息
 */
export function getKeyInfo(key: string): KeyMapEntry | undefined {
  return KEY_MAP[key];
}

/**
 * 获取键位标签
 */
export function getKeyLabel(key: string): string {
  const entry = KEY_MAP[key];
  return entry ? entry.label : key;
}

/**
 * 获取键位描述
 */
export function getKeyDescription(key: string): string {
  const entry = KEY_MAP[key];
  return entry ? entry.description : key;
}

/**
 * 解析组合键
 */
export function parseCombination(keys: string): string[] {
  return keys.split(' ');
}

/**
 * 格式化组合键显示
 */
export function formatCombination(keys: string[]): string {
  return keys.map((k) => getKeyLabel(k)).join(' + ');
}
