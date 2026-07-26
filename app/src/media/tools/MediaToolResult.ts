// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * MediaToolResult — Media 工具统一返回类型
 */
import type { ToolResult } from '../../tools/types/ToolResult';

export interface MediaToolResult extends ToolResult {
  /** 生成/处理后的文件路径 */
  outputPath?: string;
  /** 输出文件大小（字节） */
  outputSize?: number;
  /** 非致命告警（如格式降级） */
  warning?: string;
}
