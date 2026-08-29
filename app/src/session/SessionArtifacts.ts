/**
 * 会话制品管理器
 * 管理会话期间生成的代码文件、patch、diff等
 * 对齐 OpenClaw config/sessions/artifacts.ts
 */

import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { getLogger } from '@modules/monitoring';
import {
  existsSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const logger = getLogger('session:artifacts');

export type ArtifactType =
  | 'code'
  | 'diff'
  | 'patch'
  | 'log'
  | 'screenshot'
  | 'other';

export interface ArtifactMeta {
  id: string;
  sessionId: string;
  type: ArtifactType;
  filename: string;
  size: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface ArtifactConfig {
  artifactsDir: string;
  maxSizePerFile: number;
  maxTotalSize: number;
}

import { resolveArtifactsDir } from '@modules/core';
import { FileRegistry } from '@modules/services/file/FileRegistry';
import { FileSource } from '@modules/services/file/types';

const DEFAULT_CONFIG: ArtifactConfig = {
  artifactsDir: resolveArtifactsDir(),
  maxSizePerFile: 10 * 1024 * 1024,
  maxTotalSize: 100 * 1024 * 1024,
};

export class SessionArtifacts {
  private config: ArtifactConfig;
  private artifacts: Map<string, ArtifactMeta[]> = new Map();

  constructor(config: Partial<ArtifactConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (!existsSync(this.config.artifactsDir)) {
      mkdirSync(this.config.artifactsDir, { recursive: true });
    }
  }

  saveArtifact(
    sessionId: string,
    type: ArtifactType,
    content: string | Buffer,
    filename?: string
  ): ArtifactMeta {
    const id = randomUUID();
    const ext =
      type === 'diff'
        ? 'diff'
        : type === 'patch'
          ? 'patch'
          : type === 'screenshot'
            ? 'png'
            : type === 'log'
              ? 'log'
              : 'txt';
    const finalFilename = filename || `${type}-${id}.${ext}`;

    const sessionDir = join(this.config.artifactsDir, sessionId);
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    const filePath = join(sessionDir, finalFilename);
    const data =
      typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;

    if (data.length > this.config.maxSizePerFile) {
      throw new AppError(
        `制品大小 ${data.length} 超出限制 ${this.config.maxSizePerFile}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { size: data.length, limit: this.config.maxSizePerFile }
      );
    }

    writeFileSync(filePath, data);

    const meta: ArtifactMeta = {
      id,
      sessionId,
      type,
      filename: finalFilename,
      size: data.length,
      createdAt: Date.now(),
    };

    const sessionArtifacts = this.artifacts.get(sessionId) || [];
    sessionArtifacts.push(meta);
    this.artifacts.set(sessionId, sessionArtifacts);

    logger.debug(
      `制品已保存: ${sessionId}/${finalFilename} (${data.length} bytes)`
    );

    // 异步注册到 FileRegistry（不阻塞主流程）
    Promise.resolve().then(async () => {
      try {
        const registry = FileRegistry.getInstance();
        await registry.initDatabase();
        await registry.registerFile({
          originalName: finalFilename,
          content: data,
          source: FileSource.ARTIFACT,
          sourceId: sessionId,
          description: `会话制品: ${type} - ${sessionId}`,
          storeZone: 'artifact',
        });
      } catch (err) {
        // KB-ARTIFACT-REG-LOG（2026-08-29）：制品注册 FileRegistry 失败静默 →
        // 文件在磁盘但搜索不到（制品索引缺失）且无排查线索
        logger.warn('会话制品注册到 FileRegistry 失败', {
          sessionId,
          finalFilename,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    return meta;
  }

  getArtifacts(sessionId: string): ArtifactMeta[] {
    return this.artifacts.get(sessionId) || [];
  }

  getArtifactContent(sessionId: string, id: string): Buffer | null {
    const artifacts = this.artifacts.get(sessionId);
    if (!artifacts) return null;

    const meta = artifacts.find((a) => a.id === id);
    if (!meta) return null;

    const filePath = join(this.config.artifactsDir, sessionId, meta.filename);
    if (!existsSync(filePath)) return null;

    try {
      return readFileSync(filePath);
    } catch (error) {
      handleError(error, {
        module: 'sessions:artifacts',
        action: '读取制品失败',
      });
      return null;
    }
  }

  deleteArtifact(sessionId: string, id: string): boolean {
    const artifacts = this.artifacts.get(sessionId);
    if (!artifacts) return false;

    const idx = artifacts.findIndex((a) => a.id === id);
    if (idx === -1) return false;

    const meta = artifacts[idx];
    const filePath = join(this.config.artifactsDir, sessionId, meta.filename);
    try {
      if (existsSync(filePath)) unlinkSync(filePath);
      artifacts.splice(idx, 1);
      this.artifacts.set(sessionId, artifacts);
      return true;
    } catch (error) {
      handleError(error, {
        module: 'sessions:artifacts',
        action: '删除制品失败',
      });
      return false;
    }
  }

  deleteSessionArtifacts(sessionId: string): number {
    const artifacts = this.artifacts.get(sessionId);
    if (!artifacts) return 0;

    const sessionDir = join(this.config.artifactsDir, sessionId);
    let deleted = 0;

    for (const meta of artifacts) {
      const filePath = join(sessionDir, meta.filename);
      try {
        if (existsSync(filePath)) {
          unlinkSync(filePath);
          deleted++;
        }
      } catch (err) {
        // 忽略删除错误
      }
    }

    this.artifacts.delete(sessionId);
    return deleted;
  }

  getTotalSize(): number {
    let total = 0;
    for (const artifacts of this.artifacts.values()) {
      for (const a of artifacts) {
        total += a.size;
      }
    }
    return total;
  }
}
