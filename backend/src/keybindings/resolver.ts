/**
 * 按键绑定解析器
 */
import type {
  ParsedBinding,
  ParsedKeystroke,
  KeybindingContextName,
  ChordResolveResult,
} from './types.js';
import { chordsEqual, keystrokeMatches } from './parser.js';

/**
 * 检查和弦序列是否匹配
 * @param input 输入的序列
 * @param binding 绑定的序列
 * @returns 是否匹配
 */
export function chordMatches(
  input: ParsedKeystroke[],
  binding: ParsedKeystroke[]
): boolean {
  // 输入序列长度必须等于绑定序列长度
  if (input.length !== binding.length) {
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
 * 解析按键输入并返回动作
 * @param input 输入字符串
 * @param key 按键
 * @param activeContexts 活跃上下文
 * @param bindings 所有绑定
 * @param pendingChord 待处理的和弦
 * @returns 解析结果
 */
export function resolveKeyWithChordState(
  input: string,
  key: string,
  activeContexts: KeybindingContextName[],
  bindings: ParsedBinding[],
  pendingChord: ParsedKeystroke[] | null
): ChordResolveResult {
  // 解析当前按键
  const currentKeystroke = parseInputToKeystroke(input, key);

  // 构建当前和弦序列
  const currentChord = pendingChord
    ? [...pendingChord, currentKeystroke]
    : [currentKeystroke];

  // 首先检查是否有部分匹配的和弦（优先级高于完全匹配）
  const partialMatches = findPartialChordMatches(
    currentChord,
    activeContexts,
    bindings
  );
  if (partialMatches.length > 0) {
    // 有部分匹配，继续等待和弦完成
    return {
      action: null,
      isCompleteChord: false,
      pendingChord: currentChord,
    };
  }

  // 查找完全匹配的绑定
  const match = findMatchingBinding(currentChord, activeContexts, bindings);

  if (match) {
    // 找到完全匹配的绑定
    return {
      action: match.action,
      isCompleteChord: true,
      pendingChord: null,
    };
  }

  // 没有匹配，重置和弦状态
  return {
    action: null,
    isCompleteChord: false,
    pendingChord: null,
  };
}

/**
 * 将输入解析为按键对象
 */
function parseInputToKeystroke(input: string, key: string): ParsedKeystroke {
  // 这里简化处理，实际应该根据ink.js的Key类型进行解析
  const keystroke: ParsedKeystroke = { key: key.toLowerCase() };

  // 解析修饰符
  if (input.includes('ctrl')) keystroke.ctrl = true;
  if (input.includes('alt')) keystroke.alt = true;
  if (input.includes('shift')) keystroke.shift = true;
  if (input.includes('meta')) keystroke.meta = true;

  return keystroke;
}

/**
 * 查找完全匹配的绑定
 */
function findMatchingBinding(
  chord: ParsedKeystroke[],
  activeContexts: KeybindingContextName[],
  bindings: ParsedBinding[]
): ParsedBinding | null {
  // 按上下文优先级排序（活跃上下文优先）
  const prioritizedBindings = prioritizeBindingsByContext(
    bindings,
    activeContexts
  );

  for (const binding of prioritizedBindings) {
    if (chordMatches(chord, binding.chord.chords)) {
      return binding;
    }
  }

  return null;
}

/**
 * 查找部分匹配的和弦
 */
function findPartialChordMatches(
  chord: ParsedKeystroke[],
  activeContexts: KeybindingContextName[],
  bindings: ParsedBinding[]
): ParsedBinding[] {
  const partialMatches: ParsedBinding[] = [];

  for (const binding of bindings) {
    // 只检查长度大于1的和弦绑定
    if (binding.chord.chords.length <= 1) {
      continue;
    }

    // 检查绑定是否在当前活跃上下文中
    if (!activeContexts.includes(binding.context)) {
      continue;
    }

    // 检查当前和弦是否是绑定和弦的前缀
    if (isChordPrefix(chord, binding.chord.chords)) {
      partialMatches.push(binding);
    }
  }

  return partialMatches;
}

/**
 * 检查和弦是否是另一个和弦的前缀
 */
function isChordPrefix(
  prefix: ParsedKeystroke[],
  fullChord: ParsedKeystroke[]
): boolean {
  if (prefix.length >= fullChord.length) {
    return false;
  }

  for (let i = 0; i < prefix.length; i++) {
    if (!keystrokeMatches(prefix[i], fullChord[i])) {
      return false;
    }
  }

  return true;
}

/**
 * 根据活跃上下文对绑定进行优先级排序
 */
function prioritizeBindingsByContext(
  bindings: ParsedBinding[],
  activeContexts: KeybindingContextName[]
): ParsedBinding[] {
  return [...bindings].sort((a, b) => {
    const aContextIndex = activeContexts.indexOf(a.context);
    const bContextIndex = activeContexts.indexOf(b.context);

    // 活跃上下文中的绑定优先
    if (aContextIndex >= 0 && bContextIndex >= 0) {
      return aContextIndex - bContextIndex; // 索引小的优先级高
    } else if (aContextIndex >= 0) {
      return -1; // a在活跃上下文中，b不在
    } else if (bContextIndex >= 0) {
      return 1; // b在活跃上下文中，a不在
    } else {
      return 0; // 都不在活跃上下文中，保持原顺序
    }
  });
}

/**
 * 获取绑定的显示文本
 * @param action 动作名称
 * @param context 上下文
 * @param bindings 所有绑定
 * @returns 显示文本
 */
export function getBindingDisplayText(
  action: string,
  context: KeybindingContextName,
  bindings: ParsedBinding[]
): string | undefined {
  // 查找指定上下文和动作的绑定
  const binding = bindings.find(
    (b) => b.action === action && b.context === context
  );

  return binding?.chord.displayText;
}

/**
 * 获取所有绑定的显示文本
 * @param bindings 所有绑定
 * @returns 显示文本映射
 */
export function getAllBindingDisplayTexts(
  bindings: ParsedBinding[]
): Record<string, string> {
  const displayTexts: Record<string, string> = {};

  for (const binding of bindings) {
    const key = `${binding.context}:${binding.action}`;
    displayTexts[key] = binding.chord.displayText;
  }

  return displayTexts;
}

/**
 * 查找特定动作的绑定
 * @param action 动作名称
 * @param bindings 所有绑定
 * @returns 匹配的绑定
 */
export function findBindingForAction(
  action: string,
  bindings: ParsedBinding[]
): ParsedBinding | undefined {
  return bindings.find((b) => b.action === action);
}

/**
 * 查找特定上下文的绑定
 * @param context 上下文名称
 * @param bindings 所有绑定
 * @returns 匹配的绑定
 */
export function findBindingsForContext(
  context: KeybindingContextName,
  bindings: ParsedBinding[]
): ParsedBinding[] {
  return bindings.filter((b) => b.context === context);
}

/**
 * 检查绑定是否冲突
 * @param newBinding 新绑定
 * @param existingBindings 现有绑定
 * @returns 冲突的绑定
 */
export function checkBindingConflict(
  newBinding: ParsedBinding,
  existingBindings: ParsedBinding[]
): ParsedBinding | null {
  for (const existing of existingBindings) {
    if (
      chordsEqual(newBinding.chord.chords, existing.chord.chords) &&
      newBinding.context === existing.context
    ) {
      return existing;
    }
  }

  return null;
}

/**
 * 过滤重复的绑定
 * @param bindings 绑定列表
 * @returns 去重后的绑定列表
 */
export function deduplicateBindings(
  bindings: ParsedBinding[]
): ParsedBinding[] {
  const seen = new Set<string>();
  const result: ParsedBinding[] = [];

  for (const binding of bindings) {
    const key = `${binding.context}:${binding.action}:${binding.chord.displayText}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(binding);
    }
  }

  return result;
}
