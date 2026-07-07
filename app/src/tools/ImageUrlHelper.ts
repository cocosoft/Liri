// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 图片 URL 固化工具
 *
 * 原则：图片展示 URL 格式是固定的 `/v1/images/static/media/{filename}`，
 * 不需要 AI 参与构造。此工具从任意路径（磁盘路径、错误 URL、部分 URL）
 * 中提取文件名，统一生成正确的展示 URL。
 *
 * 使用场景：
 * - ImageGenerateTool 输出中拼装图片链接
 * - ChatManager/repairImageUrls 修复 AI 响应中的错误图片路径
 * - 任何需要构造图片展示 URL 的地方
 */
const IMAGE_EXT_PATTERN = /\.(?:png|jpg|jpeg|webp|gif)$/i;

/** 从任意路径中提取文件名（含扩展名） */
function extractFilename(input: string): string | null {
  // 匹配路径末尾的 文件名.扩展名（兼容 Windows \ 和 Unix / 分隔符）
  const match = input.match(/[^\/\\]+\.(?:png|jpg|jpeg|webp|gif)$/i);
  return match ? match[0] : null;
}

/** /v1/images/static/ 前缀 */
const DISPLAY_PREFIX = '/v1/images/static/media/';

export class ImageUrlHelper {
  /**
   * 从任意路径生成规范的展示 URL
   * @param input - 磁盘路径、相对 URL、错误 URL 等任意格式
   * @returns 规范的 `/v1/images/static/media/{filename}` 格式，无法识别则返回原值
   *
   * @example
   * ImageUrlHelper.toDisplayUrl('E:\\data\\media\\images\\abc.png')
   * // => '/v1/images/static/media/abc.png'
   *
   * ImageUrlHelper.toDisplayUrl('/v1/images//media/abc.png')
   * // => '/v1/images/static/media/abc.png'
   *
   * ImageUrlHelper.toDisplayUrl('/v1/images/static/media/abc.png')
   * // => '/v1/images/static/media/abc.png'  (幂等)
   */
  static toDisplayUrl(input: string): string {
    const filename = extractFilename(input);
    if (!filename) return input;
    return `${DISPLAY_PREFIX}${filename}`;
  }

  /**
   * 从任意路径生成规范的展示 URL，无法识别时返回 null
   */
  static toDisplayUrlOrNull(input: string): string | null {
    const filename = extractFilename(input);
    if (!filename) return null;
    return `${DISPLAY_PREFIX}${filename}`;
  }

  /**
   * 从磁盘路径中提取文件名
   */
  static extractFilename(input: string): string | null {
    return extractFilename(input);
  }

  /**
   * 判断给定字符串是否看起来像一个图片路径（磁盘或 URL 格式）
   */
  static looksLikeImagePath(input: string): boolean {
    return IMAGE_EXT_PATTERN.test(input) && input.length > 5;
  }

  /**
   * 批量修复文本中的所有图片引用
   * - 处理 Markdown 图片语法 ![alt](path)
   * - 处理磁盘路径（Windows 和 Unix 格式）
   * - 处理各种错误 URL 格式
   *
   * @param content - 包含图片引用的文本
   * @returns 修复后的文本
   */
  static repairAll(content: string): string {
    // 1. 修复 Markdown 图片语法中的路径: ![alt](path)
    content = content.replace(
      /!\[[^\]]*\]\(([^)]+)\)/g,
      (fullMatch: string, path: string) => {
        const fixed = ImageUrlHelper.toDisplayUrlOrNull(path);
        if (!fixed) return fullMatch;
        const altEnd = fullMatch.indexOf('](');
        const alt = fullMatch.slice(2, altEnd);
        return `![${alt}](${fixed})`;
      }
    );

    // 2. 修复裸磁盘路径（未被 Markdown 语法包裹的）
    //    匹配 Windows 绝对路径中的图片，如 E:\...\filename.png
    content = content.replace(
      /[A-Za-z]:[\\\/][^\s"'<>\]]*?[\\\/]([\w._-]+\.(?:png|jpg|jpeg|webp|gif))/gi,
      (_fullMatch: string, filename: string) => `${DISPLAY_PREFIX}${filename}`
    );

    return content;
  }
}
