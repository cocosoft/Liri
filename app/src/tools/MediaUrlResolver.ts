// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 媒体展示 URL 解析器（统一收口，2026-08-12）
 *
 * 按文件**实际位置**生成可访问的静态 URL，解决"展示 URL 与文件实际存储位置不一致"：
 * 图片/音频/视频展示工具此前一律把文件名拼到媒体库前缀（假定文件在媒体库），
 * 项目工作目录等非媒体库文件生成的 URL 全部 404 → 前端显示占位符。
 *
 * 规则：
 *   - 媒体库内   → {mediaPrefix}{相对路径}
 *   - 额外安全根 → {extra.prefix}{相对路径}
 *   - 其他（项目工作目录等，不在静态服务安全根内）→ 复制到媒体库 imported/ 子目录再映射
 */
import { copyFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { isPathWithin } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('tools:mediaUrlResolver');

/** 一个可访问的安全根映射：磁盘目录 → 静态 URL 前缀 */
export interface MediaRoot {
  /** 磁盘根目录（绝对路径） */
  root: string;
  /** 对应的静态 URL 前缀（如 /v1/images/static/media/） */
  prefix: string;
}

/** 解析选项 */
export interface MediaUrlResolveOptions {
  /** 媒体库根目录（同时是"非安全根文件"的复制目标） */
  mediaRoot: string;
  /** 媒体库静态 URL 前缀 */
  mediaPrefix: string;
  /** 额外安全根（如图片的输出目录 / 附件目录） */
  extraRoots?: MediaRoot[];
}

/**
 * 解析文件到可访问的展示 URL
 * @param filePath 已确认存在的本地文件绝对路径
 * @returns 静态 URL；复制失败时回退文件名 URL（可能 404，保留 originalPath 供排查）
 */
export function resolveAccessibleMediaUrl(
  filePath: string,
  opts: MediaUrlResolveOptions
): string {
  const { mediaRoot, mediaPrefix, extraRoots = [] } = opts;
  const toRel = (root: string, p: string): string =>
    path.relative(root, p).split(path.sep).join('/');

  if (isPathWithin(mediaRoot, filePath)) {
    return `${mediaPrefix}${toRel(mediaRoot, filePath)}`;
  }
  for (const extra of extraRoots) {
    if (isPathWithin(extra.root, filePath)) {
      return `${extra.prefix}${toRel(extra.root, filePath)}`;
    }
  }

  // 非安全根（项目工作目录等）：复制到媒体库 imported/ 子目录，保证静态服务可访问。
  // 展示拷贝进入媒体库（AI 媒体持久化目录），原始文件位置不变。
  const filename = path.basename(filePath);
  const targetDir = path.join(mediaRoot, 'imported');
  try {
    mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(
      targetDir,
      `${randomUUID().slice(0, 8)}__${filename}`
    );
    copyFileSync(filePath, targetPath);
    return `${mediaPrefix}imported/${path.basename(targetPath)}`;
  } catch (err) {
    logger.warn('媒体文件复制到媒体库失败，回退文件名 URL', {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return `${mediaPrefix}${filename}`;
  }
}
