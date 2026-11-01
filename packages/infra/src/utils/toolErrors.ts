/**
 * 工具错误处理相关函数
 */

/**
 * 获取错误的各个部分
 * @param error 错误对象
 * @returns 错误部分数组
 */
export function getErrorParts(error: Error): string[] {
  return [error.message];
}
