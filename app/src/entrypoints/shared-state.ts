/**
 * 入口模块共享状态
 * 避免 entrypoints ↔ main 循环依赖
 */

/** 离线模式（无 AI 密钥）标志 */
export let isOfflineMode = true;

/** 设置离线模式标志 */
export function setOfflineMode(value: boolean): void {
  isOfflineMode = value;
}
