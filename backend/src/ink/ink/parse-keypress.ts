/**
 * 按键解析模块
 * 解析终端按键输入
 */

export interface KeyPress {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  raw?: string;
}

export interface ParsedKey {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  value?: string;
  fn?: boolean;
  option?: boolean;
  super?: boolean;
  sequence?: string;
  code?: string;
}

export interface ParsedMouse {
  type: string;
  row: number;
  col: number;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

export type ParsedInput = ParsedKey | ParsedMouse;

export type TerminalResponse = string;

export const INITIAL_STATE = {
  input: '',
  parsed: null,
};

export const nonAlphanumericKeys: Record<string, string> = {
  escape: 'escape',
  return: 'return',
  tab: 'tab',
  backspace: 'backspace',
  delete: 'delete',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
  space: 'space',
};

export function parseMultipleKeypresses(data: string, callback: (key: ParsedKey) => void): void {
  for (const char of data) {
    callback({
      name: char,
      ctrl: false,
      meta: false,
      shift: false,
      alt: false,
      value: char,
    });
  }
}

const KEY_MAP: Record<string, string> = {
  '\x1b': 'escape',
  '\n': 'return',
  '\r': 'return',
  '\t': 'tab',
  '\b': 'backspace',
  '\x7f': 'backspace',
  '\x1b[A': 'up',
  '\x1b[B': 'down',
  '\x1b[C': 'right',
  '\x1b[D': 'left',
  '\x1b[H': 'home',
  '\x1b[F': 'end',
  '\x1b[3~': 'delete',
  '\x1b[5~': 'pageup',
  '\x1b[6~': 'pagedown',
  '\x1b[Z': 'shift+tab',
};

const CSI_MAP: Record<string, string> = {
  'A': 'up',
  'B': 'down',
  'C': 'right',
  'D': 'left',
  'H': 'home',
  'F': 'end',
  'P': 'delete',
  '5': 'pageup',
  '6': 'pagedown',
};

export function parseKeyPress(input: string): KeyPress {
  const result: KeyPress = {
    key: '',
    raw: input,
  };

  if (!input) {
    return result;
  }

  if (KEY_MAP[input]) {
    result.key = KEY_MAP[input];
    return result;
  }

  if (input.startsWith('\x1b[')) {
    const csiCode = input.slice(2);
    
    if (csiCode.length === 1 && CSI_MAP[csiCode]) {
      result.key = CSI_MAP[csiCode];
      return result;
    }

    if (csiCode.startsWith('1;')) {
      const modifier = csiCode[2];
      const keyCode = csiCode[3];
      
      if (modifier === '5' && CSI_MAP[keyCode]) {
        result.ctrl = true;
        result.key = CSI_MAP[keyCode];
        return result;
      }
      if (modifier === '3' && CSI_MAP[keyCode]) {
        result.alt = true;
        result.key = CSI_MAP[keyCode];
        return result;
      }
      if (modifier === '2' && CSI_MAP[keyCode]) {
        result.shift = true;
        result.key = CSI_MAP[keyCode];
        return result;
      }
    }

    result.key = csiCode;
    return result;
  }

  if (input.length === 1) {
    const charCode = input.charCodeAt(0);
    
    if (charCode >= 1 && charCode <= 26) {
      result.ctrl = true;
      result.key = String.fromCharCode(charCode + 64).toLowerCase();
      return result;
    }

    if (input === input.toUpperCase() && input !== input.toLowerCase()) {
      result.shift = true;
    }
    
    result.key = input.toLowerCase();
    return result;
  }

  result.key = input;
  return result;
}

export function isSpecialKey(key: string): boolean {
  const specialKeys = [
    'escape', 'return', 'tab', 'backspace', 'delete',
    'up', 'down', 'left', 'right', 'home', 'end',
    'pageup', 'pagedown', 'enter', 'space',
  ];
  return specialKeys.includes(key);
}

export function formatKeyPress(keyPress: KeyPress): string {
  const parts: string[] = [];
  
  if (keyPress.ctrl) parts.push('ctrl');
  if (keyPress.meta) parts.push('meta');
  if (keyPress.shift) parts.push('shift');
  if (keyPress.alt) parts.push('alt');
  
  parts.push(keyPress.key);
  
  return parts.join('+');
}