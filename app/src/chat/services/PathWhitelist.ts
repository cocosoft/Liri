// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 路径白名单配置（方案 3 核心实现）
 *
 * 配置 AI 可引用目录白名单。AI 在文本中引用白名单外的路径时，
 * PathGuardService 会标记为 restricted 状态而非直接拦截（lenient 模式）。
 *
 * 白名单模板变量：
 *   {projectRoot} → resolveProjectRoot()
 *   {pyappHome}  → resolvePyappHome()
 */
import * as path from 'node:path';
import { resolveProjectRoot, resolvePyappHome } from '@modules/core/paths';

export interface WhitelistConfig {
  /** 允许 AI 引用的目录路径（绝对路径，支持模板变量） */
  allowedDirs: string[];
  /** 白名单模式: 'strict'=仅白名单内, 'lenient'=白名单外标记但不拦截 */
  mode: 'strict' | 'lenient';
}

const DEFAULT_WHITELIST: WhitelistConfig = {
  mode: 'lenient',
  allowedDirs: [
    '{projectRoot}/app/src',
    '{projectRoot}/app/docs',
    '{projectRoot}/app/config',
    '{pyappHome}/output',
    '{pyappHome}/downloads',
    '{pyappHome}/attachments',
    '{pyappHome}/workspace',
  ],
};

/**
 * 路径白名单服务
 */
export class PathWhitelist {
  private config: WhitelistConfig;

  constructor(config?: Partial<WhitelistConfig>) {
    this.config = {
      mode: config?.mode ?? DEFAULT_WHITELIST.mode,
      allowedDirs: [],
    };
    const dirs = config?.allowedDirs ?? DEFAULT_WHITELIST.allowedDirs;
    this.config.allowedDirs = dirs.map((d) =>
      d
        .replace('{projectRoot}', resolveProjectRoot())
        .replace('{pyappHome}', resolvePyappHome())
    );
  }

  /**
   * 检查路径是否在允许范围内
   * @returns true=允许, false=需标记为 restricted
   */
  isAllowed(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    return this.config.allowedDirs.some((dir) =>
      resolved.startsWith(path.resolve(dir))
    );
  }

  /**
   * 重新加载配置（供 UI 配置变更时调用）
   */
  reload(config: Partial<WhitelistConfig>): void {
    const dirs = config.allowedDirs ?? this.config.allowedDirs;
    this.config.mode = config.mode ?? this.config.mode;
    this.config.allowedDirs = dirs.map((d) =>
      d
        .replace('{projectRoot}', resolveProjectRoot())
        .replace('{pyappHome}', resolvePyappHome())
    );
  }

  /** 获取当前配置（只读） */
  getConfig(): Readonly<WhitelistConfig> {
    return this.config;
  }

  /** 获取当前模式 */
  getMode(): 'strict' | 'lenient' {
    return this.config.mode;
  }
}

/** 默认单例 */
export const defaultWhitelist = new PathWhitelist();
