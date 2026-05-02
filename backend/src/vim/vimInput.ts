/**
 * Vim 集成模块
 *
 * 在终端输入中提供 Vim 风格的光标移动和编辑操作。
 * 支持 Normal/Insert/Visual 模式切换。
 */

export type VimMode = 'INSERT' | 'NORMAL' | 'VISUAL'

export type VimOperator = 'delete' | 'change' | 'yank' | 'replace'

export interface VimState {
  mode: VimMode
  /** NORMAL 模式下正在构建的命令 */
  pendingOperator?: VimOperator
  pendingCount?: number
  /** 最后一次查找的字符 */
  lastFindChar?: string
  /** 寄存器内容 */
  register: string
  /** 是否为行级操作 */
  registerLinewise: boolean
  /** Visual模式下的选择起点 */
  visualStart?: number
  /** 是否启用增量搜索 */
  incrementalSearch?: boolean
}

export interface VimContext {
  text: string
  cursorOffset: number
  setText: (text: string) => void
  setCursorOffset: (offset: number) => void
}

const MOTIONS: Record<string, (ctx: VimContext) => number> = {
  h: (ctx) => Math.max(0, ctx.cursorOffset - 1),
  l: (ctx) => Math.min(ctx.text.length, ctx.cursorOffset + 1),
  j: (ctx) => moveVertical(ctx, 1),
  k: (ctx) => moveVertical(ctx, -1),
  '0': (ctx) => findLineStart(ctx),
  '^': (ctx) => findFirstNonBlank(ctx),
  $: (ctx) => findLineEnd(ctx),
  w: (ctx) => nextWordStart(ctx),
  b: (ctx) => prevWordStart(ctx),
  e: (ctx) => nextWordEnd(ctx),
  W: (ctx) => nextBigWordStart(ctx),
  B: (ctx) => prevBigWordStart(ctx),
  E: (ctx) => nextBigWordEnd(ctx),
  gg: (ctx) => 0,
  G: (ctx) => ctx.text.length,
  '(': (ctx) => prevSentence(ctx),
  ')': (ctx) => nextSentence(ctx),
  '{': (ctx) => prevParagraph(ctx),
  '}': (ctx) => nextParagraph(ctx),
  '%': (ctx) => matchBracket(ctx),
  '[': (ctx) => prevSection(ctx),
  ']': (ctx) => nextSection(ctx),
}

const OPERATOR_COMMANDS: Record<string, VimOperator> = {
  d: 'delete',
  c: 'change',
  y: 'yank',
  r: 'replace',
}

export function createVimState(): VimState {
  return {
    mode: 'INSERT',
    register: '',
    registerLinewise: false,
  }
}

export function handleVimKey(
  key: string,
  state: VimState,
  ctx: VimContext,
): { text: string; cursorOffset: number; mode: VimMode } {
  if (state.mode === 'INSERT') {
    if (key === 'escape' || key === '\x1b') {
      state.mode = 'NORMAL'
      return { text: ctx.text, cursorOffset: Math.max(0, ctx.cursorOffset - 1), mode: 'NORMAL' }
    }
    return handleInsertKey(key, state, ctx)
  }

  if (state.mode === 'VISUAL') {
    return handleVisualKey(key, state, ctx)
  }

  // NORMAL mode
  if (key === 'i') {
    state.mode = 'INSERT'
    return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'INSERT' }
  }
  if (key === 'a') {
    state.mode = 'INSERT'
    return { text: ctx.text, cursorOffset: Math.min(ctx.text.length, ctx.cursorOffset + 1), mode: 'INSERT' }
  }
  if (key === 'I') {
    state.mode = 'INSERT'
    return { text: ctx.text, cursorOffset: findFirstNonBlank(ctx), mode: 'INSERT' }
  }
  if (key === 'A') {
    state.mode = 'INSERT'
    return { text: ctx.text, cursorOffset: findLineEnd(ctx), mode: 'INSERT' }
  }
  if (key === 'o') {
    state.mode = 'INSERT'
    const lineEnd = findLineEnd(ctx)
    const newText = ctx.text.slice(0, lineEnd) + '\n' + ctx.text.slice(lineEnd)
    ctx.setText(newText)
    return { text: newText, cursorOffset: lineEnd + 1, mode: 'INSERT' }
  }
  if (key === 'O') {
    state.mode = 'INSERT'
    const lineStart = findLineStart(ctx)
    const newText = ctx.text.slice(0, lineStart) + '\n' + ctx.text.slice(lineStart)
    ctx.setText(newText)
    return { text: newText, cursorOffset: lineStart, mode: 'INSERT' }
  }

  if (key === 'v') {
    state.mode = 'VISUAL'
    state.visualStart = ctx.cursorOffset
    return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'VISUAL' }
  }

  if (key === 'x') {
    return deleteRange(ctx, ctx.cursorOffset, ctx.cursorOffset + 1)
  }
  if (key === 'X') {
    return deleteRange(ctx, Math.max(0, ctx.cursorOffset - 1), ctx.cursorOffset)
  }
  if (key === 'D') {
    const lineEnd = findLineEnd(ctx)
    return deleteRange(ctx, ctx.cursorOffset, lineEnd)
  }
  if (key === 'C') {
    const lineEnd = findLineEnd(ctx)
    const result = deleteRange(ctx, ctx.cursorOffset, lineEnd)
    state.mode = 'INSERT'
    return { ...result, mode: 'INSERT' }
  }
  if (key === 'u') {
    return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'NORMAL' }
  }
  if (key === 'p') {
    return pasteRegister(state, ctx)
  }
  if (key === 'P') {
    return pasteBeforeRegister(state, ctx)
  }
  if (key === 'r') {
    state.pendingOperator = 'replace'
    return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'NORMAL' }
  }
  if (key === 'R') {
    state.mode = 'INSERT'
    return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'INSERT' }
  }
  if (key === 'dd') {
    const lineStart = findLineStart(ctx)
    const lineEnd = findLineEnd(ctx)
    const nextChar = ctx.text[lineEnd]
    const endOffset = nextChar === '\n' ? lineEnd + 1 : lineEnd
    state.register = ctx.text.slice(lineStart, endOffset)
    state.registerLinewise = true
    const newText = ctx.text.slice(0, lineStart) + ctx.text.slice(endOffset)
    ctx.setText(newText)
    return { text: newText, cursorOffset: lineStart, mode: 'NORMAL' }
  }
  if (key === 'yy') {
    const lineStart = findLineStart(ctx)
    const lineEnd = findLineEnd(ctx)
    state.register = ctx.text.slice(lineStart, lineEnd) + '\n'
    state.registerLinewise = true
    return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'NORMAL' }
  }
  if (key === 'cc') {
    const lineStart = findLineStart(ctx)
    const lineEnd = findLineEnd(ctx)
    state.register = ctx.text.slice(lineStart, lineEnd)
    state.registerLinewise = true
    const newText = ctx.text.slice(0, lineStart) + ctx.text.slice(lineEnd)
    ctx.setText(newText)
    state.mode = 'INSERT'
    return { text: newText, cursorOffset: lineStart, mode: 'INSERT' }
  }
  if (key === 'J') {
    const lineEnd = findLineEnd(ctx)
    const nextLineStart = lineEnd + 1
    let newText = ctx.text.slice(0, lineEnd)
    if (ctx.text[lineEnd] === '\n') {
      newText += ' ' + ctx.text.slice(nextLineStart)
    } else {
      newText += ctx.text.slice(lineEnd)
    }
    ctx.setText(newText)
    return { text: newText, cursorOffset: lineEnd, mode: 'NORMAL' }
  }
  if (key === '~') {
    const char = ctx.text[ctx.cursorOffset]
    if (char) {
      const newChar = char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase()
      const newText = ctx.text.slice(0, ctx.cursorOffset) + newChar + ctx.text.slice(ctx.cursorOffset + 1)
      ctx.setText(newText)
      const newOffset = Math.min(ctx.text.length, ctx.cursorOffset + 1)
      return { text: newText, cursorOffset: newOffset, mode: 'NORMAL' }
    }
  }

  if (state.pendingOperator) {
    if (state.pendingOperator === 'replace' && key.length === 1) {
      const newText = ctx.text.slice(0, ctx.cursorOffset) + key + ctx.text.slice(ctx.cursorOffset + 1)
      ctx.setText(newText)
      state.pendingOperator = undefined
      return { text: newText, cursorOffset: ctx.cursorOffset + 1, mode: 'NORMAL' }
    }
    return executeOperator(state.pendingOperator, key, state, ctx)
  }

  if (OPERATOR_COMMANDS[key]) {
    state.pendingOperator = OPERATOR_COMMANDS[key]
    return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'NORMAL' }
  }

  const motion = MOTIONS[key]
  if (motion) {
    const newOffset = motion(ctx)
    return { text: ctx.text, cursorOffset: clampOffset(newOffset, ctx.text.length), mode: 'NORMAL' }
  }

  return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'NORMAL' }
}

function handleVisualKey(
  key: string,
  state: VimState,
  ctx: VimContext,
): { text: string; cursorOffset: number; mode: VimMode } {
  if (key === 'escape' || key === '\x1b') {
    state.mode = 'NORMAL'
    state.visualStart = undefined
    return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'NORMAL' }
  }

  if (key === 'd' || key === 'x') {
    if (state.visualStart !== undefined) {
      const [start, end] = sortPair(state.visualStart, ctx.cursorOffset)
      state.register = ctx.text.slice(start, end)
      const newText = ctx.text.slice(0, start) + ctx.text.slice(end)
      ctx.setText(newText)
      state.mode = 'NORMAL'
      state.visualStart = undefined
      return { text: newText, cursorOffset: start, mode: 'NORMAL' }
    }
  }

  if (key === 'y') {
    if (state.visualStart !== undefined) {
      const [start, end] = sortPair(state.visualStart, ctx.cursorOffset)
      state.register = ctx.text.slice(start, end)
      state.mode = 'NORMAL'
      state.visualStart = undefined
      return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'NORMAL' }
    }
  }

  if (key === 'c') {
    if (state.visualStart !== undefined) {
      const [start, end] = sortPair(state.visualStart, ctx.cursorOffset)
      state.register = ctx.text.slice(start, end)
      const newText = ctx.text.slice(0, start) + ctx.text.slice(end)
      ctx.setText(newText)
      state.mode = 'INSERT'
      state.visualStart = undefined
      return { text: newText, cursorOffset: start, mode: 'INSERT' }
    }
  }

  const motion = MOTIONS[key]
  if (motion) {
    const newOffset = motion(ctx)
    return { text: ctx.text, cursorOffset: clampOffset(newOffset, ctx.text.length), mode: 'VISUAL' }
  }

  return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'VISUAL' }
}

function handleInsertKey(
  key: string,
  _state: VimState,
  ctx: VimContext,
): { text: string; cursorOffset: number; mode: VimMode } {
  if (key === 'backspace') {
    if (ctx.cursorOffset <= 0) return { text: ctx.text, cursorOffset: 0, mode: 'INSERT' }
    const newText = ctx.text.slice(0, ctx.cursorOffset - 1) + ctx.text.slice(ctx.cursorOffset)
    ctx.setText(newText)
    return { text: newText, cursorOffset: ctx.cursorOffset - 1, mode: 'INSERT' }
  }
  if (key === 'delete') {
    if (ctx.cursorOffset >= ctx.text.length) return { text: ctx.text, cursorOffset: ctx.text.length, mode: 'INSERT' }
    const newText = ctx.text.slice(0, ctx.cursorOffset) + ctx.text.slice(ctx.cursorOffset + 1)
    ctx.setText(newText)
    return { text: newText, cursorOffset: ctx.cursorOffset, mode: 'INSERT' }
  }
  if (key === 'return' || key === '\r') {
    const newText = ctx.text.slice(0, ctx.cursorOffset) + '\n' + ctx.text.slice(ctx.cursorOffset)
    ctx.setText(newText)
    return { text: newText, cursorOffset: ctx.cursorOffset + 1, mode: 'INSERT' }
  }

  if (key.length === 1) {
    const newText = ctx.text.slice(0, ctx.cursorOffset) + key + ctx.text.slice(ctx.cursorOffset)
    ctx.setText(newText)
    return { text: newText, cursorOffset: ctx.cursorOffset + 1, mode: 'INSERT' }
  }

  return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'INSERT' }
}

function executeOperator(
  op: VimOperator,
  motionKey: string,
  state: VimState,
  ctx: VimContext,
): { text: string; cursorOffset: number; mode: VimMode } {
  state.pendingOperator = undefined

  const motion = MOTIONS[motionKey]
  if (!motion) return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'NORMAL' }

  const targetOffset = motion({ ...ctx, cursorOffset: ctx.cursorOffset })

  if (op === 'delete') {
    return deleteRange(ctx, ctx.cursorOffset, targetOffset)
  }

  if (op === 'yank') {
    const [start, end] = sortPair(ctx.cursorOffset, targetOffset)
    state.register = ctx.text.slice(start, end)
    state.registerLinewise = false
    return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'NORMAL' }
  }

  if (op === 'change') {
    const [start, end] = sortPair(ctx.cursorOffset, targetOffset)
    state.register = ctx.text.slice(start, end)
    const newText = ctx.text.slice(0, start) + ctx.text.slice(end)
    ctx.setText(newText)
    state.mode = 'INSERT'
    return { text: newText, cursorOffset: start, mode: 'INSERT' }
  }

  return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'NORMAL' }
}

function pasteRegister(
  state: VimState,
  ctx: VimContext,
): { text: string; cursorOffset: number; mode: VimMode } {
  if (!state.register) return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'NORMAL' }
  const offset = Math.min(ctx.text.length, ctx.cursorOffset + 1)
  const newText = ctx.text.slice(0, offset) + state.register + ctx.text.slice(offset)
  ctx.setText(newText)
  return { text: newText, cursorOffset: offset + state.register.length, mode: 'NORMAL' }
}

function pasteBeforeRegister(
  state: VimState,
  ctx: VimContext,
): { text: string; cursorOffset: number; mode: VimMode } {
  if (!state.register) return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'NORMAL' }
  const newText = ctx.text.slice(0, ctx.cursorOffset) + state.register + ctx.text.slice(ctx.cursorOffset)
  ctx.setText(newText)
  return { text: newText, cursorOffset: ctx.cursorOffset, mode: 'NORMAL' }
}

function deleteRange(
  ctx: VimContext,
  from: number,
  to: number,
): { text: string; cursorOffset: number; mode: VimMode } {
  const [start, end] = sortPair(from, to)
  if (start === end) return { text: ctx.text, cursorOffset: ctx.cursorOffset, mode: 'NORMAL' }
  const newText = ctx.text.slice(0, start) + ctx.text.slice(end)
  ctx.setText(newText)
  return { text: newText, cursorOffset: start, mode: 'NORMAL' }
}

function moveVertical(ctx: VimContext, delta: number): number {
  const lines = ctx.text.slice(0, ctx.cursorOffset).split('\n')
  const allLines = ctx.text.split('\n')
  const currentLine = lines.length - 1
  const targetLine = clampInt(currentLine + delta, 0, allLines.length - 1)
  const columnInLine = ctx.cursorOffset - (lines.length > 1 ? ctx.text.slice(0, ctx.cursorOffset).lastIndexOf('\n') + 1 : 0)
  const prefixLen = allLines.slice(0, targetLine).reduce((sum, l) => sum + l.length + 1, 0)
  return Math.min(prefixLen + columnInLine, prefixLen + (allLines[targetLine]?.length || 0))
}

function findLineStart(ctx: VimContext): number {
  const idx = ctx.text.lastIndexOf('\n', ctx.cursorOffset - 1)
  return idx === -1 ? 0 : idx + 1
}

function findLineEnd(ctx: VimContext): number {
  const idx = ctx.text.indexOf('\n', ctx.cursorOffset)
  return idx === -1 ? ctx.text.length : idx
}

function findFirstNonBlank(ctx: VimContext): number {
  const start = findLineStart(ctx)
  const end = findLineEnd(ctx)
  for (let i = start; i < end; i++) {
    if (ctx.text[i] !== ' ' && ctx.text[i] !== '\t') return i
  }
  return start
}

function nextWordStart(ctx: VimContext): number {
  const text = ctx.text
  let i = ctx.cursorOffset
  while (i < text.length && isWordChar(text[i])) i++
  while (i < text.length && !isWordChar(text[i]) && text[i] !== '\n') i++
  return i
}

function prevWordStart(ctx: VimContext): number {
  const text = ctx.text
  let i = ctx.cursorOffset - 1
  while (i > 0 && !isWordChar(text[i])) i--
  while (i > 0 && isWordChar(text[i - 1])) i--
  return i
}

function nextWordEnd(ctx: VimContext): number {
  const text = ctx.text
  let i = ctx.cursorOffset
  if (isWordChar(text[i])) {
    while (i < text.length && isWordChar(text[i])) i++
    return i - 1
  }
  while (i < text.length && !isWordChar(text[i])) i++
  while (i < text.length && isWordChar(text[i])) i++
  return i - 1
}

function nextBigWordStart(ctx: VimContext): number {
  const text = ctx.text
  let i = ctx.cursorOffset
  while (i < text.length && isBlankChar(text[i])) i++
  while (i < text.length && !isBlankChar(text[i])) i++
  while (i < text.length && isBlankChar(text[i])) i++
  return i
}

function prevBigWordStart(ctx: VimContext): number {
  const text = ctx.text
  let i = ctx.cursorOffset - 1
  while (i >= 0 && isBlankChar(text[i])) i--
  while (i >= 0 && !isBlankChar(text[i])) i--
  while (i >= 0 && isBlankChar(text[i])) i--
  return Math.max(0, i + 1)
}

function nextBigWordEnd(ctx: VimContext): number {
  const text = ctx.text
  let i = ctx.cursorOffset
  while (i < text.length && isBlankChar(text[i])) i++
  while (i < text.length && !isBlankChar(text[i])) i++
  return Math.max(0, i - 1)
}

function nextSentence(ctx: VimContext): number {
  const text = ctx.text
  let i = ctx.cursorOffset
  while (i < text.length) {
    if ('.!?'.includes(text[i]) && (i === text.length - 1 || text[i + 1] === ' ' || text[i + 1] === '\n')) {
      i++
      while (i < text.length && (text[i] === ' ' || text[i] === '\n')) i++
      break
    }
    i++
  }
  return i
}

function prevSentence(ctx: VimContext): number {
  const text = ctx.text
  let i = ctx.cursorOffset - 1
  while (i >= 0) {
    if ('.!?'.includes(text[i]) && (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\n')) {
      i--
      while (i >= 0 && (text[i] === ' ' || text[i] === '\n')) i--
      break
    }
    i--
  }
  return Math.max(0, i + 1)
}

function nextParagraph(ctx: VimContext): number {
  const text = ctx.text
  let i = ctx.cursorOffset
  let blankLines = 0
  while (i < text.length) {
    if (text[i] === '\n') {
      blankLines++
      if (blankLines >= 2) {
        i++
        while (i < text.length && text[i] === '\n') i++
        break
      }
    } else {
      blankLines = 0
    }
    i++
  }
  return i
}

function prevParagraph(ctx: VimContext): number {
  const text = ctx.text
  let i = ctx.cursorOffset - 1
  let blankLines = 0
  while (i >= 0) {
    if (text[i] === '\n') {
      blankLines++
      if (blankLines >= 2) {
        i--
        while (i >= 0 && text[i] === '\n') i--
        break
      }
    } else {
      blankLines = 0
    }
    i--
  }
  return Math.max(0, i + 1)
}

function matchBracket(ctx: VimContext): number {
  const text = ctx.text
  const char = text[ctx.cursorOffset]
  const pairs: Record<string, string> = {
    '(': ')',
    ')': '(',
    '[': ']',
    ']': '[',
    '{': '}',
    '}': '{',
    '<': '>',
    '>': '<',
  }

  if (!pairs[char]) return ctx.cursorOffset

  const target = pairs[char]
  const isOpening = '( [{<'.includes(char)
  let count = isOpening ? 1 : -1
  let i = isOpening ? ctx.cursorOffset + 1 : ctx.cursorOffset - 1
  const step = isOpening ? 1 : -1

  while (i >= 0 && i < text.length) {
    if (text[i] === char) count += step
    if (text[i] === target) count -= step
    if (count === 0) return i
    i += step
  }

  return ctx.cursorOffset
}

function nextSection(ctx: VimContext): number {
  const text = ctx.text
  let i = ctx.cursorOffset
  while (i < text.length) {
    if (text[i] === '\n' && text[i + 1] === '\n') {
      i += 2
      break
    }
    i++
  }
  return i
}

function prevSection(ctx: VimContext): number {
  const text = ctx.text
  let i = ctx.cursorOffset - 1
  while (i >= 0) {
    if (text[i] === '\n' && text[i - 1] === '\n') {
      i -= 2
      break
    }
    i--
  }
  return Math.max(0, i + 2)
}

function isWordChar(ch: string): boolean {
  return /[a-zA-Z0-9_]/.test(ch)
}

function isBlankChar(ch: string): boolean {
  return /\s/.test(ch)
}

function sortPair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a]
}

function clampOffset(offset: number, max: number): number {
  return Math.max(0, Math.min(offset, max))
}

function clampInt(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(val, max))
}