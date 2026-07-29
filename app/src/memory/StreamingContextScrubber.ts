/**
 * StreamingContextScrubber — 流式输出上下文标签剥离
 *
 * P3-7: 对标 hermes-agent StreamingContextScrubber。
 * 跨流式增量剥离 <memory-context>/<project-instructions>/<steering> 等内部标记，
 * 防止用户可见输出中包含系统级 XML 标签。
 */

export type ScrubState = 'normal' | 'inside_tag' | 'closing_tag';

export class StreamingContextScrubber {
  private buffer = '';
  private state: ScrubState = 'normal';
  private tagDepth = 0;
  private stripCount = 0;

  /** 需要剥离的标签列表 */
  private static readonly STRIP_TAGS = [
    'memory-context',
    'project-instructions',
    'steering',
    'system-context',
    'system-info',
    'available-commands',
    'available-skills',
    'mcp-instructions',
    'user-context',
    'environment',
    'agent-skills',
  ];

  /**
   * 喂入流式文本 chunk，返回清理后的文本
   */
  feed(chunk: string): string {
    let output = '';
    let i = 0;

    while (i < chunk.length) {
      const remaining = chunk.slice(i);

      if (this.state === 'normal') {
        // Look for opening tag
        const openMatch = remaining.match(
          new RegExp(
            `<(${StreamingContextScrubber.STRIP_TAGS.join('|')})[\\s>]`,
            'i'
          )
        );
        if (openMatch && remaining.startsWith(`<${openMatch[1]}`)) {
          // Emit anything before the tag
          if (chunk.slice(0, i).length > 0) {
            output += chunk.slice(0, i);
          }
          this.state = 'inside_tag';
          this.tagDepth = 1;
          const tagName = openMatch[1].toLowerCase();
          i += openMatch[0].length;

          // Handle self-closing tag
          if (remaining.startsWith(`<${openMatch[1]}/>`)) {
            this.state = 'normal';
            this.tagDepth = 0;
            i = i - openMatch[0].length + openMatch[0].length + 3;
            this.stripCount++;
            continue;
          }
          if (remaining.startsWith(`<${openMatch[1]}>`)) {
            i = i - openMatch[0].length + openMatch[0].length + 1;
          }
        } else {
          output += chunk[i];
          i++;
        }
      } else {
        // Inside tag — look for closing tag
        const closeRegex = new RegExp(
          `</(${StreamingContextScrubber.STRIP_TAGS.join('|')})\\s*>`,
          'i'
        );
        const closeMatch = remaining.match(closeRegex);
        if (closeMatch) {
          this.tagDepth--;
          if (this.tagDepth <= 0) {
            this.state = 'normal';
            this.stripCount++;
          }
          i += closeMatch[0].length;
        } else {
          // Check for nested opening tags of the same type
          const nestedMatch = remaining.match(
            new RegExp(
              `<(${StreamingContextScrubber.STRIP_TAGS.join('|')})[\\s>]`,
              'i'
            )
          );
          if (nestedMatch && remaining.startsWith(`<${nestedMatch[1]}`)) {
            this.tagDepth++;
          }
          i++;
        }
      }
    }

    return output;
  }

  /** 刷新缓冲区 */
  flush(): string {
    const remaining = this.buffer;
    this.buffer = '';
    this.state = 'normal';
    this.tagDepth = 0;
    return remaining;
  }

  /** 重置状态 */
  reset(): void {
    this.buffer = '';
    this.state = 'normal';
    this.tagDepth = 0;
    this.stripCount = 0;
  }

  /** 获取剥离统计 */
  getStripCount(): number {
    return this.stripCount;
  }
}

/**
 * P3-8: memoryFreshnessNote — 记忆新鲜度时效警告
 *
 * 对标 cc_code memoryFreshnessNote（>1 天记忆附加验证警告）。
 */
export function memoryFreshnessNote(
  createdAt: number | Date,
  content: string
): string {
  const created =
    typeof createdAt === 'number' ? createdAt : createdAt.getTime();
  const ageMs = Date.now() - created;
  const ageDays = Math.floor(ageMs / 86_400_000);

  if (ageDays <= 0) return content;

  const ageText = ageDays === 1 ? 'yesterday' : `${ageDays} days ago`;
  return (
    `${content}\n` +
    `<system-reminder>This memory was recorded ${ageText}. ` +
    `It may be outdated — verify before relying on it.</system-reminder>`
  );
}
