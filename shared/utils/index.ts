/**
 * 共享工具函数
 *
 * Web (client/) 和 TUI (app/) 两端复用的通用工具函数。
 */

/**
 * 格式化 token 速度
 * @param speed tokens/秒
 * @returns 格式化后的速度字符串，如 "1.2k t/s"、"500 t/s"
 */
export function formatTokenSpeed(speed: number): string {
  if (speed >= 1000) return `${(speed / 1000).toFixed(1)}k t/s`;
  return `${Math.round(speed)} t/s`;
}

/**
 * 格式化运行时长
 * @param startTime 起始时间戳 (ms)
 * @returns 格式化后的时长字符串，如 "5s"、"2m30s"
 */
export function formatElapsed(startTime: number): string {
  const sec = Math.floor((Date.now() - startTime) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${s}s`;
}

/**
 * 格式化文件大小
 * @param bytes 文件字节数
 * @param decimals 小数位数（默认 1）
 * @returns 格式化后的大小字符串，如 "1.5 MB"、"340 B"
 */
export function formatFileSize(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = parseFloat((bytes / Math.pow(k, i)).toFixed(decimals));
  return `${value} ${sizes[i]}`;
}
