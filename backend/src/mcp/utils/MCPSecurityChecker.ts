/**
 * MCP安全检查工具
 * 提供工具调用验证、参数检查和危险命令检测
 */

import type { MCPToolDefinition } from '../types';

export interface SecurityCheckResult {
  safe: boolean;
  reason?: string;
  warnings: string[];
}

/**
 * MCP安全检查器
 */
export class MCPSecurityChecker {
  private static readonly DANGEROUS_COMMANDS = [
    'rm',
    'del',
    'format',
    'shutdown',
    'restart',
    'kill',
    'pkill',
    'taskkill',
    'netstat',
    'nmap',
    'curl',
    'wget',
    'nc',
    'netcat',
    'ssh',
    'ftp',
    'telnet',
    'passwd',
    'sudo',
    'chmod',
    'chown',
  ];

  private static readonly DANGEROUS_PATTERNS = [
    /[\;\|\`\$\(\)\<\>]/,
    /\.\.\//,
    /\/etc\/passwd/,
    /\/etc\/shadow/,
    /~\/\\.ssh/,
    /\.env$/,
    /password/i,
    /secret/i,
    /token/i,
  ];

  private static readonly FILE_WRITE_PATTERNS = [
    /\.sh$/,
    /\.bat$/,
    /\.cmd$/,
    /\.ps1$/,
    /\.vbs$/,
    /\.exe$/,
    /\.dll$/,
    /\.so$/,
    /\.dylib$/,
  ];

  private static readonly NETWORK_PATTERNS = [
    /https?:\/\/[^\s]+/,
    /ftp:\/\/[^\s]+/,
    /sftp:\/\/[^\s]+/,
    /ssh:\/\/[^\s]+/,
  ];

  /**
   * 检查工具定义安全性
   */
  static checkToolDefinition(tool: MCPToolDefinition): SecurityCheckResult {
    const warnings: string[] = [];

    if (!tool.name || tool.name.trim() === '') {
      return {
        safe: false,
        reason: '工具名称不能为空',
        warnings: [],
      };
    }

    if (tool.name.includes('..') || tool.name.includes('/')) {
      return {
        safe: false,
        reason: '工具名称包含非法字符',
        warnings: [],
      };
    }

    if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
      warnings.push('工具缺少输入schema定义');
    }

    return {
      safe: true,
      warnings,
    };
  }

  /**
   * 检查工具调用参数
   */
  static checkToolArguments(
    toolName: string,
    args: Record<string, any>
  ): SecurityCheckResult {
    const warnings: string[] = [];

    if (!args || typeof args !== 'object') {
      return {
        safe: false,
        reason: '工具参数必须是对象',
        warnings: [],
      };
    }

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string') {
        const checkResult = this.checkStringSafety(value, key);
        if (!checkResult.safe) {
          return checkResult;
        }
        warnings.push(...checkResult.warnings);
      }
    }

    return {
      safe: true,
      warnings,
    };
  }

  /**
   * 检查字符串安全性
   */
  static checkStringSafety(
    value: string,
    context: string = 'value'
  ): SecurityCheckResult {
    const warnings: string[] = [];

    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(value)) {
        return {
          safe: false,
          reason: `${context}包含危险模式: ${pattern.toString()}`,
          warnings: [],
        };
      }
    }

    return {
      safe: true,
      warnings,
    };
  }

  /**
   * 检查命令安全性
   */
  static checkCommandSafety(command: string): SecurityCheckResult {
    const warnings: string[] = [];

    const commandLower = command.toLowerCase();
    const parts = commandLower.split(/\s+/);

    for (const part of parts) {
      if (this.DANGEROUS_COMMANDS.includes(part)) {
        warnings.push(`命令包含危险命令: ${part}`);
      }
    }

    if (
      command.includes('|') ||
      command.includes(';') ||
      command.includes('&&')
    ) {
      warnings.push('命令包含多个命令连接符');
    }

    return {
      safe: warnings.length === 0,
      warnings,
      reason: warnings.length > 0 ? '命令包含可能的危险操作' : undefined,
    };
  }

  /**
   * 检查文件路径安全性
   */
  static checkFilePathSafety(path: string): SecurityCheckResult {
    const warnings: string[] = [];

    if (path.includes('..')) {
      return {
        safe: false,
        reason: '路径包含目录遍历',
        warnings: [],
      };
    }

    if (path.includes('~') && path.includes('.ssh')) {
      return {
        safe: false,
        reason: '路径尝试访问SSH配置',
        warnings: [],
      };
    }

    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(path)) {
        return {
          safe: false,
          reason: '路径包含危险模式',
          warnings: [],
        };
      }
    }

    for (const pattern of this.FILE_WRITE_PATTERNS) {
      if (pattern.test(path)) {
        warnings.push(`尝试写入可执行文件: ${path}`);
      }
    }

    return {
      safe: true,
      warnings,
    };
  }

  /**
   * 检查文件写入操作
   */
  static checkFileWriteSafety(path: string): SecurityCheckResult {
    for (const pattern of this.FILE_WRITE_PATTERNS) {
      if (pattern.test(path)) {
        return {
          safe: false,
          reason: `禁止写入可执行文件类型: ${path}`,
          warnings: [],
        };
      }
    }

    return this.checkFilePathSafety(path);
  }

  /**
   * 检查网络请求安全性
   */
  static checkNetworkRequestSafety(url: string): SecurityCheckResult {
    const warnings: string[] = [];

    if (url.startsWith('http://')) {
      warnings.push('使用不安全的HTTP协议');
    }

    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      warnings.push('请求指向本地地址');
    }

    if (url.includes('0.0.0.0')) {
      warnings.push('请求指向所有接口');
    }

    return {
      safe: warnings.length === 0 || warnings.includes('使用不安全的HTTP协议'),
      warnings,
    };
  }

  /**
   * 检查工具调用整体安全性
   */
  static checkToolCall(
    toolName: string,
    args: Record<string, any>,
    availableTools: MCPToolDefinition[]
  ): SecurityCheckResult {
    const warnings: string[] = [];

    const tool = availableTools.find((t) => t.name === toolName);
    if (!tool) {
      return {
        safe: false,
        reason: `工具不存在: ${toolName}`,
        warnings: [],
      };
    }

    const toolCheck = this.checkToolDefinition(tool);
    if (!toolCheck.safe) {
      return toolCheck;
    }
    warnings.push(...toolCheck.warnings);

    const argsCheck = this.checkToolArguments(toolName, args);
    if (!argsCheck.safe) {
      return argsCheck;
    }
    warnings.push(...argsCheck.warnings);

    return {
      safe: true,
      warnings,
    };
  }

  /**
   * 验证JSON-RPC请求格式
   */
  static validateJSONRPCRequest(request: any): SecurityCheckResult {
    const warnings: string[] = [];

    if (!request || typeof request !== 'object') {
      return {
        safe: false,
        reason: '请求必须是对象',
        warnings: [],
      };
    }

    if (!request.id) {
      warnings.push('请求缺少id字段');
    }

    if (!request.method) {
      return {
        safe: false,
        reason: '请求缺少method字段',
        warnings: [],
      };
    }

    if (typeof request.method !== 'string') {
      return {
        safe: false,
        reason: 'method必须是字符串',
        warnings: [],
      };
    }

    if (request.method.includes('..') || request.method.includes('/')) {
      return {
        safe: false,
        reason: 'method包含非法字符',
        warnings: [],
      };
    }

    return {
      safe: true,
      warnings,
    };
  }

  /**
   * 获取所有危险命令列表
   */
  static getDangerousCommands(): string[] {
    return [...this.DANGEROUS_COMMANDS];
  }

  /**
   * 检查是否包含IP端口
   */
  static checkIPPortAccess(value: string): SecurityCheckResult {
    const ipPortPattern = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+/;

    if (ipPortPattern.test(value)) {
      return {
        safe: false,
        reason: '禁止访问IP地址端口',
        warnings: [],
      };
    }

    return {
      safe: true,
      warnings: [],
    };
  }
}
