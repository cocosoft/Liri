// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Computer Use 适配器的**输入安全边界**（2026-11-21，P0）
 *
 * 背景（`.trae/specs/browser-use-and-computer-use-completion.md` §1.4 S1–S3）：
 * 三个平台适配器都把工具入参**直接字符串插值**进 PowerShell / AppleScript 脚本：
 *   - `Start-Process '${path}'`、`FindWindow(..., '${title}')`、`SendWait('{${key}}')`；
 *   - `keystroke "${key}"`、`tell application "${bundleId}"`；
 *   - 以及坐标 / 时长 / 质量等**数字位**（JSON 里传字符串即可注入）。
 *
 * 本模块只做两件事，且只有这两个入口：
 *   ① **文本**一律走「编码后注入」（PowerShell: base64 解码表达式；AppleScript: 字面量转义），
 *      永不把原始文本拼进脚本；
 *   ② **按键名**走白名单映射（未知按键直接拒绝），**数字**走范围校验。
 *
 * 只读纯函数，便于单测（不触碰真实桌面）。
 */

/** 入参非法（注入尝试 / 类型不符 / 超出范围）——调用方应转成工具失败，不得静默放行 */
export class UnsafeComputerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeComputerInputError';
  }
}

/** 有限整数 + 范围校验（拦截 `NaN`、小数、字符串注入） */
export function requireInt(
  value: unknown,
  name: string,
  opts?: { min?: number; max?: number }
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new UnsafeComputerInputError(`${name} 必须是整数（收到 ${JSON.stringify(value)}）`);
  }
  if (opts?.min !== undefined && value < opts.min) {
    throw new UnsafeComputerInputError(`${name} 不得小于 ${opts.min}（收到 ${value}）`);
  }
  if (opts?.max !== undefined && value > opts.max) {
    throw new UnsafeComputerInputError(`${name} 不得大于 ${opts.max}（收到 ${value}）`);
  }
  return value;
}

/** 有限数字（允许小数，如截图质量） */
export function requireNumber(
  value: unknown,
  name: string,
  opts?: { min?: number; max?: number }
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new UnsafeComputerInputError(`${name} 必须是有限数字（收到 ${JSON.stringify(value)}）`);
  }
  if (opts?.min !== undefined && value < opts.min) {
    throw new UnsafeComputerInputError(`${name} 不得小于 ${opts.min}（收到 ${value}）`);
  }
  if (opts?.max !== undefined && value > opts.max) {
    throw new UnsafeComputerInputError(`${name} 不得大于 ${opts.max}（收到 ${value}）`);
  }
  return value;
}

/**
 * 把任意文本变成**无插值**的 PowerShell 表达式（UTF-8 base64 解码）。
 *
 * base64 字母表只有 `A-Za-z0-9+/=`，不含引号、`$`、`;`、反引号 ⇒ 拼进单引号字符串绝对安全。
 * 例：`psBase64Expression("C:\\a'; Start-Process calc")`
 *   ⇒ `[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('Qzpc...'))`
 */
export function psBase64Expression(value: string): string {
  const encoded = Buffer.from(value, 'utf-8').toString('base64');
  return `[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`;
}

/**
 * SendKeys 的**命名键白名单**（键名 → SendKeys 记号）。
 *
 * 只收录有确定语义的键；未收录的一律拒绝（禁止 `action.key` 原样进脚本）。
 */
const SENDKEYS_NAMED: Readonly<Record<string, string>> = Object.freeze({
  enter: 'ENTER',
  return: 'ENTER',
  tab: 'TAB',
  esc: 'ESC',
  escape: 'ESC',
  backspace: 'BACKSPACE',
  delete: 'DELETE',
  del: 'DELETE',
  insert: 'INS',
  ins: 'INS',
  home: 'HOME',
  end: 'END',
  up: 'UP',
  down: 'DOWN',
  left: 'LEFT',
  right: 'RIGHT',
  pageup: 'PGUP',
  pgup: 'PGUP',
  pagedown: 'PGDN',
  pgdn: 'PGDN',
  space: 'SPACE',
  capslock: 'CAPSLOCK',
  numlock: 'NUMLOCK',
  scrolllock: 'SCROLLLOCK',
  printscreen: 'PRTSC',
  pause: 'PAUSE',
  break: 'BREAK',
  help: 'HELP',
  add: 'ADD',
  subtract: 'SUBTRACT',
  multiply: 'MULTIPLY',
  divide: 'DIVIDE',
  ...Object.fromEntries(
    Array.from({ length: 16 }, (_, i) => [`f${i + 1}`, `F${i + 1}`])
  ),
});

/** SendKeys 里可**直接作为单字符**发送的字符（排除 `+^%~(){}[]` 等语法字符） */
const SENDKEYS_SAFE_CHAR = /^[A-Za-z0-9 .,;:!?'"@#$&*_\-=/\\|<>`]$/;

/**
 * 把按键名归一为 SendKeys 的**单键记号**（供 `{TOKEN}` 形式使用）。
 * @throws UnsafeComputerInputError 未知/危险按键
 */
export function toSendKeysToken(raw: string): string {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key) throw new UnsafeComputerInputError('按键名不能为空');
  const named = SENDKEYS_NAMED[key.toLowerCase()];
  if (named) return named;
  if (key.length === 1 && SENDKEYS_SAFE_CHAR.test(key)) return key.toUpperCase();
  throw new UnsafeComputerInputError(
    `不支持的按键名 ${JSON.stringify(raw)}（仅允许字母数字、常用符号与 F1–F16/方向键/编辑键等命名键）`
  );
}

/**
 * 把按键名归一为 SendKeys 的**片段**（组合键里用）：
 * 命名键返回 `{TOKEN}`，单字符原样返回（不需要花括号）。
 */
export function toSendKeysFragment(raw: string): string {
  const token = toSendKeysToken(raw);
  return token.length === 1 ? token : `{${token}}`;
}

/** 组合键修饰键白名单 */
const SENDKEYS_MODIFIERS: Readonly<Record<string, string>> = Object.freeze({
  ctrl: '^',
  control: '^',
  alt: '%',
  shift: '+',
  // Windows 上没有真正的「Win 键」SendKeys 记号；沿用既有退化语义（Ctrl）并在文档中如实标注
  win: '^',
  windows: '^',
  meta: '^',
});

/**
 * 构建组合键片段（如 `ctrl+shift+esc` ⇒ `^+{ESC}`）。
 * @throws UnsafeComputerInputError 修饰键或主键非法
 */
export function buildSendKeysCombination(raw: string): string {
  const parts = String(raw)
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new UnsafeComputerInputError('组合键不能为空');
  const mainKey = parts[parts.length - 1];
  let prefix = '';
  for (const mod of parts.slice(0, -1)) {
    const token = SENDKEYS_MODIFIERS[mod];
    if (!token) {
      throw new UnsafeComputerInputError(
        `不支持的修饰键 ${JSON.stringify(mod)}（仅允许 ctrl/alt/shift/win）`
      );
    }
    prefix += token;
  }
  return `${prefix}${toSendKeysFragment(mainKey)}`;
}

/**
 * AppleScript 字符串字面量的转义（`\` 与 `"`）。
 *
 * 用于 `keystroke "<key>"` / `tell application "<id>"`：转义后内容无法闭合引号或续行。
 * 换行/回车直接拒绝（AppleScript 里换行会改变代码结构，不是按键语义）。
 */
export function escapeAppleScriptString(value: string): string {
  const text = typeof value === 'string' ? value : '';
  if (/[\r\n]/.test(text)) {
    throw new UnsafeComputerInputError('字符串不能包含换行（会被解释为脚本换行）');
  }
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
