/**
 * Discord 通道运行时模块
 * 对标 OpenClaw extensions/discord/src/runtime.ts
 *
 * 提供运行时存储，管理运行时状态与子模块引用。
 */

/** 运行时状态 */
export type DiscordRuntimeStatus = 'idle' | 'active' | 'error';

/** Discord 运行时类型 */
export type DiscordRuntime = {
  status: DiscordRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: DiscordRuntime | null = null;

/**
 * 设置运行时实例
 */
export function setDiscordRuntime(runtime: DiscordRuntime): void {
  _runtime = runtime;
}

/**
 * 获取运行时实例
 */
export function getDiscordRuntime(): DiscordRuntime {
  if (!_runtime) {
    throw new Error('Discord runtime 未初始化');
  }
  return _runtime;
}

/**
 * 清除运行时实例
 */
export function clearDiscordRuntime(): void {
  _runtime = null;
}
