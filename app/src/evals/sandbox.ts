// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 评测沙箱（D2 骨架）：隔离运行环境
 *
 * 隔离策略（关键设计，说明为什么这样做）：
 *   - `LIRI_HOME` + `LIRI_DATA_DIR` 指向**临时目录** → 所有写入（会话/记忆/日志/输出）都落在临时目录，**不碰真实用户数据**；
 *   - 但隔离 HOME 里没有模型/供应商配置 → 无法真正跑 Agent。因此用 **`VACUUM INTO` 把真实 app.db 快照**到临时数据目录
 *     （只读真实库、只写快照文件），这样既有真实模型配置，又零风险；
 *   - 后端以 `daemon` 模式独立进程启动（独立端口），评测结束后关闭。
 *
 * 注意：DAEMON 会把进程 cwd 设为**项目根**，与评测工作区（`workspace`）不是同一处 ——
 * 因此任务提示词必须使用工作区的绝对路径（见 `types.ts` 的 `prompt` 说明）。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  chmodSync,
} from 'node:fs';
import { copyFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface EvalSandbox {
  /** 临时根（本次评测全部产物） */
  root: string;
  /** 隔离的第三层（LIRI_HOME） */
  home: string;
  /** 隔离的第二层数据目录（LIRI_DATA_DIR，含 DB 快照） */
  dataDir: string;
  /** 评测工作区（任务读写都在这里） */
  workspace: string;
  port: number;
  baseUrl: string;
  /** 后端日志文件（启动失败时用于定位） */
  logFile: string;
  /** 是否带入了真实凭据文件（决定能否真正调用模型） */
  hasCredentials: boolean;
  stop: () => Promise<void>;
}

/** 取一个空闲端口（向系统申请 port 0 后立即释放） */
async function pickFreePort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close(() => {
        if (port) resolvePort(port);
        else reject(new Error('无法获取空闲端口'));
      });
    });
  });
}

/**
 * 快照真实 DB 到目标路径
 *
 * 实现说明：这里刻意**不使用 `bun:sqlite` 的 `VACUUM INTO`** —— 该项目 tsconfig 未纳入 bun 类型，
 * 本地补声明会与既有 `bun:sqlite` 使用者（如 `src/tools/VideoGenerateTool/*`）的类型合并冲突。
 * 改为拷贝 **db + `-wal` + `-shm` 三件套**：SQLite 会把它们视为一致集合（WAL 会被重放），
 * 因此快照可用；最坏情况是丢掉尚未 checkpoint 的极新事务，对本用途（提供模型/供应商配置）无影响。
 */
function snapshotDb(realDbPath: string, targetPath: string): string {
  if (!existsSync(realDbPath)) {
    throw new Error(
      `未找到真实数据库：${realDbPath}（无法在沙箱中提供模型/供应商配置）`
    );
  }
  copyFileSync(realDbPath, targetPath);
  let sidecars = 0;
  for (const suffix of ['-wal', '-shm']) {
    const side = `${realDbPath}${suffix}`;
    if (existsSync(side)) {
      copyFileSync(side, `${targetPath}${suffix}`);
      sidecars++;
    }
  }
  return `copy(db+${sidecars} sidecar)`;
}

/** 等待 /health 就绪 */
async function waitForHealth(
  baseUrl: string,
  child: ChildProcess,
  spawnErrorRef: { current?: Error },
  timeoutMs = 150_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawnErrorRef.current) {
      throw new Error(`启动后端进程失败：${spawnErrorRef.current.message}`);
    }
    if (child.exitCode !== null) {
      throw new Error(`后端进程提前退出（exitCode=${child.exitCode}）`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body.status === 'ok') return;
      }
    } catch {
      // @ignore-catch: 启动过程中连接被拒是预期状态，继续轮询
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`等待后端就绪超时（${timeoutMs}ms）`);
}

/**
 * 建立评测沙箱：临时目录 + DB 快照 + 独立后端进程
 */
export async function createSandbox(opts: {
  repoRoot: string;
  realDbPath: string;
  /** 真实 pyapp 根（用于带入凭据文件） */
  realHome: string;
}): Promise<EvalSandbox> {
  const root = mkdtempSync(join(tmpdir(), 'liri-eval-'));
  const home = join(root, 'home');
  const dataDir = join(root, 'data');
  const workspace = join(root, 'workspace');
  for (const dir of [home, dataDir, workspace])
    mkdirSync(dir, { recursive: true });

  const dbTarget = join(dataDir, 'app.db');
  const dbMode = snapshotDb(opts.realDbPath, dbTarget);

  // 模型密钥不在 DB（DB 只存 `__stored__` 哨兵），真实凭据在 `<LIRI_HOME>/credentials.json`。
  // 隔离 HOME 若不带它 → 模型调用必然 401。故把它复制进来（JSON 本身已是明文存储），
  // 并收紧权限；沙箱默认在评测结束后删除（见 cli 的 --keep）。
  const credSrc = join(opts.realHome, 'credentials.json');
  let hasCredentials = false;
  if (existsSync(credSrc)) {
    const credDst = join(home, 'credentials.json');
    copyFileSync(credSrc, credDst);
    try {
      chmodSync(credDst, 0o600);
    } catch {
      // @ignore-catch: Windows 下 chmod 可能无效，不影响功能
    }
    hasCredentials = true;
  }

  const port = await pickFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logFile = join(root, 'daemon.log');
  const logStream = createWriteStream(logFile, { flags: 'a' });
  logStream.write(`[sandbox] root=${root}\n[sandbox] db 快照方式=${dbMode}\n`);

  // 用当前运行时自身的可执行文件启动子进程：Windows 下 `spawn('bun')` 会 ENOENT
  const runtimeBin = process.execPath;
  logStream.write(`[sandbox] runtime=${runtimeBin}\n`);

  const spawnErrorRef: { current?: Error } = {};
  const child = spawn(
    runtimeBin,
    ['run', 'src/main.ts', 'daemon', `--http-port=${port}`],
    {
      cwd: join(opts.repoRoot, 'app'),
      env: {
        ...process.env,
        LIRI_HOME: home,
        LIRI_DATA_DIR: dataDir,
        LIRI_PROJECT_DIR: opts.repoRoot,
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  child.on('error', (err) => {
    spawnErrorRef.current = err;
    logStream.write(`[sandbox] spawn error: ${err.message}\n`);
  });
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  const stop = async (): Promise<void> => {
    if (child.exitCode === null && child.pid) {
      child.kill();
      // Windows 下子进程可能仍存活 → 强制清理进程树
      if (process.platform === 'win32') {
        try {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
          });
        } catch {
          // @ignore-catch: 进程已退出时 taskkill 失败无影响
        }
      }
    }
    logStream.end();
  };

  try {
    await waitForHealth(baseUrl, child, spawnErrorRef);
  } catch (err) {
    await stop();
    throw new Error(
      `${String(err)}；后端日志见 ${logFile}（末 20 行需自行查看）`
    );
  }

  return {
    root,
    home,
    dataDir,
    workspace,
    port,
    baseUrl,
    logFile,
    hasCredentials,
    stop,
  };
}
