/**
 * IRC 通道运行时模块
 * 对标 OpenClaw extensions/irc/src/runtime.ts
 *
 * 提供运行时存储，管理运行时状态与子模块引用。
 */

/** 运行时状态 */
export type IrcRuntimeStatus = 'idle' | 'active' | 'error';

/** IRC 运行时类型 */
export type IrcRuntime = {
  status: IrcRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: IrcRuntime | null = null;

/**
 * 设置运行时实例
 */
export function setIrcRuntime(runtime: IrcRuntime): void {
  _runtime = runtime;
}

/**
 * 获取运行时实例
 */
export function getIrcRuntime(): IrcRuntime {
  if (!_runtime) {
    throw new Error('IRC runtime 未初始化');
  }
  return _runtime;
}

/**
 * 清除运行时实例
 */
export function clearIrcRuntime(): void {
  _runtime = null;
}
