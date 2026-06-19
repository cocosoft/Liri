/**
 * 分类器集成
 * 负责集成分类器进行权限决策，判断工具使用是否安全
 */
import {
  PermissionDecision,
  PermissionDecisionType,
  createAllowDecision,
  createDenyDecision,
  createAskDecision,
} from '../types/PermissionDecision';
import { PermissionContext } from '../types/PermissionContext';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 工具安全白名单 - 只读工具不需要分类器检查
 */
const SAFE_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'TodoWrite',
  'TaskCreate',
  'TaskGet',
  'TaskUpdate',
  'TaskList',
  'TaskStop',
  'TaskOutput',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
]);

/**
 * 已知的安全Bash命令白名单
 */
const SAFE_BASH_COMMANDS = new Set([
  'echo',
  'cat',
  'ls',
  'pwd',
  'cd',
  'mkdir',
  'rmdir',
  'find',
  'grep',
  'sed',
  'awk',
  'sort',
  'uniq',
  'cut',
  'paste',
  'tr',
  'head',
  'tail',
  'wc',
  'du',
  'df',
  'stat',
  'chmod',
  'chown',
  'cp',
  'mv',
  'touch',
]);

/**
 * 危险Bash命令前缀黑名单
 */
const DANGEROUS_BASH_PREFIXES = [
  'rm -rf',
  'rm -r /',
  'rm -f /',
  'mkfs',
  'dd if=',
  'shutdown',
  'reboot',
  'sudo ',
  'su ',
  'passwd',
  'useradd',
  'userdel',
  'kill -9',
  'wget ',
  'curl ',
  'scp ',
  'rsync ',
  'ssh ',
  'ftp ',
  'telnet',
  'nmap',
  'ping -f',
  'traceroute',
  'tcpdump',
  'mount ',
  'umount ',
  'fdisk',
  'parted',
  'fsck',
  'resize2fs',
  'cat /dev/',
];

/**
 * 分类结果类型
 */
export type ClassificationResult = 'safe' | 'unsafe' | 'unknown';

/**
 * 分类器集成类
 */
export class ClassifierIntegration {
  /**
   * 使用分类器检查权限
   * @param toolName 工具名称
   * @param input 工具输入
   * @param context 权限上下文
   * @returns 权限决策
   */
  static async checkPermission(
    toolName: string,
    input: Record<string, unknown>,
    context: PermissionContext
  ): Promise<PermissionDecision> {
    try {
      if (this.shouldSkipClassifier(toolName)) {
        return createAllowDecision('Tool is in safe allowlist');
      }

      const classification = await this.classifyToolUse(toolName, input);

      switch (classification) {
        case 'safe':
          return createAllowDecision('Tool use classified as safe');
        case 'unsafe':
          return createDenyDecision('Tool use classified as unsafe');
        case 'unknown':
        default:
          return createAskDecision('Tool use classification unknown');
      }
    } catch (error) {
      await handleError(error, {
        module: 'permission:integration',
        action: 'classifier_check',
      });
      return createAskDecision('Classifier error, requiring user approval');
    }
  }

  /**
   * 分类工具使用
   * @param toolName 工具名称
   * @param input 工具输入
   * @returns 分类结果
   */
  static async classifyToolUse(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<ClassificationResult> {
    if (SAFE_TOOLS.has(toolName)) {
      return 'safe';
    }

    if (toolName === 'Bash') {
      return this.classifyBashCommand(input);
    }

    if (toolName === 'Write' || toolName === 'Edit') {
      return this.classifyFileOperation(input);
    }

    return 'unknown';
  }

  /**
   * 分类Bash命令
   * @param input 工具输入
   * @returns 分类结果
   */
  private static classifyBashCommand(
    input: Record<string, unknown>
  ): ClassificationResult {
    const command = input.command as string;
    if (!command) {
      return 'unknown';
    }

    const trimmedCommand = command.trim().toLowerCase();

    for (const prefix of DANGEROUS_BASH_PREFIXES) {
      if (trimmedCommand.startsWith(prefix.toLowerCase())) {
        return 'unsafe';
      }
    }

    const firstWord = trimmedCommand.split(/\s+/)[0];
    if (SAFE_BASH_COMMANDS.has(firstWord)) {
      return 'safe';
    }

    return 'unknown';
  }

  /**
   * 分类文件操作
   * @param input 工具输入
   * @returns 分类结果
   */
  private static classifyFileOperation(
    input: Record<string, unknown>
  ): ClassificationResult {
    const filePath = input.path as string;
    if (!filePath) {
      return 'unknown';
    }

    if (
      filePath.includes('..') ||
      filePath.startsWith('/etc/') ||
      filePath.startsWith('/sys/')
    ) {
      return 'unsafe';
    }

    return 'unknown';
  }

  /**
   * 检查是否应该跳过分类器
   * @param toolName 工具名称
   * @returns 是否跳过
   */
  static shouldSkipClassifier(toolName: string): boolean {
    return SAFE_TOOLS.has(toolName);
  }

  /**
   * 获取安全工具列表
   * @returns 安全工具名称数组
   */
  static getSafeTools(): string[] {
    return Array.from(SAFE_TOOLS);
  }
}
