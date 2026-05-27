/**
 * Matrix 通道运行时模块
 * 对标 OpenClaw extensions/matrix/src/runtime.ts
 *
 * 提供运行时存储，管理运行时状态与子模块引用。
 */

/** 运行时状态 */
export type MatrixRuntimeStatus = 'idle' | 'active' | 'error';

/** Matrix 运行时类型 */
export type MatrixRuntime = {
  status: MatrixRuntimeStatus;
  startedAt: number;
  error?: string;
};

let _runtime: MatrixRuntime | null = null;

/**
 * 设置运行时实例
 */
export function setMatrixRuntime(runtime: MatrixRuntime): void {
  _runtime = runtime;
}

/**
 * 获取运行时实例
 */
export function getMatrixRuntime(): MatrixRuntime {
  if (!_runtime) {
    throw new Error('Matrix runtime 未初始化');
  }
  return _runtime;
}

/**
 * 清除运行时实例
 */
export function clearMatrixRuntime(): void {
  _runtime = null;
}
