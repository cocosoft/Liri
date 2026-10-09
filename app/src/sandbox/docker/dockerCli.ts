/**
 * Docker CLI **异步**执行器（B3-a 抽出 / **B4 扩展：携带真实退出码**）
 *
 * **两条契约**：
 * 1. **不得同步阻塞**：实现内禁止 `execSync`（B3-a：daemon 内同步阻塞会让全部 HTTP/SSE 停摆）；
 * 2. **必须带出真实退出码** `code`（B4：退出码/输出是判断执行结果的原生信号，不能靠"没抛异常"
 *    推断成功 —— 旧实现正是把 `success: true, exitCode: 0` 写死在 try 分支）。
 *
 * 失败（未取到码：spawn 失败 / 被杀 / 超时）时 `code === null`，同时给 `error` 便于归因；
 * **不抛异常**，由调用方按需判定。
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface DockerCliResult {
  /** 子进程**真实退出码**；未取到时为 `null`（spawn 失败 / 被杀 / 超时） */
  code: number | null;
  stdout: string;
  stderr: string;
  /** = `code === 0`（便捷判定；**不得**据此推断"命令成功执行"以外的语义） */
  ok: boolean;
  /** 是否因超时被杀 */
  timedOut: boolean;
  error?: Error;
}

export interface DockerCliOptions {
  timeoutMs?: number;
  maxBuffer?: number;
  cwd?: string;
}

/**
 * Docker CLI 执行器（**必须异步**）。
 *
 * 调用方传的是**不含 `docker` 本身的参数数组**（如 `['exec','cid','sh','-c','ls']`）⇒
 * 不经宿主 shell，参数不会被二次解释（旧实现把所有参数 `join(' ')` 后再交给 shell）。
 */
export type DockerCliRunner = (
  args: string[],
  options?: DockerCliOptions
) => Promise<DockerCliResult>;

/** 默认执行器：异步 `execFile`（B3-a/B4：绝不用 `execSync`，且**保留退出码**） */
export const defaultDockerCliRunner: DockerCliRunner = async (
  args,
  options
) => {
  try {
    const { stdout, stderr } = await execFileAsync('docker', args, {
      timeout: options?.timeoutMs ?? 30_000,
      maxBuffer: options?.maxBuffer ?? 8 * 1024 * 1024,
      cwd: options?.cwd,
      encoding: 'utf-8',
      windowsHide: true,
    });
    return {
      code: 0,
      stdout: String(stdout),
      stderr: String(stderr),
      ok: true,
      timedOut: false,
    };
  } catch (error) {
    const e = error as {
      code?: number | string;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    // Node 在非 0 退出时把**退出码**放在 `code`（数字）；ENOENT 等系统错误时 `code` 是字符串
    const code = typeof e.code === 'number' ? e.code : null;
    return {
      code,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? String(error),
      ok: code === 0,
      timedOut: !!e.killed,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
};
