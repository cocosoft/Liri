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
 * 注入检测结果
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

    const severityOrder: InjectionSeverity[] = [
      'low',
      'medium',
      'high',
      'critical',
    ];

    for (const { name, pattern, severity, description } of this.patterns) {
      const match = pattern.exec(userInput);
      if (match) {
        matchedPatterns.push(name);
        suspiciousContent.push(`${description}: "${match[0].slice(0, 100)}"`);

        const currentLevel = severityOrder.indexOf(severity);
        const maxLevel = severityOrder.indexOf(maxSeverity);
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
