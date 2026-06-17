/**
 * UtilityTools - 轻量级效用工具集
 * 包含编码/解码、哈希、文本转换、数学、系统信息等常用工具
 * 每个工具实现 Tool 接口，通过 createUtilityTools() 批量创建
 */
import type { Tool } from './types/Tool';
import { collectDataTools } from './utility-data-tools';
import { collectComputeTools } from './utility-compute-tools';
import { collectIoTools } from './utility-io-tools';

/**
 * 批量创建所有效用工具
 */
export function createUtilityTools(): Tool[] {
  const tools: Tool[] = [];

  collectDataTools(tools);
  collectComputeTools(tools);
  collectIoTools(tools);

  return tools;
}
