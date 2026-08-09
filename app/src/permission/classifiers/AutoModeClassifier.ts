/**
 * 自动模式分类器
 * 用于自动判断工具使用是否安全
 */

import { handleError } from '@modules/error';
import { DANGEROUS_TOOL_KEYWORDS } from './dangerous-tool-keywords';
import { DANGEROUS_COMMAND_PATTERNS } from './dangerous-command-patterns';
import { SENSITIVE_PATH_PATTERNS } from './sensitive-path-patterns';
import { ENV_POLLUTION_PATTERNS } from './env-pollution-patterns';
import { ZERO_WIDTH_PATTERNS } from './zero-width-patterns';
import {
  detectZeroWidthCharacters,
  detectNullByteInjection,
  detectZshEqualsExpansion,
  detectEncodingAttack,
  detectSqlInjection,
  detectXssAttack,
  detectCommandInjection,
  detectDeserializationAttack,
  detectLDAPInjection,
  detectXXEAttack,
} from './injection-rules';
import {
  detectTemplateInjection,
  detectPathTraversal,
  detectPipeAndRedirect,
  detectReDoSAttack,
  detectSSRFAttack,
  detectFileInclusion,
  detectRequestSmuggling,
  detectWebSocketAttack,
  detectDNSTunnel,
} from './vector-rules';

/**
 * 分类器决策结果
 */
export interface ClassifierDecision {
  /**
   * 是否应该阻止
   */
  shouldBlock: boolean;
  /**
   * 阻止原因
   */
  reason?: string;
  /**
   * 分类器是否不可用
   */
  unavailable?: boolean;
  /**
   * 转录是否太长
   */
  transcriptTooLong?: boolean;
  /**
   * 分类器使用信息
   */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
  /**
   * 使用的模型
   */
  model?: string;
  /**
   * 执行耗时（毫秒）
   */
  durationMs?: number;
}

/**
 * 分类器接口
 */
export interface IAutoModeClassifier {
  /**
   * 分类工具使用
   * @param toolName 工具名称
   * @param input 工具输入
   * @param messages 对话历史
   * @returns 分类决策
   */
  classify(
    toolName: string,
    input: Record<string, unknown>,
    messages: Array<{ role: string; content: string }>
  ): Promise<ClassifierDecision>;

  /**
   * 检查工具是否在安全白名单中
   * @param toolName 工具名称
   * @returns 是否在白名单中
   */
  isAllowlistedTool(toolName: string): boolean;
}

/**
 * 安全工具白名单
 * 这些工具被认为是安全的，不需要分类器检查
 */
const SAFE_TOOLS = new Set([
  'read',
  'list',
  'search',
  'view',
  'cat',
  'pwd',
  'echo',
  'help',
  'info',
  'status',
  'version',
  'whoami',
]);

/**
 * 模拟自动模式分类器实现
 * 这是一个基础实现，实际项目中可以替换为真实的AI分类器
 */
export class AutoModeClassifier implements IAutoModeClassifier {
  /**
   * 分类器名称
   */
  readonly name = 'auto-mode';

  /**
   * 分类工具使用
   * @param toolName 工具名称
   * @param input 工具输入
   * @param messages 对话历史
   * @returns 分类决策
   */
  async classify(
    toolName: string,
    input: Record<string, unknown>,
    messages: Array<{ role: string; content: string }>
  ): Promise<ClassifierDecision> {
    const startTime = Date.now();

    try {
      // 检查是否是安全工具
      if (this.isAllowlistedTool(toolName)) {
        return {
          shouldBlock: false,
          reason: 'Tool is in safe allowlist',
          durationMs: Date.now() - startTime,
        };
      }

      // 简单的启发式规则
      const decision = this.heuristicClassify(toolName, input);

      return {
        ...decision,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      await handleError(error, {
        module: 'permission:classifier',
        action: 'classify',
      });
      return {
        shouldBlock: true,
        unavailable: true,
        reason: 'Classifier unavailable',
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 检查工具是否在安全白名单中
   * @param toolName 工具名称
   * @returns 是否在白名单中
   */
  isAllowlistedTool(toolName: string): boolean {
    const lowerName = toolName.toLowerCase();
    return SAFE_TOOLS.has(lowerName) || this.isPartialMatch(lowerName);
  }

  /**
   * 启发式分类
   * @param toolName 工具名称
   * @param input 工具输入
   * @returns 分类决策
   */
  private heuristicClassify(
    toolName: string,
    input: Record<string, unknown>
  ): ClassifierDecision {
    const lowerToolName = toolName.toLowerCase();

    // 检查危险工具关键词（使用完整单词匹配，避免子字符串误匹配）
    for (const dangerous of DANGEROUS_TOOL_KEYWORDS) {
      // 只匹配完整单词：工具名等于关键词，或以关键词开头后跟下划线/连字符，或包含关键词作为完整部分
      const pattern = new RegExp(
        `(^${dangerous}$)|(^${dangerous}[_-])|([_-]${dangerous}$)|([_-]${dangerous}[_-])`
      );
      if (pattern.test(lowerToolName)) {
        return {
          shouldBlock: true,
          reason: `Tool "${toolName}" contains dangerous keyword: "${dangerous}"`,
        };
      }
    }

    // 检查输入中的危险命令模式
    const inputString = JSON.stringify(input).toLowerCase();

    // 检查Unicode零宽字符注入
    const zeroWidthResult = detectZeroWidthCharacters(
      inputString,
      ZERO_WIDTH_PATTERNS
    );
    if (zeroWidthResult) {
      return zeroWidthResult;
    }

    // 检查空字节注入
    const nullByteResult = detectNullByteInjection(inputString);
    if (nullByteResult) {
      return nullByteResult;
    }

    // 检查Zsh equals expansion攻击
    const zshResult = detectZshEqualsExpansion(inputString);
    if (zshResult) {
      return zshResult;
    }

    // 检查编码攻击（Base64、URL编码等）
    const encodingResult = detectEncodingAttack(inputString);
    if (encodingResult) {
      return encodingResult;
    }

    // 检查危险命令模式
    for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
      if (inputString.includes(pattern)) {
        return {
          shouldBlock: true,
          reason: `Input contains dangerous command pattern: "${pattern}"`,
        };
      }
    }

    // 检查敏感路径访问
    for (const pathPattern of SENSITIVE_PATH_PATTERNS) {
      if (inputString.includes(pathPattern.toLowerCase())) {
        return {
          shouldBlock: true,
          reason: `Input attempts to access sensitive path: "${pathPattern}"`,
        };
      }
    }

    // 检查环境变量污染
    for (const envPattern of ENV_POLLUTION_PATTERNS) {
      if (inputString.includes(envPattern)) {
        return {
          shouldBlock: true,
          reason: `Input attempts to modify critical environment variable: "${envPattern}"`,
        };
      }
    }

    // 检查路径遍历
    const pathTraversalResult = detectPathTraversal(inputString);
    if (pathTraversalResult) {
      return pathTraversalResult;
    }

    // 检查管道和重定向
    const pipeResult = detectPipeAndRedirect(inputString);
    if (pipeResult) {
      return pipeResult;
    }

    // 检查SQL注入
    const sqlResult = detectSqlInjection(inputString);
    if (sqlResult) {
      return sqlResult;
    }

    // 检查XSS攻击
    const xssResult = detectXssAttack(inputString);
    if (xssResult) {
      return xssResult;
    }

    // 检查命令注入
    const cmdInjectionResult = detectCommandInjection(inputString);
    if (cmdInjectionResult) {
      return cmdInjectionResult;
    }

    // 检查反序列化攻击
    const deserializationResult = detectDeserializationAttack(inputString);
    if (deserializationResult) {
      return deserializationResult;
    }

    // 检查正则表达式DoS攻击（ReDoS）
    const redosResult = detectReDoSAttack(inputString);
    if (redosResult) {
      return redosResult;
    }

    // 检查服务器端请求伪造（SSRF）
    const ssrfResult = detectSSRFAttack(inputString);
    if (ssrfResult) {
      return ssrfResult;
    }

    // 检查文件包含攻击
    const fileInclusionResult = detectFileInclusion(inputString);
    if (fileInclusionResult) {
      return fileInclusionResult;
    }

    // 检查LDAP注入攻击
    const ldapResult = detectLDAPInjection(inputString);
    if (ldapResult) {
      return ldapResult;
    }

    // 检查XML外部实体攻击（XXE）
    const xxeResult = detectXXEAttack(inputString);
    if (xxeResult) {
      return xxeResult;
    }

    // 检查模板注入攻击
    const templateResult = detectTemplateInjection(inputString);
    if (templateResult) {
      return templateResult;
    }

    // 检查请求走私攻击
    const smugglingResult = detectRequestSmuggling(inputString);
    if (smugglingResult) {
      return smugglingResult;
    }

    // 检查WebSocket劫持攻击
    const websocketResult = detectWebSocketAttack(inputString);
    if (websocketResult) {
      return websocketResult;
    }

    // 检查DNS隧道攻击
    const dnsTunnelResult = detectDNSTunnel(inputString);
    if (dnsTunnelResult) {
      return dnsTunnelResult;
    }

    // 默认允许
    return {
      shouldBlock: false,
      reason: 'Action appears safe',
    };
  }

  /**
   * 检查是否部分匹配
   * @param toolName 工具名称
   * @returns 是否匹配
   */
  private isPartialMatch(toolName: string): boolean {
    const safeKeywords = [
      'read',
      'list',
      'search',
      'view',
      'show',
      'get',
      'find',
      'ls',
      'dir',
      'cat',
    ];

    for (const keyword of safeKeywords) {
      if (toolName.includes(keyword)) {
        return true;
      }
    }

    return false;
  }
}
