/**
 * SGR (Select Graphic Rendition) Parser
 *
 * Parses SGR parameters and applies them to a TextStyle.
 * Handles both semicolon (;) and colon (:) separated parameters.
 */

import type { Color, NamedColor, TextStyle, UnderlineStyle } from './types.js';
import { defaultStyle } from './types.js';

const NAMED_COLORS: NamedColor[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
];

const UNDERLINE_STYLES: UnderlineStyle[] = [
  'none',
  'single',
  'double',
  'curly',
  'dotted',
  'dashed',
];

type Param = { value: number | null; subparams: number[]; colon: boolean };

function parseParams(str: string): Param[] {
  if (str === '') return [{ value: 0, subparams: [], colon: false }];

  const result: Param[] = [];
  let current: Param = { value: null, subparams: [], colon: false };
  let num = '';
  let inSub = false;

  for (let i = 0; i <= str.length; i++) {
    const c = str[i];
    if (c === ';' || c === undefined) {
      const n = num === '' ? null : parseInt(num, 10);
      if (inSub) {
        if (n !== null) current.subparams.push(n);
      } else {
        current.value = n;
      }
      result.push(current);
      current = { value: null, subparams: [], colon: false };
      num = '';
      inSub = false;
    } else if (c === ':') {
      const n = num === '' ? null : parseInt(num, 10);
      if (!inSub) {
        current.value = n;
        current.colon = true;
        inSub = true;
      } else {
        if (n !== null) current.subparams.push(n);
      }
      num = '';
    } else if (c >= '0' && c <= '9') {
      num += c;
    }
  }
  return result;
}

function parseExtendedColor(
  params: Param[],
  idx: number
): { r: number; g: number; b: number } | { index: number } | null {
  const p = params[idx];
  if (!p) return null;

  if (p.colon && p.subparams.length >= 1) {
    if (p.subparams[0] === 5 && p.subparams.length >= 2) {
      return { index: p.subparams[1]! };
    }
    if (p.subparams[0] === 2 && p.subparams.length >= 4) {
      const off = p.subparams.length >= 5 ? 1 : 0;
      return {
        r: p.subparams[1 + off]!,
        g: p.subparams[2 + off]!,
        b: p.subparams[3 + off]!,
      };
    }
  }

  const next = params[idx + 1];
  if (!next) return null;
  if (
    next.value === 5 &&
    params[idx + 2]?.value !== null &&
    params[idx + 2]?.value !== undefined
  ) {
    return { index: params[idx + 2]!.value! };
  }
  if (next.value === 2) {
    const r = params[idx + 2]?.value;
    const g = params[idx + 3]?.value;
    const b = params[idx + 4]?.value;
    if (
      r !== null &&
      r !== undefined &&
      g !== null &&
      g !== undefined &&
      b !== null &&
      b !== undefined
    ) {
      return { r, g, b };
    }
  }
  return null;
}

/** 扩展色码 → 目标字段（38 前景 / 48 背景 / 58 下划线色） */
const EXTENDED_COLOR_FIELDS: Record<number, 'fg' | 'bg' | 'underlineColor'> = {
  38: 'fg',
  48: 'bg',
  58: 'underlineColor',
};

/**
 * P3-2（2026-11-16）：扩展色段（38/48/58）**原样外移** —— 三处同构分支合一。
 *
 * @returns 目标字段、颜色与需前进的参数个数（分号写法 256 色 3 个 / 真彩色 5 个，
 *          冒号写法一律 1 个）；非扩展色或分量残缺 ⇒ null（调用方按未知码跳过）
 */
function resolveExtendedColor(
  params: Param[],
  idx: number,
  code: number
): {
  field: 'fg' | 'bg' | 'underlineColor';
  color: Color;
  advance: number;
} | null {
  const field = EXTENDED_COLOR_FIELDS[code];
  if (!field) return null;
  const c = parseExtendedColor(params, idx);
  if (!c) return null;
  const color: Color =
    'index' in c ? { type: 'indexed', index: c.index } : { type: 'rgb', ...c };
  const advance = params[idx]!.colon ? 1 : 'index' in c ? 3 : 5;
  return { field, color, advance };
}

export function applySGR(paramStr: string, style: TextStyle): TextStyle {
  const params = parseParams(paramStr);
  let s = { ...style };
  let i = 0;

  while (i < params.length) {
    const p = params[i]!;
    const code = p.value ?? 0;

    if (code === 0) {
      s = defaultStyle();
      i++;
      continue;
    }
    if (code === 1) {
      s.bold = true;
      i++;
      continue;
    }
    if (code === 2) {
      s.dim = true;
      i++;
      continue;
    }
    if (code === 3) {
      s.italic = true;
      i++;
      continue;
    }
    if (code === 4) {
      s.underline = p.colon
        ? (UNDERLINE_STYLES[p.subparams[0]!] ?? 'single')
        : 'single';
      i++;
      continue;
    }
    if (code === 5 || code === 6) {
      s.blink = true;
      i++;
      continue;
    }
    if (code === 7) {
      s.inverse = true;
      i++;
      continue;
    }
    if (code === 8) {
      s.hidden = true;
      i++;
      continue;
    }
    if (code === 9) {
      s.strikethrough = true;
      i++;
      continue;
    }
    if (code === 21) {
      s.underline = 'double';
      i++;
      continue;
    }
    if (code === 22) {
      s.bold = false;
      s.dim = false;
      i++;
      continue;
    }
    if (code === 23) {
      s.italic = false;
      i++;
      continue;
    }
    if (code === 24) {
      s.underline = 'none';
      i++;
      continue;
    }
    if (code === 25) {
      s.blink = false;
      i++;
      continue;
    }
    if (code === 27) {
      s.inverse = false;
      i++;
      continue;
    }
    if (code === 28) {
      s.hidden = false;
      i++;
      continue;
    }
    if (code === 29) {
      s.strikethrough = false;
      i++;
      continue;
    }
    if (code === 53) {
      s.overline = true;
      i++;
      continue;
    }
    if (code === 55) {
      s.overline = false;
      i++;
      continue;
    }

    if (code >= 30 && code <= 37) {
      s.fg = { type: 'named', name: NAMED_COLORS[code - 30]! };
      i++;
      continue;
    }
    if (code === 39) {
      s.fg = { type: 'default' };
      i++;
      continue;
    }
    if (code >= 40 && code <= 47) {
      s.bg = { type: 'named', name: NAMED_COLORS[code - 40]! };
      i++;
      continue;
    }
    if (code === 49) {
      s.bg = { type: 'default' };
      i++;
      continue;
    }
    if (code >= 90 && code <= 97) {
      s.fg = { type: 'named', name: NAMED_COLORS[code - 90 + 8]! };
      i++;
      continue;
    }
    if (code >= 100 && code <= 107) {
      s.bg = { type: 'named', name: NAMED_COLORS[code - 100 + 8]! };
      i++;
      continue;
    }

    // 扩展色（38/48/58，P3-2：原样外移到 resolveExtendedColor）
    if (code === 38 || code === 48 || code === 58) {
      const resolved = resolveExtendedColor(params, i, code);
      if (resolved) {
        s[resolved.field] = resolved.color;
        i += resolved.advance;
        continue;
      }
    }
    if (code === 59) {
      s.underlineColor = { type: 'default' };
      i++;
      continue;
    }

    i++;
  }
  return s;
}
