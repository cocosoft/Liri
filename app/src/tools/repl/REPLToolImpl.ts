/**
 * REPL工具实现
 */

import { spawn, ChildProcess } from 'child_process';
import {
  REPLTool,
  REPLSession,
  REPLResult,
  REPLOptions,
  REPLExecution,
  REPLSessionStatus,
} from './types/REPLTool.js';
import { replSessionManager } from './REPLSessionManager';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools\repl\REPLToolImpl',
  level: LogLevel.INFO,
});

/**
 * REPL工具实现
 */
export class REPLToolImpl implements REPLTool {
  private sessions: Map<string, REPLSession> = new Map();

  /**
   * 启动REPL
   */
  async startREPL(
    language: string,
    options: REPLOptions = {}
  ): Promise<REPLSession> {
    const session = replSessionManager.createSession(language, options);

    try {
      const { process, stdin, stdout, stderr } = this.spawnREPL(
        language,
        options
      );

      session.process = process;
      session.stdin = stdin;
      session.stdout = stdout;
      session.stderr = stderr;

      session.setStatus(REPLSessionStatus.RUNNING);
      this.sessions.set(session.id, session);

      return session;
    } catch (error) {
      session.setStatus(REPLSessionStatus.ERROR);
      throw error;
    }
  }

  /**
   * 执行代码
   */
  async executeCode(session: REPLSession, code: string): Promise<REPLResult> {
    if (session.status !== REPLSessionStatus.RUNNING) {
      throw new AppError(
        'REPL session is not running',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const startTime = Date.now();
    const process = session.process;
    const stdin = session.stdin;
    const stdout = session.stdout;
    const stderr = session.stderr;

    if (!process || !stdin || !stdout || !stderr) {
      throw new AppError(
        'REPL session is not properly initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return new Promise((resolve) => {
      let output = '';
      let errorOutput = '';
      let timeoutId: NodeJS.Timeout;

      const handleTimeout = () => {
        process.kill();
        session.setStatus(REPLSessionStatus.STOPPED);
        resolve({
          success: false,
          output: '',
          error: 'Execution timed out',
          executionTime: Date.now() - startTime,
        });
      };

      if (session.options.timeout) {
        timeoutId = setTimeout(handleTimeout, session.options.timeout);
      }

      const handleStdout = (data: Buffer) => {
        output += data.toString();
      };

      const handleStderr = (data: Buffer) => {
        errorOutput += data.toString();
      };

      const handleExit = (code: number | null) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        stdout.removeListener('data', handleStdout);
        stderr.removeListener('data', handleStderr);
        process.removeListener('exit', handleExit);

        const success = code === 0 && errorOutput === '';
        const result: REPLResult = {
          success,
          output: output.trim(),
          error: errorOutput.trim() || undefined,
          executionTime: Date.now() - startTime,
          exitCode: code ?? undefined,
        };

        // 添加执行记录
        const execution: REPLExecution = {
          id: `exec-${Date.now()}`,
          code,
          result,
          timestamp: new Date(),
        };
        session.addExecution(execution);

        resolve(result);
      };

      stdout.on('data', handleStdout);
      stderr.on('data', handleStderr);
      process.on('exit', handleExit);

      // 发送代码
      stdin.write(code + '\n');
      stdin.write('\n'); // 额外的换行以确保执行
    });
  }

  /**
   * 停止REPL
   */
  async stopREPL(session: REPLSession): Promise<void> {
    const process = session.process;
    if (process) {
      process.kill();
    }
    session.setStatus(REPLSessionStatus.STOPPED);
    this.sessions.delete(session.id);
    replSessionManager.removeSession(session.id);
  }

  /**
   * 获取支持的语言
   */
  getSupportedLanguages(): string[] {
    return ['python', 'javascript', 'typescript', 'bash', 'powershell'];
  }

  /**
   * 获取所有会话
   */
  getSessions(): REPLSession[] {
    return replSessionManager.getSessions();
  }

  /**
   * 清理所有会话
   */
  async clearSessions(): Promise<void> {
    const sessions = this.getSessions();
    for (const session of sessions) {
      if (session.status === REPLSessionStatus.RUNNING) {
        await this.stopREPL(session);
      }
    }
    replSessionManager.clearSessions();
  }

  /**
   * 启动REPL进程
   */
  private spawnREPL(language: string, options: REPLOptions) {
    let command: string;
    let args: string[] = [];

    switch (language.toLowerCase()) {
      case 'python':
        command = 'python';
        args = ['-i'];
        break;
      case 'javascript':
        command = 'node';
        args = ['-i'];
        break;
      case 'typescript':
        command = 'npx';
        args = ['ts-node', '-i'];
        break;
      case 'bash':
        command = 'bash';
        args = ['-i'];
        break;
      case 'powershell':
        command = 'powershell';
        args = ['-NoExit', '-Command', 'Write-Host "PowerShell REPL started"'];
        break;
      default:
        throw new AppError(
          `Unsupported language: ${language}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
    }

    if (options.extraArgs) {
      args = [...args, ...options.extraArgs];
    }

    const childProcess = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    return {
      process: childProcess,
      stdin: childProcess.stdin,
      stdout: childProcess.stdout,
      stderr: childProcess.stderr,
    };
  }
}
