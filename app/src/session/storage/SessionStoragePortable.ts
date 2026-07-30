// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Session Storage Portable
 *
 * 对标 BA_REF sessionStoragePortable.ts，提供纯 Node.js 文件操作的便携存储层。
 * 零 Liri 内部依赖（无 logger、无 feature flags、无 @modules），可在 CLI/Extension 间共享。
 */

import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  renameSync,
} from 'fs';
import { join } from 'path';

/** 便携存储配置 */
export interface PortableStorageConfig {
  /** 存储根目录 */
  basePath: string;
}

/**
 * 便携会话存储
 *
 * 纯文件系统操作，不依赖任何内部模块。
 */
export class SessionStoragePortable {
  private basePath: string;

  constructor(config: PortableStorageConfig) {
    this.basePath = config.basePath;
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  /** 保存 JSON 对象到文件（原子写入：先写临时文件再 rename，防半写损坏） */
  saveFile(relativePath: string, data: unknown): void {
    const fullPath = join(this.basePath, relativePath);
    const dir = join(fullPath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // BUG-J 修复：原子写入，避免进程崩溃导致半写文件
    const tmpPath = fullPath + '.tmp.' + Date.now();
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    renameSync(tmpPath, fullPath);
  }

  /** 读取并解析 JSON 文件 */
  loadFile<T = unknown>(relativePath: string): T | null {
    const fullPath = join(this.basePath, relativePath);
    if (!existsSync(fullPath)) return null;
    try {
      return JSON.parse(readFileSync(fullPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  /** 删除文件 */
  deleteFile(relativePath: string): void {
    const fullPath = join(this.basePath, relativePath);
    if (existsSync(fullPath)) unlinkSync(fullPath);
  }

  /** 列出目录下所有文件名 */
  listFiles(subDir: string): string[] {
    const dir = join(this.basePath, subDir);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.json'));
  }

  /** 检查文件是否存在 */
  exists(relativePath: string): boolean {
    return existsSync(join(this.basePath, relativePath));
  }
}
