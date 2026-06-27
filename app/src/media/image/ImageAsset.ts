/**
 * ImageAsset — 图像工具链统一数据模型
 *
 * 用于工具间传递图片产物，携带完整的路径和元信息，
 * 避免跨工具重复 fs.stat / getDimensions。
 */

import fs from 'node:fs';
import path from 'node:path';
import { imageFormatDetector } from './ImageFormatDetector';

/**
 * 图片资产
 * 作为图像工具间传递的中间产物类型
 */
export interface ImageAsset {
  /** 文件绝对路径 */
  path: string;
  /** 文件格式 */
  format: 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp' | 'svg';
  /** 宽度（像素） */
  width: number;
  /** 高度（像素） */
  height: number;
  /** 文件大小（字节） */
  fileSize: number;
  /** MIME 类型 */
  mimeType: string;
}

/**
 * 验证 ImageAsset 的有效性
 * 检查文件是否存在，以及尺寸是否与元数据匹配
 * 不匹配时通过 getDimensions 重新读取
 */
export async function validateAsset(asset: ImageAsset): Promise<ImageAsset> {
  if (!fs.existsSync(asset.path)) {
    throw new Error(`ImageAsset file not found: ${asset.path}`);
  }

  // 重新读取实际文件尺寸，与 asset 元数据对比
  const stat = fs.statSync(asset.path);
  if (stat.size !== asset.fileSize) {
    // 文件已变化，重新读取尺寸
    const dims = imageFormatDetector.detectDimensions(asset.path);
    if (dims) {
      return {
        ...asset,
        width: dims.width,
        height: dims.height,
        fileSize: stat.size,
      };
    }
  }

  return asset;
}

/**
 * 从文件路径创建 ImageAsset
 */
export function createImageAsset(
  filePath: string,
  format?: ImageAsset['format']
): ImageAsset | null {
  try {
    if (!fs.existsSync(filePath)) return null;

    const stat = fs.statSync(filePath);
    const dims = imageFormatDetector.detectDimensions(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const fmt = format || (ext as ImageAsset['format']);

    return {
      path: filePath,
      format: fmt,
      width: dims?.width ?? 0,
      height: dims?.height ?? 0,
      fileSize: stat.size,
      mimeType: `image/${fmt === 'jpeg' ? 'jpeg' : fmt}`,
    };
  } catch {
    return null;
  }
}
