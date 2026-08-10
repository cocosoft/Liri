/**
 * 团队记忆文件监听器
 *
 * 监听团队记忆目录中的文件变更，在文件修改后延迟推送至服务器。
 * 启动时先执行一次拉取，然后启动 fs.watch 以便在首次写入时触发。
 */

import { watch, type FSWatcher } from 'fs';
import { join } from 'path';
import { logEvent } from '@modules/analytics';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('services:teamMemorySync:Watcher');

const DEBOUNCE_MS = 2000;

let watcher: FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pushInProgress = false;
let hasPendingChanges = false;
let currentPushPromise: Promise<void> | null = null;
let watcherStarted = false;

interface WatchOptions {
  teamMemPath: string;
  pushFn: () => Promise<void>;
  pullFn: () => Promise<void>;
  onError?: (err: Error) => void;
}

export function startTeamMemoryWatcher(options: WatchOptions): void {
  if (watcherStarted) return;
  watcherStarted = true;

  const { teamMemPath, pushFn, pullFn, onError } = options;

  // 初始拉取
  pullFn().catch((err: Error) => {
    onError?.(err);
  });

  try {
    watcher = watch(
      teamMemPath,
      { persistent: false },
      (_eventType, filename) => {
        if (!filename || filename.startsWith('.')) return;
        schedulePush(pushFn, onError);
      }
    );
    watcher.on('error', (err: Error) => {
      onError?.(err);
    });
  } catch (err) {
    onError?.(err as Error);
  }
}

function schedulePush(
  pushFn: () => Promise<void>,
  onError?: (err: Error) => void
): void {
  hasPendingChanges = true;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    if (pushInProgress) return;
    if (!hasPendingChanges) return;

    pushInProgress = true;
    hasPendingChanges = false;

    currentPushPromise = pushFn()
      .catch((err: Error) => {
        onError?.(err);
      })
      .finally(() => {
        pushInProgress = false;
        currentPushPromise = null;
      });
  }, DEBOUNCE_MS);
}

export function stopTeamMemoryWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (watcher) {
    watcher.close();
    watcher = null;
  }

  pushInProgress = false;
  hasPendingChanges = false;
  watcherStarted = false;
}

export async function waitForPendingPush(): Promise<void> {
  if (currentPushPromise) {
    await currentPushPromise;
  }
}

export function isWatcherActive(): boolean {
  return watcherStarted;
}
