/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * FileExtractTool — 压缩包解压工具
 *
 * 职责：
 *   1. 解压 zip/tar/tar.gz 归档文件
 *   2. 解压后的每个文件独立注册到 FileRegistry
 *   3. zip bomb 防护（压缩比/文件数/嵌套深度校验）
 *
 * 使用方式：
 *   const extractor = new FileExtractTool();
 *   const result = await extractor.extract(archivePath, outputDir);
 *
 * 注意：
 *   - RAR/7z 格式需要系统安装对应工具，暂不支持内置解压
 *   - 使用系统内置工具（tar / Expand-Archive），无第三方依赖
 */

import { execFile } from 'child_process';
import { readdir, stat, mkdir, readFile } from 'fs/promises';
import { join, basename, extname } from 'path';
import { existsSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { resolveInboundDir } from '@modules/core';
import { FileRegistry } from './FileRegistry';
import { FileSource } from './types';

const logger = new Logger({ level: LogLevel.INFO });

/** 最大解压文件数（zip bomb 防护） */
const MAX_EXTRACTED_FILES = 10000;

/** 最大压缩比（压缩前/压缩后，zip bomb 防护） */
const MAX_COMPRESSION_RATIO = 100;

/** 最大嵌套深度（递归解压防护） */
const MAX_NESTING_DEPTH = 3;

export interface ExtractResult {
  /** 解压是否成功 */
  success: boolean;
  /** 解压文件总数 */
  extractedCount: number;
  /** 注册到 FileRegistry 的文件数 */
  registeredCount: number;
  /** 解压到的目标目录 */
  outputDir: string;
  /** 注册的文件 ID 列表 */
  fileIds: string[];
  /** 错误信息 */
  errors: string[];
  /** 警告信息（zip bomb 告警等） */
  warnings: string[];
}

export interface ExtractOptions {
  /** 归档文件父 file_id（用于关联） */
  archiveParentId?: string;
  /** 当前嵌套深度（递归解压防护） */
  nestingDepth?: number;
}

/**
 * 压缩包解压工具
 */
export class FileExtractTool {
  private registry: FileRegistry;

  constructor() {
    this.registry = FileRegistry.getInstance();
  }

  /**
   * 解压归档文件并注册内部文件
   *
   * @param archivePath 归档文件路径
   * @param outputDir 输出目录（可选，默认使用 inbound/archive_extracted/）
   * @param options 解压选项
   * @returns 解压结果
   */
  async extract(
    archivePath: string,
    outputDir?: string,
    options: ExtractOptions = {}
  ): Promise<ExtractResult> {
    const { archiveParentId = '', nestingDepth = 0 } = options;

    const result: ExtractResult = {
      success: false,
      extractedCount: 0,
      registeredCount: 0,
      outputDir: '',
      fileIds: [],
      errors: [],
      warnings: [],
    };

    // 嵌套深度检查
    if (nestingDepth >= MAX_NESTING_DEPTH) {
      result.errors.push(`嵌套深度超过限制（${MAX_NESTING_DEPTH}），拒绝解压`);
      return result;
    }

    // 检查文件是否存在
    if (!existsSync(archivePath)) {
      result.errors.push(`归档文件不存在: ${archivePath}`);
      return result;
    }

    // 确定输出目录
    if (outputDir) {
      result.outputDir = outputDir;
    } else {
      const timestamp = Date.now().toString(36);
      result.outputDir = join(
        resolveInboundDir('archive_extracted'),
        `${timestamp}_${basename(archivePath, extname(archivePath))}`
      );
    }

    await mkdir(result.outputDir, { recursive: true });

    const ext = extname(archivePath).toLowerCase();
    const name = basename(archivePath).toLowerCase();

    try {
      // 根据文件类型选择解压策略
      if (ext === '.zip') {
        await this.extractZip(archivePath, result.outputDir);
      } else if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) {
        await this.extractTarGz(archivePath, result.outputDir);
      } else if (ext === '.tar' || name.endsWith('.tar')) {
        await this.extractTar(archivePath, result.outputDir);
      } else if (
        ext === '.gz' &&
        !name.endsWith('.tar.gz') &&
        !name.endsWith('.tgz')
      ) {
        await this.extractGz(archivePath, result.outputDir);
      } else {
        result.errors.push(`不支持的归档格式: ${ext}`);
        return result;
      }

      // 扫描解压目录，收集文件
      const files = await this.collectExtractedFiles(result.outputDir);

      // 文件数检查（zip bomb 防护）
      if (files.length > MAX_EXTRACTED_FILES) {
        result.warnings.push(
          `解压文件数 ${files.length} 超过限制 ${MAX_EXTRACTED_FILES}，仅注册前 ${MAX_EXTRACTED_FILES} 个`
        );
      }

      result.extractedCount = files.length;

      // 注册每个文件到 FileRegistry
      await this.registry.initDatabase();

      const archiveStat = await stat(archivePath);
      const archiveSize = archiveStat.size;

      let totalExtractedSize = 0;

      for (const filePath of files.slice(0, MAX_EXTRACTED_FILES)) {
        try {
          const fileStat = await stat(filePath);
          totalExtractedSize += fileStat.size;

          const content = await readFile(filePath);
          const relativePath = filePath.slice(result.outputDir.length + 1);

          const regResult = await this.registry.registerFile({
            originalName: relativePath,
            content,
            source: FileSource.ARCHIVE_EXTRACTED,
            sourceId: archiveParentId,
            mimeType: this.guessMimeType(relativePath),
            description: `从归档文件解压: ${basename(archivePath)}`,
            storeZone: 'inbound',
            isArchive: false,
            archiveParentId,
          });

          result.fileIds.push(regResult.fileId);
          result.registeredCount++;
        } catch (err) {
          result.errors.push(
            `文件注册失败: ${filePath} - ${(err as Error).message}`
          );
        }
      }

      // 压缩比检查（zip bomb 防护）
      if (archiveSize > 0) {
        const ratio = totalExtractedSize / archiveSize;
        if (ratio > MAX_COMPRESSION_RATIO) {
          result.warnings.push(
            `压缩比 ${ratio.toFixed(1)}:1 超过限制 ${MAX_COMPRESSION_RATIO}:1，可能存在 zip bomb`
          );
        }
      }

      result.success = true;
      logger.info('归档文件解压完成', {
        archivePath: basename(archivePath),
        extractedCount: result.extractedCount,
        registeredCount: result.registeredCount,
      });
    } catch (err) {
      result.errors.push(`解压失败: ${(err as Error).message}`);
      await handleError(err, {
        module: 'services:file:extract',
        action: 'extract_archive',
        context: { archivePath },
      });
    }

    return result;
  }

  /**
   * 解压 .zip 文件（使用 PowerShell Expand-Archive）
   */
  private async extractZip(
    archivePath: string,
    outputDir: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cmd = `Expand-Archive -Path '${archivePath}' -DestinationPath '${outputDir}' -Force`;
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', cmd],
        { timeout: 300000 },
        (err, stdout, stderr) => {
          if (err) {
            reject(
              new Error(
                `PowerShell Expand-Archive 失败: ${stderr || err.message}`
              )
            );
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * 解压 .tar.gz 文件（使用系统 tar 命令）
   */
  private async extractTarGz(
    archivePath: string,
    outputDir: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      execFile(
        'tar',
        ['-xzf', archivePath, '-C', outputDir],
        { timeout: 300000 },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`tar 解压失败: ${stderr || err.message}`));
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * 解压 .tar 文件（使用系统 tar 命令）
   */
  private async extractTar(
    archivePath: string,
    outputDir: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      execFile(
        'tar',
        ['-xf', archivePath, '-C', outputDir],
        { timeout: 300000 },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`tar 解压失败: ${stderr || err.message}`));
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * 解压 .gz 文件（单文件压缩，使用 Node.js zlib）
   */
  private async extractGz(
    archivePath: string,
    outputDir: string
  ): Promise<void> {
    const { createGunzip } = await import('zlib');
    const { createReadStream, createWriteStream } = await import('fs');
    const { pipeline } = await import('stream/promises');

    const originalName = basename(archivePath, '.gz');
    const outputPath = join(outputDir, originalName);

    await pipeline(
      createReadStream(archivePath),
      createGunzip(),
      createWriteStream(outputPath)
    );
  }

  /**
   * 递归收集目录下所有文件路径
   */
  private async collectExtractedFiles(
    dir: string,
    files: string[] = []
  ): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.collectExtractedFiles(fullPath, files);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * 根据文件名推断 MIME 类型
   */
  private guessMimeType(fileName: string): string {
    const ext = extname(fileName).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.csv': 'text/csv',
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.ts': 'text/typescript',
      '.py': 'text/x-python',
      '.rs': 'text/x-rust',
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.zip': 'application/zip',
      '.gz': 'application/gzip',
      '.tar': 'application/x-tar',
    };
    return mimeMap[ext] || 'application/octet-stream';
  }
}
