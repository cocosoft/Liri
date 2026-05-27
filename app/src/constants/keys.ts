/**
 * 按键名称常量
 */

export const KEY_NAMES = {
  BACKSPACE: 'Backspace',
  TAB: 'Tab',
  ENTER: 'Enter',
  SHIFT: 'Shift',
  CTRL: 'Ctrl',
  ALT: 'Alt',
  ESCAPE: 'Escape',
  SPACE: 'Space',
  PAGE_UP: 'PageUp',
  PAGE_DOWN: 'PageDown',
  END: 'End',
  HOME: 'Home',
  LEFT_ARROW: 'LeftArrow',
  UP_ARROW: 'UpArrow',
  RIGHT_ARROW: 'RightArrow',
  DOWN_ARROW: 'DownArrow',
  INSERT: 'Insert',
  DELETE: 'Delete',
  F1: 'F1',
  F2: 'F2',
  F3: 'F3',
  F4: 'F4',
  F5: 'F5',
  F6: 'F6',
  F7: 'F7',
  F8: 'F8',
  F9: 'F9',
  F10: 'F10',
  F11: 'F11',
  F12: 'F12',
} as const;

export const MODIFIER_KEYS = ['Shift', 'Ctrl', 'Alt', 'Meta'] as const;

export const NAVIGATION_KEYS = [
  'PageUp',
  'PageDown',
  'End',
  'Home',
  'LeftArrow',
  'UpArrow',
  'RightArrow',
  'DownArrow',
] as const;

export const FUNCTION_KEYS = [
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
] as const;

export const EDITING_KEYS = [
  'Backspace',
  'Tab',
  'Enter',
  'Insert',
  'Delete',
] as const;

export const KEY_ALIASES: Record<string, string[]> = {
  escape: ['Escape', 'Esc'],
  return: ['Enter', 'Return'],
  up: ['UpArrow', 'ArrowUp'],
  down: ['DownArrow', 'ArrowDown'],
  left: ['LeftArrow', 'ArrowLeft'],
  right: ['RightArrow', 'ArrowRight'],
  space: ['Space', ' '],
  tab: ['Tab', '\t'],
  enter: ['Enter', 'Return'],
  backspace: ['Backspace', 'Back'],
  delete: ['Delete', 'Del'],
};

export type KeyName = (typeof KEY_NAMES)[keyof typeof KEY_NAMES];
export type ModifierKey = (typeof MODIFIER_KEYS)[number];
export type NavigationKey = (typeof NAVIGATION_KEYS)[number];
export type FunctionKey = (typeof FUNCTION_KEYS)[number];
export type EditingKey = (typeof EDITING_KEYS)[number];
