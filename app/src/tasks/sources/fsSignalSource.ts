/**
 * fsSignalSource —— 把「文件变更信号」翻译成入站事件（P35，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 P35。
 *
 * 与既有 `alwayson/SignalWatcher` 的关系：**升级**它（新增可选 `onSignal` 回调），
 * 不改 `hasSignal()` 语义 ⇒ `DiscoveryGates.dormant_no_signal` 行为零变化。
 * 本模块只把信号从"布尔"变成携带 `{path, kind}` 的事件，供 Source 层消费。
 *
 * 线程键：`fs:<path>` ⇒ 同一路径串行；幂等键 `externalId = <path>@<at>`。
 */
import { SignalWatcher, type SignalDetail } from '../alwayson/SignalWatcher';
import {
  asThreadKey,
  THREAD_KEY_PREFIX,
  type EventSource,
  type InboundEvent,
} from './types';

export const FS_SOURCE_ID = 'fs';

/**
 * 一次文件信号（`poll` 为 Windows 轮询回退）。
 *
 * 直接复用 `SignalWatcher` 的回调载荷类型 ⇒ 不另立第二份同形定义（CS01）；`at` 同时用作读位点。
 */
export type FileSignal = SignalDetail;

/** 纯函数：`FileSignal → InboundEvent`（唯一翻译点） */
export function fileSignalToInbound(signal: FileSignal): InboundEvent {
  return {
    threadKey: asThreadKey(THREAD_KEY_PREFIX.fs, signal.path),
    externalId: `${signal.path}@${signal.at}`,
    type: 'file_changed',
    cursor: signal.at,
    payload: { path: signal.path, kind: signal.kind },
  };
}

/** 事件来源 + 生命周期（`stop` 供组合根/热重载释放 watcher） */
export interface FsSignalSource extends EventSource {
  stop(): void;
}

/**
 * 由监听路径构造事件来源。
 *
 * 订阅时才创建 watcher（未订阅 ⇒ 不占句柄）；`stop()` 释放。
 */
export function createFsSignalSource(options: {
  watchPaths: string[];
  /** 去抖窗口（与 `SignalWatcher` 同参数） */
  debounceMs?: number;
  id?: string;
}): FsSignalSource {
  const id = options.id ?? FS_SOURCE_ID;
  let watcher: SignalWatcher | null = null;

  return {
    id,
    async subscribe(handler) {
      const w = new SignalWatcher(
        options.debounceMs ?? 2000,
        options.watchPaths,
        (signal) => {
          void handler(fileSignalToInbound(signal));
        }
      );
      watcher = w;
      w.start();
      return () => w.stop();
    },
    stop() {
      watcher?.stop();
      watcher = null;
    },
  };
}
