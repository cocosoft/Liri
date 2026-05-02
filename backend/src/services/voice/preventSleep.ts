/**
 * 防止系统休眠
 * 在语音录制期间阻止系统进入休眠状态
 *
 * 基于CC源码 cc_code/backend/services/preventSleep.ts 实现
 */

import { spawn } from 'child_process';

const CAFFEINATE_TIMEOUT_SECONDS = 300;
const RESTART_INTERVAL_MS = 4 * 60 * 1000;

let caffeinateProcess: ReturnType<typeof spawn> | null = null;
let restartInterval: ReturnType<typeof setInterval> | null = null;
let refCount = 0;

/**
 * 增加引用计数并开始防止休眠
 */
export function startPreventSleep(): void {
  refCount++;

  if (refCount === 1) {
    spawnCaffeinate();
    startRestartInterval();
  }
}

/**
 * 减少引用计数并允许休眠
 */
export function stopPreventSleep(): void {
  if (refCount > 0) {
    refCount--;
  }

  if (refCount === 0) {
    stopRestartInterval();
    killCaffeinate();
  }
}

/**
 * 强制停止防止休眠
 */
export function forceStopPreventSleep(): void {
  refCount = 0;
  stopRestartInterval();
  killCaffeinate();
}

function startRestartInterval(): void {
  if (process.platform !== 'darwin') {
    return;
  }

  if (restartInterval !== null) {
    return;
  }

  restartInterval = setInterval(() => {
    if (refCount > 0) {
      killCaffeinate();
      spawnCaffeinate();
    }
  }, RESTART_INTERVAL_MS);

  restartInterval.unref();
}

function stopRestartInterval(): void {
  if (restartInterval !== null) {
    clearInterval(restartInterval);
    restartInterval = null;
  }
}

function spawnCaffeinate(): void {
  if (process.platform !== 'darwin') {
    return;
  }

  try {
    caffeinateProcess = spawn('caffeinate', [
      '-dim',
      '-t',
      String(CAFFEINATE_TIMEOUT_SECONDS),
    ], {
      stdio: 'ignore',
    });

    caffeinateProcess.unref();

    caffeinateProcess.on('error', () => {
      caffeinateProcess = null;
    });
  } catch {
    caffeinateProcess = null;
  }
}

function killCaffeinate(): void {
  if (caffeinateProcess) {
    try {
      caffeinateProcess.kill('SIGTERM');
    } catch {
      // ignore
    }
    caffeinateProcess = null;
  }
}
