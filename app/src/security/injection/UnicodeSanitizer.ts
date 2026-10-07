/**
 * Unicode 清理器
 * 对标 Hermes prompt_builder.py 的不可见 Unicode 清理
 * 移除可能用于编码注入的不可见 Unicode 字符
 */

/**
 * 不可见 Unicode 字符范围
 */
export interface InvisibleUnicodeRange {
  name: string;
  start: number;
  end: number;
  description: string;
}

/**
 * 不可见 Unicode 字符范围列表 —— **全仓单一事实源**（CS01，2026-10-07 归并）
 *
 * 归并前存在三处独立实现：本表 / `PromptInjectionDetector.ts` 的同名表（逐字相同）/
 * `chronos/CronInjectionScanner.ts` 的 `INVISIBLE_CHARS` 正则。
 * **并集口径**（两侧差异已逐项 diff，取**更严**一边，无漏检回退）：
 * - 本表原有 17 项（含 `00AD` 软连字符 / `3164` 韩文填充 / `2800` 盲文空白 / `FFFC` 对象替换符）；
 * - 原 Cron 正则额外覆盖 `2060–2069` ⇒ 现把 `Invisible Separator` 的范围由 `2061–2064`
 *   **扩展为 `2061–2069`**（补 `2065` 未分配 + `2066–2069` 方向隔离符 LRI/RLI/FSI/PDI —— bidi 欺骗面）。
 *
 * ⚠️ **行为变化（如实）**：`CronInjectionScanner` 新增检出 `00AD/3164/2800/FFFC`（更严）；
 * `UnicodeSanitizer` / `PromptInjectionDetector` 新增处理 `2065–2069`（更严）。
 * 详见 `.trae/specs/guardrails-dual-side.md`（D9=a）。
 */
export const INVISIBLE_UNICODE_RANGES: InvisibleUnicodeRange[] = [
  {
    name: 'Zero Width Space',
    start: 0x200b,
    end: 0x200b,
    description: '零宽空格',
  },
  {
    name: 'Zero Width Non-Joiner',
    start: 0x200c,
    end: 0x200c,
    description: '零宽非连接符',
  },
  {
    name: 'Zero Width Joiner',
    start: 0x200d,
    end: 0x200d,
    description: '零宽连接符',
  },
  {
    name: 'Zero Width No-Break Space',
    start: 0xfeff,
    end: 0xfeff,
    description: '零宽不换行空格',
  },
  {
    name: 'Left-to-Right Mark',
    start: 0x200e,
    end: 0x200e,
    description: '左到右标记',
  },
  {
    name: 'Right-to-Left Mark',
    start: 0x200f,
    end: 0x200f,
    description: '右到左标记',
  },
  {
    name: 'Left-to-Right Embedding',
    start: 0x202a,
    end: 0x202a,
    description: '左到右嵌入',
  },
  {
    name: 'Right-to-Left Embedding',
    start: 0x202b,
    end: 0x202b,
    description: '右到左嵌入',
  },
  {
    name: 'Pop Directional Formatting',
    start: 0x202c,
    end: 0x202c,
    description: '方向格式化弹出',
  },
  {
    name: 'Left-to-Right Override',
    start: 0x202d,
    end: 0x202d,
    description: '左到右覆盖',
  },
  {
    name: 'Right-to-Left Override',
    start: 0x202e,
    end: 0x202e,
    description: '右到左覆盖',
  },
  { name: 'Word Joiner', start: 0x2060, end: 0x2060, description: '词连接符' },
  {
    name: 'Invisible Separator',
    start: 0x2061,
    // 2061–2064 不可见运算符 + 2065 未分配 + 2066–2069 方向隔离符（LRI/RLI/FSI/PDI）
    end: 0x2069,
    description: '不可见分隔符',
  },
  { name: 'Soft Hyphen', start: 0x00ad, end: 0x00ad, description: '软连字符' },
  {
    name: 'Hangul Filler',
    start: 0x3164,
    end: 0x3164,
    description: '韩文填充',
  },
  {
    name: 'Braille Pattern Blank',
    start: 0x2800,
    end: 0x2800,
    description: '盲文空白',
  },
  {
    name: 'Object Replacement Char',
    start: 0xfffc,
    end: 0xfffc,
    description: '对象替换字符',
  },
];

/**
 * 码点是否属于不可见 Unicode —— **唯一判定入口**（禁止各处自建正则/副本，CS01）
 */
export function isInvisibleCodePoint(codePoint: number): boolean {
  for (const range of INVISIBLE_UNICODE_RANGES) {
    if (codePoint >= range.start && codePoint <= range.end) return true;
  }
  return false;
}

/** 文本是否含不可见 Unicode 字符 */
export function containsInvisibleChars(text: string): boolean {
  if (!text) return false;
  for (let i = 0; i < text.length; i++) {
    if (isInvisibleCodePoint(text.charCodeAt(i))) return true;
  }
  return false;
}

/** 统计文本中不可见 Unicode 字符个数（供威胁报告复用，避免各调用方自建正则） */
export function countInvisibleChars(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (isInvisibleCodePoint(text.charCodeAt(i))) count++;
  }
  return count;
}

/**
 * 可选的同形字符映射
 * 可能被用于钓鱼攻击的字符替换
 */
const HOMOGLYPH_MAP: Record<number, number> = {
  0x0430: 0x0061,
  0x0441: 0x0063,
  0x0435: 0x0065,
  0x043e: 0x006f,
  0x0440: 0x0070,
  0x0445: 0x0078,
  0x0443: 0x0079,
};

/**
 * 清理结果
 */
export interface UnicodeSanitizeResult {
  output: string;
  changed: boolean;
  removedChars: number;
  details: string[];
}

/**
 * Unicode 清理器
 */
export class UnicodeSanitizer {
  private enabled: boolean;
  private removeInvisible: boolean;
  private normalizeHomoglyphs: boolean;

  /**
   * 构造函数
   * @param options 配置选项
   */
  constructor(options?: {
    enabled?: boolean;
    removeInvisible?: boolean;
    normalizeHomoglyphs?: boolean;
  }) {
    this.enabled = options?.enabled ?? true;
    this.removeInvisible = options?.removeInvisible ?? true;
    this.normalizeHomoglyphs = options?.normalizeHomoglyphs ?? false;
  }

  /**
   * 清理字符串中的不可见 Unicode 字符
   * @param text 原始文本
   * @returns 清理结果
   */
  sanitize(text: string): UnicodeSanitizeResult {
    if (!this.enabled || !text) {
      return { output: text, changed: false, removedChars: 0, details: [] };
    }

    const details: string[] = [];
    let output = text;
    let removedChars = 0;

    if (this.removeInvisible) {
      const invResult = this.removeInvisibleCharacters(output);
      if (invResult.removed > 0) {
        output = invResult.text;
        removedChars += invResult.removed;
        details.push(`移除了 ${invResult.removed} 个不可见 Unicode 字符`);
      }
    }

    if (this.normalizeHomoglyphs) {
      const homResult = this.normalizeHomoglyphCharacters(output);
      if (homResult.changed > 0) {
        output = homResult.text;
        details.push(`规范化了 ${homResult.changed} 个同形字符`);
      }
    }

    return {
      output,
      changed: text !== output,
      removedChars,
      details,
    };
  }

  /**
   * 移除不可见 Unicode 字符
   * @param text 原始文本
   * @returns 处理结果
   */
  private removeInvisibleCharacters(text: string): {
    text: string;
    removed: number;
  } {
    let result = '';
    let removed = 0;

    for (let i = 0; i < text.length; i++) {
      if (isInvisibleCodePoint(text.charCodeAt(i))) {
        removed++;
      } else {
        result += text[i];
      }
    }

    return { text: result, removed };
  }

  /**
   * 规范化同形字符
   * @param text 原始文本
   * @returns 处理结果
   */
  private normalizeHomoglyphCharacters(text: string): {
    text: string;
    changed: number;
  } {
    let result = '';
    let changed = 0;

    for (let i = 0; i < text.length; i++) {
      const codePoint = text.charCodeAt(i);
      const mapped = HOMOGLYPH_MAP[codePoint];

      if (mapped !== undefined) {
        result += String.fromCharCode(mapped);
        changed++;
      } else {
        result += text[i];
      }
    }

    return { text: result, changed };
  }

  /**
   * 检查文本是否包含不可见 Unicode 字符
   * @param text 输入文本
   * @returns 是否包含
   */
  hasInvisibleCharacters(text: string): boolean {
    return containsInvisibleChars(text);
  }

  /**
   * 获取文本中不可见 Unicode 字符的详情
   * @param text 输入文本
   * @returns 字符详情
   */
  getInvisibleCharacterDetails(
    text: string
  ): Array<{ char: string; codePoint: number; name: string }> {
    const details: Array<{ char: string; codePoint: number; name: string }> =
      [];

    for (let i = 0; i < text.length; i++) {
      const codePoint = text.charCodeAt(i);

      for (const range of INVISIBLE_UNICODE_RANGES) {
        if (codePoint >= range.start && codePoint <= range.end) {
          details.push({
            char: text[i],
            codePoint,
            name: range.name,
          });
        }
      }
    }

    return details;
  }

  /**
   * 设置启用状态
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

/**
 * 全局 Unicode 清理器实例
 */
let globalSanitizer: UnicodeSanitizer | null = null;

/**
 * 获取全局 Unicode 清理器
 */
export function getUnicodeSanitizer(): UnicodeSanitizer {
  if (!globalSanitizer) {
    globalSanitizer = new UnicodeSanitizer();
  }

  return globalSanitizer;
}
