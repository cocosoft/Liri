//
/**
 * 脚本类型Hook执行器
 * 负责执行用户自定义脚本类型的Hook
 * 支持 shell、node、python 三种脚本类型
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import {
  IndividualHookConfig,
  HookExecutionResult,
  HookExecutionContext,
} from '../types';

const execPromise = promisify(exec);

/**
 * 脚本类型
 */
export type ScriptType = 'shell' | 'node' | 'python';

/**
 * 脚本Hook配置接口
 */
export interface ScriptHookConfig {
  /**
   * 脚本类型（默认 shell）
   */
  interpreter?: ScriptType;

  /**
   * 内联脚本内容（与 scriptFile 二选一）
   */
  script?: string;

  /**
   * 脚本文件路径（与 script 二选一）
   */
  scriptFile?: string;

  /**
   * 超时时间（秒，默认 30）
   */
  timeout?: number;

  /**
   * 自定义环境变量
   */
  env?: Record<string, string>;

  /**
   * 启用沙箱模式（默认 true）
   */
  sandbox?: boolean;

  /**
   * 是否允许脚本修改环境变量（默认 false）
   */
  allowEnvModification?: boolean;

  /**
   * 工作目录
   */
  cwd?: string;
}

/**
 * 危险命令模式列表（沙箱模式下拦截）
 */
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+\/\s*$/,
  /\brm\s+-rf\s+\/\*+/,
  /\bmkfs\./,
  /\bdd\s+if=/,
  /\b:\(\)\{\s*\|:\s*&\};:/,
  /\b>\s*\/dev\/sda/,
  /\bchmod\s+-R\s+777\s+\//,
];

/**
 * 脚本Hook执行器
 */
export class ScriptHookExecutor {
  /**
   * 执行脚本类型Hook
   * @param hook Hook配置
   * @param context 执行上下文
   * @returns 执行结果
   */
  public async execute(
    hook: IndividualHookConfig,
    context: HookExecutionContext
  ): Promise<HookExecutionResult> {
    const scriptConfig = this.resolveScriptConfig(hook.config);
    const validationError = this.validateScriptConfig(scriptConfig);
    if (validationError) {
      return { success: false, error: validationError };
    }

    const tempFile =
      scriptConfig.script && !scriptConfig.scriptFile
        ? await this.createTempScript(
            scriptConfig.script,
            scriptConfig.interpreter
          )
        : null;

    try {
      const command = this.buildCommand(scriptConfig, tempFile);

      const env = this.buildEnvironment(scriptConfig, context);

      const { stdout, stderr } = await execPromise(command, {
        env,
        shell: true as any,
        timeout: (scriptConfig.timeout || 30) * 1000,
        cwd: scriptConfig.cwd || context.workingDirectory,
      });

      let result: HookExecutionResult = {
        success: true,
        output: stdout.trim(),
        error: stderr.trim(),
        exitCode: 0,
      };

      try {
        const parsed = JSON.parse(stdout.trim());
        result = this.processScriptJsonOutput(parsed, result);
      } catch {
        // not valid JSON, keep as-is
      }

      return result;
    } catch (error: any) {
      return {
        success: false,
        output: error.stdout?.trim(),
        error: error.stderr?.trim() || error.message,
        exitCode: error.code || 1,
      };
    } finally {
      if (tempFile) {
        unlink(tempFile).catch(() => {});
      }
    }
  }

  /**
   * 解析脚本配置
   */
  private resolveScriptConfig(
    config: Record<string, unknown>
  ): ScriptHookConfig {
    return {
      interpreter:
        (config.interpreter as ScriptType) ||
        (config.scriptType as ScriptType) ||
        'shell',
      script: config.script as string,
      scriptFile: config.scriptFile as string,
      timeout: (config.timeout as number) ?? 30,
      env: config.env as Record<string, string> | undefined,
      sandbox: config.sandbox !== false,
      allowEnvModification: config.allowEnvModification === true,
      cwd: config.cwd as string,
    };
  }

  /**
   * 验证脚本配置
   */
  private validateScriptConfig(config: ScriptHookConfig): string | null {
    if (!config.script && !config.scriptFile) {
      return 'Script content or scriptFile path is required';
    }

    const validInterpreters: ScriptType[] = ['shell', 'node', 'python'];
    if (!validInterpreters.includes(config.interpreter!)) {
      return `Invalid interpreter: ${config.interpreter}. Must be one of: ${validInterpreters.join(', ')}`;
    }

    if (config.sandbox && config.script) {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(config.script)) {
          return `Sandbox blocked dangerous command pattern: ${pattern.source}`;
        }
      }
    }

    return null;
  }

  /**
   * 构建执行命令
   */
  private buildCommand(
    config: ScriptHookConfig,
    tempFile: string | null
  ): string {
    if (config.scriptFile) {
      switch (config.interpreter) {
        case 'node':
          return `node "${config.scriptFile}"`;
        case 'python':
          return `python "${config.scriptFile}"`;
        case 'shell':
        default:
          return `sh "${config.scriptFile}"`;
      }
    }

    if (tempFile) {
      switch (config.interpreter) {
        case 'node':
          return `node "${tempFile}"`;
        case 'python':
          return `python "${tempFile}"`;
        case 'shell':
        default:
          return `sh "${tempFile}"`;
      }
    }

    // fallback: execute inline command
    return config.script || '';
  }

  /**
   * 构建环境变量
   */
  private buildEnvironment(
    config: ScriptHookConfig,
    context: HookExecutionContext
  ): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {
      ...process.env,
      SCRIPT_INTERPRETER: config.interpreter,
      HOOK_EVENT: context.event,
      HOOK_MATCHER: context.matcher || '',
      HOOK_INPUT: JSON.stringify(context.data || {}),
      HOOK_SESSION_ID: context.sessionId || '',
      HOOK_USER_ID: context.userId || '',
    };

    if (context.workingDirectory) {
      env.HOOK_WORKING_DIR = context.workingDirectory;
    }

    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        env[key] = value;
      }
    }

    if (config.sandbox) {
      delete env.SSH_AUTH_SOCK;
      delete env.AWS_SECRET_ACCESS_KEY;
      delete env.AWS_ACCESS_KEY_ID;
      delete env.AWS_SESSION_TOKEN;
    }

    return env;
  }

  /**
   * 创建临时脚本文件
   */
  private async createTempScript(
    script: string,
    interpreter?: string
  ): Promise<string> {
    const ext = this.getScriptExtension(interpreter);
    const fileName = `hook-script-${randomUUID().slice(0, 8)}${ext}`;
    const filePath = join(tmpdir(), fileName);
    await writeFile(filePath, script, 'utf-8');
    return filePath;
  }

  /**
   * 获取脚本文件扩展名
   */
  private getScriptExtension(interpreter?: string): string {
    switch (interpreter) {
      case 'node':
        return '.js';
      case 'python':
        return '.py';
      case 'shell':
      default:
        return '.sh';
    }
  }

  /**
   * 处理脚本JSON输出
   */
  private processScriptJsonOutput(
    json: Record<string, unknown>,
    result: HookExecutionResult
  ): HookExecutionResult {
    const processed: HookExecutionResult = {
      ...result,
      success: true,
      hookSpecificOutput: json,
    };

    if (json.continue !== undefined)
      processed.continue = json.continue as boolean;
    if (json.suppressOutput !== undefined)
      processed.suppressOutput = json.suppressOutput as boolean;
    if (json.stopReason !== undefined)
      processed.stopReason = json.stopReason as string;
    if (json.decision !== undefined)
      processed.decision = json.decision as string;
    if (json.systemMessage !== undefined)
      processed.systemMessage = json.systemMessage as string;

    if (json.hookSpecificOutput) {
      const hso = json.hookSpecificOutput as Record<string, unknown>;
      if (hso.additionalContext !== undefined)
        processed.additionalContext = hso.additionalContext as string;
      if (hso.updatedInput !== undefined)
        processed.updatedInput = hso.updatedInput as Record<string, unknown>;
      if (hso.updatedMCPToolOutput !== undefined)
        processed.updatedMCPToolOutput = hso.updatedMCPToolOutput as string;
      if (hso.initialUserMessage !== undefined)
        processed.initialUserMessage = hso.initialUserMessage as string;
      if (hso.watchPaths !== undefined)
        processed.watchPaths = hso.watchPaths as string[];
      if (hso.retry !== undefined) processed.retry = hso.retry as number;
      if (hso.permissionDecision !== undefined)
        processed.permissionBehavior = hso.permissionDecision as
          | 'allow'
          | 'deny'
          | 'ask';
      if (hso.permissionDecisionReason !== undefined)
        processed.hookPermissionDecisionReason =
          hso.permissionDecisionReason as string;
    }

    return processed;
  }
}
