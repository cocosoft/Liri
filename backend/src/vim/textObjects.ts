/**
 * Vim文本对象模块
 * 支持各种文本对象操作
 */

export type TextObjectType =
  | 'word'
  | 'WORD'
  | 'sentence'
  | 'paragraph'
  | 'bracket'
  | 'quote'
  | 'tag'
  | 'block';

export interface TextObject {
  type: TextObjectType;
  start: number;
  end: number;
  content: string;
}

export class TextObjectManager {
  private text: string = '';
  private cursor: number = 0;

  /**
   * 设置当前文本
   */
  setText(text: string): void {
    this.text = text;
  }

  /**
   * 设置光标位置
   */
  setCursor(position: number): void {
    this.cursor = Math.max(0, Math.min(position, this.text.length));
  }

  /**
   * 获取光标位置
   */
  getCursor(): number {
    return this.cursor;
  }

  /**
   * 获取单词对象 (w)
   */
  getWord(): TextObject | null {
    const regex = /\b(\w+)\b/g;
    let match;

    while ((match = regex.exec(this.text)) !== null) {
      if (match.index <= this.cursor && regex.lastIndex >= this.cursor) {
        return {
          type: 'word',
          start: match.index,
          end: regex.lastIndex,
          content: match[1],
        };
      }
    }

    return null;
  }

  /**
   * 获取WORD对象 (W)
   */
  getWORD(): TextObject | null {
    const regex = /[^\s]+/g;
    let match;

    while ((match = regex.exec(this.text)) !== null) {
      if (match.index <= this.cursor && regex.lastIndex >= this.cursor) {
        return {
          type: 'WORD',
          start: match.index,
          end: regex.lastIndex,
          content: match[0],
        };
      }
    }

    return null;
  }

  /**
   * 获取句子对象
   */
  getSentence(): TextObject | null {
    const regex = /([^.!?]+[.!?]+)/g;
    let match;

    while ((match = regex.exec(this.text)) !== null) {
      if (match.index <= this.cursor && regex.lastIndex >= this.cursor) {
        return {
          type: 'sentence',
          start: match.index,
          end: regex.lastIndex,
          content: match[1],
        };
      }
    }

    return null;
  }

  /**
   * 获取段落对象
   */
  getParagraph(): TextObject | null {
    const paragraphs = this.text.split(/\n\n+/);
    let position = 0;

    for (const paragraph of paragraphs) {
      const end = position + paragraph.length;
      if (position <= this.cursor && end >= this.cursor) {
        return {
          type: 'paragraph',
          start: position,
          end,
          content: paragraph,
        };
      }
      position = end + 2; // +2 for the newlines
    }

    return null;
  }

  /**
   * 获取括号内的内容
   */
  getBracketContent(): TextObject | null {
    const brackets = ['()', '[]', '{}', '<>'];

    for (const pair of brackets) {
      const [open, close] = pair;
      const result = this.findBracketPair(open, close);
      if (result) {
        return {
          type: 'bracket',
          start: result.start,
          end: result.end,
          content: this.text.substring(result.start, result.end),
        };
      }
    }

    return null;
  }

  /**
   * 获取引号内的内容
   */
  getQuoteContent(): TextObject | null {
    const quotes = ['"', "'", '`'];

    for (const quote of quotes) {
      const result = this.findQuotePair(quote);
      if (result) {
        return {
          type: 'quote',
          start: result.start,
          end: result.end,
          content: this.text.substring(result.start, result.end),
        };
      }
    }

    return null;
  }

  /**
   * 查找括号配对
   */
  private findBracketPair(
    open: string,
    close: string
  ): { start: number; end: number } | null {
    let count = 0;
    let start = -1;

    for (let i = 0; i < this.text.length; i++) {
      const char = this.text[i];

      if (char === open) {
        count++;
        if (start === -1) start = i;
      } else if (char === close) {
        count--;
        if (count === 0 && start !== -1) {
          return { start, end: i + 1 };
        }
      }
    }

    return null;
  }

  /**
   * 查找引号配对
   */
  private findQuotePair(quote: string): { start: number; end: number } | null {
    let escaped = false;
    let start = -1;

    for (let i = 0; i < this.text.length; i++) {
      const char = this.text[i];

      if (char === '\\' && !escaped) {
        escaped = true;
        continue;
      }

      if (char === quote && !escaped) {
        if (start === -1) {
          start = i;
        } else {
          return { start, end: i + 1 };
        }
      }

      escaped = false;
    }

    return null;
  }

  /**
   * 根据类型获取文本对象
   */
  getObject(type: TextObjectType): TextObject | null {
    switch (type) {
      case 'word':
        return this.getWord();
      case 'WORD':
        return this.getWORD();
      case 'sentence':
        return this.getSentence();
      case 'paragraph':
        return this.getParagraph();
      case 'bracket':
        return this.getBracketContent();
      case 'quote':
        return this.getQuoteContent();
      default:
        return null;
    }
  }
}

/**
 * 创建文本对象管理器实例
 */
export function createTextObjectManager(): TextObjectManager {
  return new TextObjectManager();
}

/**
 * 全局文本对象管理器实例
 */
export const textObjectManager = createTextObjectManager();
