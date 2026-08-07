/**
 * REPL工具实现
 */

import { spawn, ChildProcess } from 'child_process';
import { REPLSessionStatus } from './types/REPLTool.js';
import type {
  REPLTool,
  REPLSession,
  REPLResult,
  REPLOptions,
  REPLExecution,
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
      let timeoutId: NodeJS.Timeout | undefined;
      let settled = false;
      // 本次执行开始时已累计的 stderr 基线。
      // 交互式 REPL 的 stderr 可能有启动横幅等常驻噪声，错误判定只统计本次执行增量。
      const stderrBase = errorOutput.length;

      // P3-1 根因修复：交互式 REPL（python -i / node -i 等）执行代码后进程不退出，
      // 仅依赖 exit/timeout 会导致每次执行都要等满超时且已收集的输出被丢弃。
      // 改为「完成标记协议」：代码后追加语言对应的标记输出命令，stdout 检测到标记即视为
      // 执行完成并保留会话（不杀进程），exit/timeout 仅作兜底。
      const marker = `__PYAPP_REPL_DONE_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}__`;
      const markerCmd = getMarkerCommand(session.language, marker);

      const finish = (result: REPLResult) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        resolve(result);
      };

      const handleTimeout = () => {
        process.kill();
        session.setStatus(REPLSessionStatus.STOPPED);
        finish({
          success: false,
          output: '',
          error: 'Execution timed out',
          executionTime: Date.now() - startTime,
        });
      };

      // 错误 traceback 与 stdout 的 marker 走不同管道，到达顺序无保证。
      // 用「静默重置」代替固定延时：stderr 有新数据就重置 200ms 计时，
      // 直到 200ms 无新数据才判定完成，避免慢调度下丢 error。
      let markerDetected = false;
      let settleTimer: ReturnType<typeof setTimeout> | undefined;
      const buildAndFinish = () => {
        const newStderr = errorOutput.slice(stderrBase);
        const execution: REPLExecution = {
          id: `exec-${Date.now()}`,
          code,
          result: {
            success: newStderr.trim() === '',
            output: output.trim(),
            error: newStderr.trim() || undefined,
            executionTime: Date.now() - startTime,
          },
          timestamp: new Date(),
        };
        session.addExecution(execution);
        finish(execution.result);
      };
      const scheduleSettleFinish = () => {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          buildAndFinish();
        }, 200);
      };

      const handleStderr = (data: Buffer) => {
        errorOutput += data.toString();
        if (markerDetected) scheduleSettleFinish();
      };

      const handleStdout = (data: Buffer) => {
        output += data.toString();
        // 检测完成标记（随机 marker 避免与用户输出碰撞）
        if (output.includes(marker)) {
          if (timeoutId) clearTimeout(timeoutId);
          stdout.removeListener('data', handleStdout);
          process.removeListener('exit', handleExit);
          // 移除标记行
          output = output.replace(new RegExp(`.*${marker}\\r?\\n?`), '');
          markerDetected = true;
          scheduleSettleFinish();
          // 兜底：stderr 持续输出时（如死循环日志）不能无限等，2s 后强制收尾
          setTimeout(() => {
            if (!settled) buildAndFinish();
          }, 2000);
        }
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

      // P2-14 修复：无条件设置超时（默认 60s）。
      // python -i 交互 REPL 执行完代码不会退出进程，若仅依赖 process exit 触发 resolve，
      // Promise 将永久挂起（无 timeout 配置时），导致 executeTool → streamMessage 会话锁泄漏。
      const timeoutMs = session.options.timeout ?? 60_000;
      timeoutId = setTimeout(handleTimeout, timeoutMs);

      stdout.on('data', handleStdout);
      stderr.on('data', handleStderr);
      process.on('exit', handleExit);

      // 发送代码
      stdin.write(code + '\n');
      // 追加完成标记命令（语言不支持时跳过，退回 exit/timeout 兜底）
      if (markerCmd) {
        stdin.write(markerCmd + '\n');
      }
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
        // -q 关闭启动横幅；sys.ps1/ps2 清空交互提示符。
        // 管道模式下（非 tty）CPython 将提示符输出到 stderr，会污染执行结果的错误判定。
        args = ['-i', '-q', '-c', 'import sys; sys.ps1=""; sys.ps2="";'];
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

/**
 * 生成语言对应的完成标记命令。
 * 交互式 REPL（python -i / node -i 等）执行代码后进程不退出，
 * 通过追加该命令让 stdout 输出唯一 marker，检测到即视为执行完成。
 * 语言不支持时返回空字符串，调用方跳过标记协议退回 exit/timeout 兜底。
 */
function getMarkerCommand(language: string, marker: string): string {
  switch (language.toLowerCase()) {
    case 'python':
      return `print("${marker}")`;
    case 'javascript':
    case 'typescript':
      return `console.log("${marker}")`;
    case 'bash':
      return `echo ${marker}`;
    case 'powershell':
      return `Write-Output "${marker}"`;
    default:
      return '';
  }
}
