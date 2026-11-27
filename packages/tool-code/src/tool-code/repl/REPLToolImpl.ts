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
// SG-1（2026-11-27）：REPL 执行面接入平台写隔离（Linux Landlock / macOS Seatbelt / Windows Low IL）
import {
  assertReplSandboxPlanUsable,
  logReplSandboxPlan,
  planReplSandboxSpawn,
} from './replSandboxSpawn';
import type { ReplSandboxPlan } from './replSandboxSpawn';
// 2026-11-27：REPL 子进程登记进 ProcessRegistry（与 bash / code_run 同口径的可观测性）
import {
  CHILD_PROCESS_ERROR_EVENT,
  PROCESS_STATUS,
  processRegistry,
} from '@modules/sandbox';
// G1（2026-11-03）：spawn 前 cwd 判定
import { describeUnusableSpawnCwd } from '@openliri/infra/utils/cwd';
import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';

import { getLogger } from '@openliri/infra/monitoring';
const logger = getLogger('tools:repl:REPLToolImpl');

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
      // G1（2026-11-03）：显式 cwd 无效 ⇒ 在 spawn 前抛出可操作错误
      const cwdError = describeUnusableSpawnCwd(options.cwd, 'REPL 工作目录');
      if (cwdError) {
        throw new AppError(
          cwdError,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const { command, args } = resolveReplCommand(language, options);
      const cwd = options.cwd || process.cwd();
      const env = {
        ...process.env,
        ...options.env,
      };

      // SG-1：按平台计算 spawn 形态（能力不可用 ⇒ 降级并告警 / failClosed ⇒ 拒绝启动）
      const plan = await planReplSandboxSpawn({ command, args, cwd, env });
      assertReplSandboxPlanUsable(plan);
      logReplSandboxPlan(plan);

      const spawned = this.spawnREPL(plan, cwd);

      session.process = spawned.process;
      session.stdin = spawned.stdin;
      session.stdout = spawned.stdout;
      session.stderr = spawned.stderr;
      attachReplSandboxRelease(session, plan);
      registerReplProcess(session, spawned.process, plan);

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
        // 超时会 kill 子进程 ⇒ 观测面记 `timed_out`（与 bash / code_run 同词汇）
        completeReplProcess(session, PROCESS_STATUS.timedOut);
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
    // 观测面：主动停止 ⇒ `killed`（自然退出走 `exit` 监听，见 `registerReplProcess`）
    completeReplProcess(session, PROCESS_STATUS.killed);
    // SG-1：Windows Low IL 的会话级授权必须在进程结束后恢复（幂等；exit 事件可能已先触发）
    const release = session.sandbox?.release;
    const sandboxMode = session.sandbox?.mode;
    if (release) {
      session.sandbox = sandboxMode ? { mode: sandboxMode } : undefined;
      await release();
    }
    session.setStatus(REPLSessionStatus.STOPPED);
    this.sessions.delete(session.id);
    replSessionManager.removeSession(session.id);
  }

  /**
   * 2026-11-27：回收**闲置超时**的 REPL 会话（治"只合并/只删登记、不杀进程"）。
   *
   * 与 `replSessionManager.collectExpiredSessions`（纯查询）配合：查询 → 逐个 `stopREPL`
   * ⇒ 子进程被 kill、`ProcessRegistry` 收敛终态、Windows 会话级授权被释放。
   *
   * @returns 实际回收的会话数
   */
  async reclaimIdleSessions(timeoutMs: number): Promise<number> {
    const expired = replSessionManager.collectExpiredSessions(timeoutMs);
    for (const session of expired) {
      await this.stopREPL(session);
    }
    return expired.length;
  }

  /**
   * 获取支持的语言
   */
  getSupportedLanguages(): string[] {
    // 2026-11-27：移除 `typescript` —— 真机实测 ts-node 的交互式 REPL 在管道 stdio 下
    // 不执行（见 `resolveReplCommand` 的说明），留一个"起得来但永远无响应"的档位只会误导调用方。
    return ['python', 'javascript', 'bash', 'powershell'];
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
   *
   * SG-1（2026-11-27）：`plan` 的 `command`/`args`/`env` 已按平台沙箱改写
   * （helper / sandbox-exec 包裹），但 stdio 仍是三条 pipe（被包裹的解释器继承），
   * 因此交互与跨执行状态保持不变。
   */
  private spawnREPL(plan: ReplSandboxPlan, cwd: string) {
    const childProcess = spawn(plan.command, plan.args, {
      cwd,
      env: plan.env,
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
 * 语言 ⇒ 解释器命令/参数（原 `spawnREPL` 内的 switch，SG-1 起外移以便先算沙箱形态）。
 */
function resolveReplCommand(
  language: string,
  options: REPLOptions
): { command: string; args: string[] } {
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
      // 2026-11-27（真机取证，见治理计划 SG-7 ④）：`npx ts-node -i` 的 REPL 依赖 TTY
      // （`ts-node/dist/repl.js` 里 `terminal: stdout.isTTY`）⇒ 在**管道 stdio** 下只回显
      // `> | | ` 而**永不执行**，每次 `executeCode` 只会等满超时。与其留一个假可用档位，
      // 改为明确拒绝并给出可走的路。
      throw new AppError(
        'TypeScript REPL 不可用：ts-node 的交互式 REPL 在管道 stdio 下不执行（已实测）。' +
          '请改用 language="javascript"（Node REPL），或把 TS 代码写入 .ts 文件后用 bash 运行 `npx ts-node <file>`。',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
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

  return { command, args };
}

/**
 * SG-1：把会话与"沙箱授权释放"绑定。
 *
 * - 进程自行退出（用户代码 `exit()` / 崩溃 / 超时被 kill）⇒ 立即释放，
 *   否则 Windows 的可写目录会一直停在 Low 完整性标签上；
 * - `stopREPL` 也会调用同一个函数 ⇒ 用一次性包装去重（release 必须只生效一次，
 *   引用计数由 `beginWindowsBashGrants` 维护，重复调用会把计数打穿）。
 */
export function attachReplSandboxRelease(
  session: Pick<REPLSession, 'process' | 'sandbox'>,
  plan: ReplSandboxPlan
): void {
  const mode = plan.mode === 'refuse' ? 'none' : plan.mode;
  if (!plan.release) {
    session.sandbox = { mode };
    return;
  }
  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    await plan.release?.();
  };
  session.sandbox = { mode, release };
  session.process?.once('exit', () => {
    void release();
  });
}

/**
 * 2026-11-27：把 REPL 子进程登记进 `ProcessRegistry`（观测面）。
 *
 * 与 bash（S7）/ `code_run` 同口径：`/v1/sandbox/status` 的 `processStats` 里能看到
 * **有沙箱包裹的 REPL 进程**（此前 REPL 完全不在观测面内）。
 *
 * 终态收敛：自然退出 ⇒ `completed`（带退出码）；spawn 失败 ⇒ `error`；
 * 主动停止 / 超时由 `stopREPL` / `handleTimeout` 先收敛为 `killed` / `timed_out`。
 */
export function registerReplProcess(
  session: Pick<REPLSession, 'processEntryId' | 'language'>,
  child: ChildProcess,
  plan: ReplSandboxPlan
): void {
  if (child.pid === undefined) return;
  session.processEntryId = processRegistry.register({
    pid: child.pid,
    command: `repl:${session.language}`,
    status: PROCESS_STATUS.running,
    metadata: {
      source: 'repl',
      language: session.language,
      mode: plan.mode,
    },
  });
  child.once('exit', (code) => {
    completeReplProcess(session, PROCESS_STATUS.completed, code ?? undefined);
  });
  child.once(CHILD_PROCESS_ERROR_EVENT, () => {
    completeReplProcess(session, PROCESS_STATUS.error);
  });
}

/**
 * 收敛登记项终态（幂等：成功后清空 `processEntryId`，后续事件/调用都是 no-op）。
 */
export function completeReplProcess(
  session: Pick<REPLSession, 'processEntryId'>,
  status: Parameters<typeof processRegistry.complete>[1],
  exitCode?: number
): void {
  const entryId = session.processEntryId;
  if (!entryId) return;
  session.processEntryId = undefined;
  processRegistry.complete(entryId, status, exitCode);
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
