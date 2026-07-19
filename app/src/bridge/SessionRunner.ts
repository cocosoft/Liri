/**
 * 会话运行器
 *
 * 管理 Bridge 远程会话的创建、运行和销毁生命周期
 * 支持子进程 spawn、输出捕获、超时控制和清理
 *
 * 参考: cc_code/backend/bridge/sessionRunner.ts
 */

import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream, type WriteStream } from 'fs';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'bridge:SessionRunner',
  level: LogLevel.INFO,
});

export type SessionActivity = {
  type: string;
  command?: string;
  description?: string;
  toolName?: string;
  toolUseId?: string;
  timestamp: number;
};

export type SessionDoneStatus = {
  exitCode: number | null;
  error?: string;
  signal?: NodeJS.Signals | null;
};

export type SessionHandle = {
  sessionId: string;
  childProcess: ChildProcess | null;
  startTime: number;
  status: 'running' | 'completed' | 'error' | 'killed';
  activities: SessionActivity[];
  doneStatus?: SessionDoneStatus;
  promise: Promise<SessionDoneStatus>;
};

export type SessionSpawnOpts = {
  execPath: string;
  scriptArgs: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
  sandbox?: boolean;
  debugFile?: string;
  permissionMode?: string;
  verbose?: boolean;
  onDebug?: (msg: string) => void;
  onActivity?: (sessionId: string, activity: SessionActivity) => void;
  signal?: AbortSignal;
};

const MAX_ACTIVITIES = 20;
const MAX_STDERR_LINES = 10;

export function safeFilenameId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

const TOOL_VERBS: Record<string, string> = {
  Read: 'Reading',
  Write: 'Writing',
  Edit: 'Editing',
  Bash: 'Running',
  Glob: 'Searching',
  Grep: 'Searching',
  WebFetch: 'Fetching',
  WebSearch: 'Searching',
  Task: 'Running task',
  Agent: 'Creating agent',
  TaskCreate: 'Creating task',
  Skill: 'Using skill',
};

function parseActivity(line: string): SessionActivity | null {
  try {
    const data = JSON.parse(line);
    if (!data || typeof data !== 'object' || !data.type) return null;

    return {
      type: data.type,
      command: typeof data.command === 'string' ? data.command : undefined,
      description:
        typeof data.description === 'string' ? data.description : undefined,
      toolName: typeof data.tool_name === 'string' ? data.tool_name : undefined,
      toolUseId:
        typeof data.tool_use_id === 'string' ? data.tool_use_id : undefined,
      timestamp:
        typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
    };
  } catch {
    return null;
  }
}

function formatActivityLog(activity: SessionActivity): string {
  const verb = activity.toolName
    ? TOOL_VERBS[activity.toolName] || 'Running'
    : 'Running';
  const detail =
    activity.command || activity.description || activity.toolName || 'task';
  return `${verb}: ${detail.slice(0, 80)}`;
}

/**
 * 创建并运行一个远程会话
 * @returns SessionHandle 用于监控和控制会话
 */
export function createSessionRunner(
  sessionId: string,
  opts: SessionSpawnOpts
): SessionHandle {
  const {
    execPath,
    scriptArgs,
    env,
    cwd,
    sandbox = false,
    debugFile,
    verbose = false,
    onDebug,
    onActivity,
    signal,
  } = opts;

  const startTime = Date.now();
  const activities: SessionActivity[] = [];
  let debugStream: WriteStream | null = null;

  if (debugFile) {
    const debugPath = debugFile.replace('{session}', safeFilenameId(sessionId));
    try {
      debugStream = createWriteStream(debugPath, { flags: 'a' });
    } catch (err) {
      // silently ignore debug file creation failures

      logger.debug('Operation skipped', {
        context: 'silently ignore debug file creation failures',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const args = [
    ...scriptArgs,
    '--session-id',
    sessionId,
    sandbox ? '--sandbox' : '',
    verbose ? '--verbose' : '',
  ].filter(Boolean);

  if (signal?.aborted) {
    return {
      sessionId,
      childProcess: null,
      startTime,
      status: 'killed',
      activities,
      promise: Promise.resolve({ exitCode: null, signal: 'SIGTERM' }),
    };
  }

  const child: ChildProcess = spawn(execPath, args, {
    env,
    cwd: cwd || process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const statusLines: string[] = [];
  let stderrLineCount = 0;

  child.stdout?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      const activity = parseActivity(line);
      if (activity) {
        if (activities.length < MAX_ACTIVITIES) {
          activities.push(activity);
        }
        onActivity?.(sessionId, activity);
        onDebug?.(`[session:${sessionId}] ${formatActivityLog(activity)}`);
      }
      debugStream?.write(`[OUT] ${line}\n`);
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      if (stderrLineCount < MAX_STDERR_LINES) {
        statusLines.push(line);
        stderrLineCount++;
      }
      debugStream?.write(`[ERR] ${line}\n`);
    }
  });

  signal?.addEventListener('abort', () => {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }, 5000);
  });

  const promise = new Promise<SessionDoneStatus>((resolve) => {
    child.on('exit', (code, sig) => {
      debugStream?.end();
      resolve({
        exitCode: code,
        signal: sig,
        error: statusLines.length > 0 ? statusLines.join('\n') : undefined,
      });
    });

    child.on('error', (err) => {
      debugStream?.end();
      resolve({
        exitCode: null,
        error: err.message,
      });
    });
  });

  return {
    sessionId,
    childProcess: child,
    startTime,
    status: 'running',
    activities,
    promise,
  };
}

/**
 * 获取会话的活动摘要
 */
export function getSessionActivitySummary(handle: SessionHandle): string {
  if (handle.activities.length === 0) {
    return 'No activity yet';
  }

  const recent = handle.activities.slice(-3);
  return recent.map(formatActivityLog).join(' | ');
}

/**
 * 终止会话
 */
export function killSession(handle: SessionHandle): void {
  if (handle.childProcess && handle.childProcess.exitCode === null) {
    handle.childProcess.kill('SIGTERM');
    setTimeout(() => {
      if (handle.childProcess && handle.childProcess.exitCode === null) {
        handle.childProcess.kill('SIGKILL');
      }
    }, 5000);
  }
}

/**
 * 等待会话完成
 */
export async function waitForSession(
  handle: SessionHandle
): Promise<SessionDoneStatus> {
  return handle.promise;
}
