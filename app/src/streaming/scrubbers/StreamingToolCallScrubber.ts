/**
 * 流式工具调用标签擦洗器
 *
 * 擦洗系统已知能解析的 XML 工具调用格式:
 *   <tool_call>{"name": "func", "arguments": {...}}</tool_call>
 *   <tool_calls>...</tool_calls>
 *   <invoke name="func"><parameter name="x">v</parameter></invoke>
 *
 * 擦洗时注入进度提示（如 "[调用工具: glob...]"），让用户知道 AI 正在后台执行。
 *
 * 这些标签对应 HermesXmlParser / Glm45Parser / InvokeXmlParser 的解析格式。
 * 系统已将它们转为结构化 tool_calls 执行，无需在流式输出中暴露原始 XML。
 *
 * 对标 StreamingThinkScrubber 的设计模式。
 *
 * P1 修复（2026-08-04）：防止正文中的 XML 标签被误判为工具调用。
 *   - invoke 开标签必须含 name= 属性才进入擦除模式
 *   - tool_call/tool_calls 开标签后紧跟内容验证：必须以 { (JSON) 或 <arg_key (GLM) 开头
 *   - 跨 chunk 边界时缓冲到下一块再做判定
 *
 * P2 埋点（2026-08-04）：关键分支日志，环境变量 DEBUG_TOOL_SCRUBBER=1 启用。
 *   覆盖：开标签验证（通过/拒绝/pending）、模式进入/退出、pending 判定。
 */
import type { StreamChunk } from '../types';

// ─── 调试日志 ────────────────────────────────────────
const DEBUG = process.env.DEBUG_TOOL_SCRUBBER === '1';

function dbg(msg: string, detail?: Record<string, unknown>) {
  if (!DEBUG) return;
  const ts = new Date().toISOString().slice(11, 23);
  const extra = detail ? ` ${JSON.stringify(detail)}` : '';
  // eslint-disable-next-line no-console
  console.debug(`[scrub:${ts}] ${msg}${extra}`);
}

/** 需要擦洗的 XML 标签名（仅限系统 parser 已知的格式） */
const TOOL_CALL_TAG_NAMES = ['tool_call', 'tool_calls', 'invoke'] as const;

/** 从开标签中提取 name 属性值，如 <invoke name="glob"> → "glob" */
function extractToolName(tag: string): string | null {
  const match = tag.match(/name\s*=\s*["']([^"']+)["']/i);
  return match ? match[1] : null;
}

/** 状态提示模板 */
const INDICATOR = (name: string | null) =>
  name ? `\n[调用工具: ${name}...]\n` : '\n[调用工具中...]\n';

function buildToolCallPatterns(): {
  openPattern: RegExp;
  closePattern: RegExp;
} {
  // tool_call/tool_calls 无属性；invoke 本应含 name= 但单独验证
  const tagNames = TOOL_CALL_TAG_NAMES.join('|');
  return {
    openPattern: new RegExp(`<(${tagNames})\\b[^>]*>`, 'i'),
    closePattern: new RegExp(`</(${tagNames})\\s*>`, 'i'),
  };
}

/**
 * invoke 标签必须含 name= 属性才是真实工具调用。
 * 正文中裸 <invoke> 不应触发擦除。
 */
function isValidInvoke(matchedTag: string): boolean {
  return extractToolName(matchedTag) !== null;
}

/**
 * 验证 tool_call/tool_calls 标签后的内容是否像真实工具调用。
 * 返回 true=真实工具调用，false=普通文本，'pending'=内容不足需等待下一 chunk。
 *
 * tool_call 两种格式 / tool_calls 包装：
 *   Hermes: <tool_call>{"name":"func",...}     — 紧随 {
 *   GLM:    <tool_call>func_name\n<arg_key>... — 紧随函数名 + <arg_key>
 *   包装:    <tool_calls><tool_call>...        — 紧随内层 <tool_call
 */
function isValidToolCallContent(
  tagType: string,
  afterTag: string
): boolean | 'pending' {
  const trimmed = afterTag.trimStart();
  if (trimmed.length === 0) return 'pending';

  if (tagType === 'invoke') {
    // invoke 含 name= 且紧随 <parameter 才是真实工具调用
    return trimmed.startsWith('<parameter');
  }

  // Hermes JSON 格式: 紧随 {
  if (trimmed.startsWith('{')) return true;

  // GLM 格式: 紧随 <arg_key>
  if (trimmed.startsWith('<arg_key')) return true;

  // tool_calls 包装标签: 紧随 <tool_call
  if (trimmed.startsWith('<tool_call')) return true;

  // 可能是函数名开头（GLM 格式 func_name\n<arg_key>）
  if (/^[a-zA-Z_]/.test(trimmed)) {
    const window = trimmed.slice(0, 100);
    if (window.includes('<arg_key')) return true;
  }

  return false;
}

function isIncompleteOpenTag(remaining: string): boolean {
  for (const tagName of TOOL_CALL_TAG_NAMES) {
    if (remaining.startsWith(`<${tagName}`) && !remaining.includes('>')) {
      return true;
    }
  }
  return false;
}

function isIncompleteCloseTag(remaining: string): boolean {
  for (const tagName of TOOL_CALL_TAG_NAMES) {
    if (remaining.startsWith(`</${tagName}`) && !remaining.includes('>')) {
      return true;
    }
  }
  return false;
}

export class StreamingToolCallScrubber {
  private openPattern: RegExp;
  private closePattern: RegExp;
  private inToolCall: boolean = false;
  private openBuffer: string = '';
  private closeBuffer: string = '';
  private depth: number = 0;
  /** 当前工具调用块是否已注入过进度提示（防止多 chunk 重复注入） */
  private indicatorEmitted: boolean = false;

  constructor() {
    const patterns = buildToolCallPatterns();
    this.openPattern = patterns.openPattern;
    this.closePattern = patterns.closePattern;
  }

  scrub(chunk: StreamChunk): StreamChunk {
    if (!chunk.content || chunk.content.length === 0) {
      return chunk;
    }

    let content = this.openBuffer + this.closeBuffer + chunk.content;
    if (DEBUG && this.openBuffer) {
      dbg('RESOLVE pending', {
        bufferedLen: this.openBuffer.length,
        chunkLen: chunk.content?.length ?? 0,
      });
    }
    this.openBuffer = '';
    this.closeBuffer = '';

    let result = '';

    for (let i = 0; i < content.length; i++) {
      const remaining = content.slice(i);

      if (!this.inToolCall) {
        const openMatch = remaining.match(this.openPattern);
        if (openMatch && openMatch.index === 0) {
          const matchedTag = openMatch[0];
          const tagType = openMatch[1]; // tool_call | tool_calls | invoke

          // 自闭合标签直接跳过，不进入擦除模式
          if (matchedTag.endsWith('/>')) {
            i += matchedTag.length - 1;
            continue;
          }

          // P1 修复：验证标签后内容是否像真实工具调用
          const afterTag = remaining.slice(matchedTag.length);
          const valid = isValidToolCallContent(tagType, afterTag);
          const peek = afterTag.trimStart().slice(0, 40);

          if (valid === 'pending') {
            dbg('PENDING', {
              tagType,
              peek: '(chunk end)',
              chunkLen: chunk.content?.length ?? 0,
            });
            this.openBuffer = remaining;
            return { ...chunk, content: result, isComplete: chunk.isComplete };
          }
          // invoke 必须含 name= 属性
          if (tagType === 'invoke' && !isValidInvoke(matchedTag)) {
            dbg('REJECT invoke-no-name', { tag: matchedTag });
            result += matchedTag;
            i += matchedTag.length - 1;
            continue;
          }
          if (!valid) {
            dbg('REJECT bad-content', { tagType, peek });
            result += matchedTag;
            i += matchedTag.length - 1;
            continue;
          }

          dbg('ENTER scrub', { tagType, depth: 1, peek });
          this.inToolCall = true;
          this.depth = 1;
          // 注入进度提示（每个工具调用块仅一次）
          if (!this.indicatorEmitted) {
            const toolName = extractToolName(matchedTag);
            result += INDICATOR(toolName);
            this.indicatorEmitted = true;
          }
          i += matchedTag.length - 1;
          continue;
        }

        if (remaining[0] === '<') {
          if (isIncompleteOpenTag(remaining)) {
            this.openBuffer = remaining;
            return { ...chunk, content: result, isComplete: chunk.isComplete };
          }
        }

        result += content[i];
      } else {
        const closeMatch = remaining.match(this.closePattern);
        if (closeMatch && closeMatch.index === 0) {
          this.depth--;
          if (this.depth <= 0) {
            dbg('EXIT scrub', { depth: 0 });
            this.inToolCall = false;
            this.depth = 0;
            this.indicatorEmitted = false;
          } else {
            dbg('DEPTH dec', { depth: this.depth });
          }
          i += closeMatch[0].length - 1;
          continue;
        }

        const innerOpen = remaining.match(this.openPattern);
        if (innerOpen && innerOpen.index === 0) {
          this.depth++;
          dbg('DEPTH inc (nested)', { depth: this.depth, tag: innerOpen[0] });
          i += innerOpen[0].length - 1;
          continue;
        }

        if (remaining[0] === '<') {
          if (isIncompleteCloseTag(remaining)) {
            this.closeBuffer = remaining;
            return { ...chunk, content: result, isComplete: chunk.isComplete };
          }
        }
      }
    }

    return { ...chunk, content: result, isComplete: chunk.isComplete };
  }

  flush(): string {
    let result = '';
    if (!this.inToolCall) {
      result = this.openBuffer;
    }
    this.inToolCall = false;
    this.openBuffer = '';
    this.closeBuffer = '';
    this.depth = 0;
    this.indicatorEmitted = false;
    return result;
  }

  reset(): void {
    this.inToolCall = false;
    this.openBuffer = '';
    this.closeBuffer = '';
    this.depth = 0;
    this.indicatorEmitted = false;
  }

  feed(chunk: StreamChunk): StreamChunk {
    return this.scrub(chunk);
  }
}
