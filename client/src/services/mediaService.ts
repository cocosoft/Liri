/**
 * Media Service — 前端媒体工具 API 封装
 *
 * 封装后端 /v1/tools 调用，提供媒体操作的统一接口。
 */

import { toolService } from "./toolService";
import type { ToolResult } from "../types/tools";

export interface MediaInfoResult {
  format?: string;
  fileSize?: number;
  dimensions?: { width: number; height: number };
  createdAt?: number;
}

export interface MediaProcessResult {
  success: boolean;
  outputPath?: string;
  outputSize?: number;
  error?: string;
  warning?: string;
}

export const mediaService = {
  /** 获取媒体文件元数据 */
  async info(filePath: string): Promise<MediaInfoResult | null> {
    const result = await toolService.execute("media:info", { filePath });
    if (result.status === "success" && result.metadata) {
      return result.metadata as MediaInfoResult;
    }
    return null;
  },

  /** 转换图片格式 */
  async convert(
    input: string,
    output: string,
    format: string,
  ): Promise<MediaProcessResult> {
    const result = await toolService.execute("media:image:convert", {
      input,
      output,
      format,
    });
    return _mapResult(result);
  },

  /** 缩放图片 */
  async resize(
    input: string,
    output: string,
    maxWidth?: number,
    maxHeight?: number,
    quality?: number,
  ): Promise<MediaProcessResult> {
    const result = await toolService.execute("media:image:resize", {
      input,
      output,
      maxWidth,
      maxHeight,
      quality,
    });
    return _mapResult(result);
  },

  /** 裁剪图片 */
  async crop(
    input: string,
    output: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<MediaProcessResult> {
    const result = await toolService.execute("media:image:crop", {
      input,
      output,
      x,
      y,
      width,
      height,
    });
    return _mapResult(result);
  },

  /** 旋转图片 */
  async rotate(
    input: string,
    output: string,
    degrees: number,
  ): Promise<MediaProcessResult> {
    const result = await toolService.execute("media:image:rotate", {
      input,
      output,
      degrees,
    });
    return _mapResult(result);
  },

  /** 添加水印 */
  async watermark(
    input: string,
    output: string,
    text: string,
    position?: string,
    fontSize?: number,
    opacity?: number,
  ): Promise<MediaProcessResult> {
    const result = await toolService.execute("media:image:watermark", {
      input,
      output,
      text,
      position,
      fontSize,
      opacity,
    });
    return _mapResult(result);
  },

  /** 调整图片 */
  async adjust(
    input: string,
    output: string,
    brightness?: number,
    contrast?: number,
    saturation?: number,
  ): Promise<MediaProcessResult> {
    const result = await toolService.execute("media:image:adjust", {
      input,
      output,
      brightness,
      contrast,
      saturation,
    });
    return _mapResult(result);
  },

  /** 压缩视频 */
  async compressVideo(
    input: string,
    output: string,
    quality?: number,
  ): Promise<MediaProcessResult> {
    const result = await toolService.execute("media:video:compress", {
      input,
      output,
      quality,
    });
    return _mapResult(result);
  },

  /** 提取视频音频 */
  async extractAudio(
    input: string,
    output: string,
  ): Promise<MediaProcessResult> {
    const result = await toolService.execute("media:video:extract-audio", {
      input,
      output,
    });
    return _mapResult(result);
  },

  /** 提取视频缩略图 */
  async extractThumbnail(
    input: string,
    output: string,
    time?: number,
  ): Promise<MediaProcessResult> {
    const result = await toolService.execute("media:video:extract-thumbnail", {
      input,
      output,
      time,
    });
    return _mapResult(result);
  },

  /** 生成二维码 */
  async generateQR(
    text: string,
    output: string,
    size?: number,
  ): Promise<MediaProcessResult> {
    const result = await toolService.execute("media:qr:generate", {
      text,
      output,
      size,
    });
    return _mapResult(result);
  },

  /** 解码二维码 */
  async decodeQR(input: string): Promise<string | null> {
    const result = await toolService.execute("media:qr:decode", { input });
    if (result.status === "success" && result.result) {
      return result.result as string;
    }
    return null;
  },

  /** 提取 PDF 页面 */
  async extractPDF(
    input: string,
    startPage?: number,
    endPage?: number,
    dpi?: number,
  ): Promise<MediaProcessResult> {
    const result = await toolService.execute("media:pdf:extract", {
      input,
      startPage,
      endPage,
      dpi,
    });
    return _mapResult(result);
  },

  /** 删除媒体文件（需审批） */
  async deleteFile(filePath: string): Promise<ToolResult> {
    return toolService.execute("media:delete", { filePath });
  },

  /** 批量删除媒体文件（需审批） */
  async deleteBatch(filePaths: string[]): Promise<ToolResult> {
    return toolService.execute("media:deleteBatch", {
      filePaths: JSON.stringify(filePaths),
    });
  },
};

function _mapResult(result: ToolResult): MediaProcessResult {
  return {
    success: result.status === "success",
    outputPath: (result as any).outputPath,
    outputSize: (result as any).outputSize,
    error: result.error,
    warning: (result as any).warning,
  };
}
