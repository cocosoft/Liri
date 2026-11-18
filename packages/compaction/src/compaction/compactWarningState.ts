/**
 * 压缩警告状态管理
 * * 跟踪"距自动压缩的剩余上下文"警告是否应被抑制。
 * 在成功压缩后立即抑制警告，因为在下一次API响应前没有准确的token计数。
 */

let suppressWarning = false;

export function suppressCompactWarning(): void {
  suppressWarning = true;
}

export function clearCompactWarningSuppression(): void {
  suppressWarning = false;
}

export function isCompactWarningSuppressed(): boolean {
  return suppressWarning;
}
