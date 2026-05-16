/**
 * 提示注入检测器
 * 对标 Hermes agent/prompt_builder.py 的注入检测
 * 在系统提示构建前检测注入模式和不可见 Unicode
 */

/**
 * 注入检测级别
 */
export type InjectionSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * 综合风险等级
 */
export type DetectionLevel = 'safe' | 'warning' | 'dangerous';

/**
 * 注入检测结果（原有接口，向后兼容）
 */
export interface InjectionDetectionResult {
  /** 是否检测到注入 */
  detected: boolean;
  /** 严重程度 */
  severity: InjectionSeverity;
  /** 匹配的注入模式 */
  matchedPatterns: string[];
  /** 风险描述 */
  description: string;
  /** 检测到的可疑内容摘要 */
  suspiciousContent: string[];
}

/**
 * 威胁匹配条目
 */
export interface ThreatMatch {
  /** 模式名称 */
  pattern: string;
  /** 匹配内容 */
  match: string;
  /** 在原文中的位置 */
  index: number;
  /** 严重程度 */
  severity: InjectionSeverity;
  /** 模式描述 */
  description: string;
}

/**
 * 不可见字符匹配条目
 */
export interface InvisibleCharMatch {
  /** 字符名称 */
  name: string;
  /** Unicode 码点 */
  codePoint: number;
  /** 字符原文 */
  char: string;
  /** 在原文中的位置 */
  index: number;
  /** 字符描述 */
  description: string;
}

/**
 * 综合检测结果（方案接口）
 */
export interface DetectionResult {
  /** 综合风险等级 */
  level: DetectionLevel;
  /** 匹配的威胁条目 */
  matches: ThreatMatch[];
  /** 匹配的不可见字符条目 */
  invisibleChars: InvisibleCharMatch[];
  /** 风险评分 0-100 */
  score: number;
}

/**
 * 注入模式定义
 */
interface InjectionPattern {
  name: string;
  pattern: RegExp;
  severity: InjectionSeverity;
  description: string;
}

/**
 * 注入模式库
 */
const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    name: 'ignore_previous',
    pattern:
      /(ignore|forget|disregard)\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|context)/i,
    severity: 'high',
    description: '要求忽略之前的指令',
  },
  {
    name: 'new_instructions',
    pattern:
      /(your\s+new\s+instructions?\s+(are|is)|new\s+system\s+prompt|override\s+(the\s+)?system\s+prompt)/i,
    severity: 'critical',
    description: '尝试注入新的系统指令',
  },
  {
    name: 'role_override',
    pattern:
      /(you\s+are\s+now|act\s+as\s+(if\s+)?you\s+are|pretend\s+(to\s+be|you\s+are)|role\s*:\s*new)/i,
    severity: 'high',
    description: '尝试覆盖角色设置',
  },
  {
    name: 'jailbreak_prefix',
    pattern:
      /(DAN\s+mode|developer\s+mode|jailbreak|uncensored\s+mode|evil\s+mode)/i,
    severity: 'critical',
    description: '已知越狱前缀',
  },
  {
    name: 'prompt_leak',
    pattern:
      /(print|show|display|reveal|output|tell\s+me)\s+(your|the)\s+(system\s+)?(prompt|instructions?|rules?|guidelines?)/i,
    severity: 'high',
    description: '尝试提取系统提示',
  },
  {
    name: 'hidden_text',
    pattern: /(<!--[\s\S]*?-->|`{3,}[\s\S]*?`{3,})/,
    severity: 'medium',
    description: '包含隐藏文本或代码块',
  },
  {
    name: 'recursive_injection',
    pattern:
      /<\|im_start\|>|<\|im_end\|>|\[INST\]|\[\/INST\]|\[SYS\]|\[\/SYS\]/i,
    severity: 'high',
    description: '尝试使用递归注入（聊天模板标记）',
  },
  {
    name: 'tool_hijack',
    pattern:
      /(use\s+(the\s+)?(bash|shell|terminal|exec|command)\s+(to|and)\s+(hack|exploit|attack|steal|bypass))/i,
    severity: 'critical',
    description: '尝试劫持工具执行危险操作',
  },
  {
    name: 'encoding_escape',
    pattern:
      /(base64|rot13|hex\s+encode|unicode\s+escape|encode\s+in).*(decode|decrypt|translate|convert)/i,
    severity: 'medium',
    description: '尝试编码绕过检测',
  },
  {
    name: 'false_alignment',
    pattern:
      /(\[SYSTEM\s+OVERRIDE\]|\[HIDDEN\s+INSTRUCTION\]|\[INTERNAL\s+ONLY\]|\[ADMIN\s+MODE\])/i,
    severity: 'high',
    description: '包含伪造的系统级指令标记',
  },

  {
    name: 'exfil_curl',
    pattern: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i,
    severity: 'critical',
    description: '尝试通过 curl 外泄敏感信息',
  },
  {
    name: 'read_secrets',
    pattern:
      /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|id_rsa|id_ed25519)/i,
    severity: 'critical',
    description: '尝试读取敏感凭据文件',
  },
  {
    name: 'translate_execute',
    pattern: /translate\s+.*\s+into\s+.*\s+and\s+(execute|run|eval)/i,
    severity: 'high',
    description: '通过翻译指令间接执行代码',
  },
  {
    name: 'hidden_div',
    pattern: /<\s*div\s+style\s*=\s*["'][\s\S]*?display\s*:\s*none/i,
    severity: 'high',
    description: 'HTML 隐藏 div 注入',
  },
];

/**
 * 不可见 Unicode 字符范围定义
 */
const INVISIBLE_UNICODE_RANGES: Array<{
  name: string;
  start: number;
  end: number;
  description: string;
}> = [
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
    end: 0x2064,
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
 * 严重程度对应的分数权重
 */
const SEVERITY_SCORE: Record<InjectionSeverity, number> = {
  low: 1,
  medium: 3,
  high: 6,
  critical: 10,
};

/**
 * 严重程度排序
 */
const SEVERITY_ORDER: InjectionSeverity[] = [
  'low',
  'medium',
  'high',
  'critical',
];

/**
 * 提示注入检测器
 */
export class PromptInjectionDetector {
  private patterns: InjectionPattern[];
  private enabled: boolean;

  /**
   * 构造函数
   * @param enabled 是否启用
   */
  constructor(enabled: boolean = true) {
    this.enabled = enabled;
    this.patterns = [...INJECTION_PATTERNS];
  }

  /**
   * 设置启用状态
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 添加自定义注入模式
   * @param pattern 注入模式
   */
  addPattern(pattern: InjectionPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * 检测用户输入中的注入攻击
   * @param userInput 用户输入
   * @returns 检测结果
   */
  detect(userInput: string): InjectionDetectionResult {
    if (!this.enabled || !userInput) {
      return {
        detected: false,
        severity: 'low',
        matchedPatterns: [],
        description: '检测已禁用或输入为空',
        suspiciousContent: [],
      };
    }

    const matchedPatterns: string[] = [];
    const suspiciousContent: string[] = [];
    let maxSeverity: InjectionSeverity = 'low';

    for (const { name, pattern, severity, description } of this.patterns) {
      const match = pattern.exec(userInput);
      if (match) {
        matchedPatterns.push(name);
        suspiciousContent.push(`${description}: "${match[0].slice(0, 100)}"`);

        const currentLevel = SEVERITY_ORDER.indexOf(severity);
        const maxLevel = SEVERITY_ORDER.indexOf(maxSeverity);
        if (currentLevel > maxLevel) {
          maxSeverity = severity;
        }
      }
    }

    return {
      detected: matchedPatterns.length > 0,
      severity: maxSeverity,
      matchedPatterns,
      description:
        matchedPatterns.length > 0
          ? `检测到 ${matchedPatterns.length} 个注入模式，最高风险: ${maxSeverity}`
          : '未检测到注入模式',
      suspiciousContent: suspiciousContent.slice(0, 5),
    };
  }

  /**
   * 快速检查是否存在注入风险
   * @param userInput 用户输入
   * @returns 是否存在注入
   */
  hasInjection(userInput: string): boolean {
    return this.detect(userInput).detected;
  }

  /**
   * 检测注入风险级别
   * @param userInput 用户输入
   * @returns 风险级别
   */
  getSeverity(userInput: string): InjectionSeverity {
    return this.detect(userInput).severity;
  }

  /**
   * 对消息列表进行批量检测
   * @param messages 消息列表
   * @returns 检测结果列表
   */
  detectBatch(
    messages: Array<{ role: string; content: string }>
  ): InjectionDetectionResult[] {
    return messages.map((msg) => ({
      ...this.detect(msg.content),
    }));
  }

  /**
   * 对系统提示构建前的完整消息进行检查
   * @param systemPrompt 系统提示
   * @param userMessages 用户消息列表
   * @returns 综合检测结果
   */
  preBuildCheck(
    systemPrompt: string,
    userMessages: Array<{ role: string; content: string }>
  ): InjectionDetectionResult {
    const combinedInput =
      systemPrompt + '\n' + userMessages.map((m) => m.content).join('\n');

    return this.detect(combinedInput);
  }

  /**
   * 扫描输入中的威胁模式，返回详细匹配列表
   * @param userInput 用户输入
   * @returns 威胁匹配列表
   */
  scan(userInput: string): ThreatMatch[] {
    if (!this.enabled || !userInput) {
      return [];
    }

    const matches: ThreatMatch[] = [];

    for (const { name, pattern, severity, description } of this.patterns) {
      const regex = new RegExp(
        pattern.source,
        pattern.flags.replace('g', '') + 'g'
      );
      let match: RegExpExecArray | null;

      while ((match = regex.exec(userInput)) !== null) {
        matches.push({
          pattern: name,
          match: match[0].slice(0, 200),
          index: match.index,
          severity,
          description,
        });
      }
    }

    return matches.sort((a, b) => a.index - b.index);
  }

  /**
   * 扫描输入中的不可见 Unicode 字符
   * @param userInput 用户输入
   * @returns 不可见字符匹配列表
   */
  scanInvisibleChars(userInput: string): InvisibleCharMatch[] {
    if (!userInput) {
      return [];
    }

    const matches: InvisibleCharMatch[] = [];

    for (let i = 0; i < userInput.length; i++) {
      const codePoint = userInput.charCodeAt(i);

      for (const range of INVISIBLE_UNICODE_RANGES) {
        if (codePoint >= range.start && codePoint <= range.end) {
          matches.push({
            name: range.name,
            codePoint,
            char: userInput[i],
            index: i,
            description: range.description,
          });
          break;
        }
      }
    }

    return matches;
  }

  /**
   * 综合检测（方案接口）
   * 返回风险等级和评分，而非简单的通过/不通过
   * @param userInput 用户输入
   * @returns 综合检测结果
   */
  detectV2(userInput: string): DetectionResult {
    const threatMatches = this.scan(userInput);
    const invisibleCharMatches = this.scanInvisibleChars(userInput);
    const hasInvisibleChars = invisibleCharMatches.length > 0;

    let totalScore = 0;

    for (const tm of threatMatches) {
      totalScore += SEVERITY_SCORE[tm.severity];
    }

    if (hasInvisibleChars) {
      totalScore += Math.min(invisibleCharMatches.length, 5);
    }

    let level: DetectionLevel;
    if (totalScore === 0) {
      level = 'safe';
    } else if (totalScore <= 3) {
      level = 'warning';
    } else {
      level = 'dangerous';
    }

    totalScore = Math.min(totalScore, 100);

    return {
      level,
      matches: threatMatches,
      invisibleChars: invisibleCharMatches,
      score: totalScore,
    };
  }

  /**
   * 获取注入模式数量
   */
  getPatternCount(): number {
    return this.patterns.length;
  }

  /**
   * 获取所有注入模式名称
   */
  getPatternNames(): string[] {
    return this.patterns.map((p) => p.name);
  }
}

/**
 * 全局检测器实例
 */
let globalDetector: PromptInjectionDetector | null = null;

/**
 * 获取全局提示注入检测器
 */
export function getPromptInjectionDetector(): PromptInjectionDetector {
  if (!globalDetector) {
    globalDetector = new PromptInjectionDetector();
  }

  return globalDetector;
}

/**
 * 重置全局检测器
 */
export function resetPromptInjectionDetector(): void {
  globalDetector = null;
}
