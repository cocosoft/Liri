/**
 * 安全配置外部化管理
 * 对标平安科技：将安全验证规则外部化到配置文件，支持热更新
 * 可在不重启应用的情况下更新安全策略
 */
import fs from 'fs';
import path from 'path';
import { resolveSecurityDir } from '@modules/core';
import { EventEmitter } from 'events';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'security:config:SecurityConfigManager', level: LogLevel.INFO });

/**
 * 安全验证规则定义
 */
export interface SecurityValidationRule {
  name: string;
  enabled: boolean;
  pattern?: string;
  message: string;
  riskLevel: 'low' | 'medium' | 'high';
  behavior: 'allow' | 'deny' | 'ask';
}

/**
 * 安全配置结构
 */
export interface SecurityConfig {
  version: number;
  updatedAt: number;
  redact: {
    enabled: boolean;
    dryRunMode: boolean;
    shortTokenThreshold: number;
    longTokenPrefixChars: number;
    longTokenSuffixChars: number;
    additionalSensitiveKeys: string[];
    whitelistPatterns: string[];
  };
  files: {
    writeSafeRootEnabled: boolean;
    protectedFiles: string[];
    protectedDirectoryPrefixes: string[];
    readProtectionEnabled: boolean;
    maxFileSize: number;
    blockDeviceAccess: boolean;
  };
  injection: {
    enabled: boolean;
    strictMode: boolean;
    scanContextFiles: boolean;
    additionalInjectionPatterns: SecurityValidationRule[];
    unicodeSanitizeEnabled: boolean;
    normalizeHomoglyphs: boolean;
  };
  patterns: {
    enabled: boolean;
    autoUpdateIntervalDays: number;
    customPatterns: SecurityValidationRule[];
  };
  tools: {
    guardrailsEnabled: boolean;
    strictMode: boolean;
    allowlist: string[];
    blocklist: string[];
    customRules: SecurityValidationRule[];
  };
}

/**
 * 默认安全配置
 */
export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  version: 1,
  updatedAt: Date.now(),
  redact: {
    enabled: true,
    dryRunMode: false,
    shortTokenThreshold: 18,
    longTokenPrefixChars: 6,
    longTokenSuffixChars: 4,
    additionalSensitiveKeys: [],
    whitelistPatterns: [
      'username',
      'display_name',
      'email',
      'nickname',
      'first_name',
      'last_name',
    ],
  },
  files: {
    writeSafeRootEnabled: false,
    protectedFiles: [],
    protectedDirectoryPrefixes: [],
    readProtectionEnabled: true,
    maxFileSize: 10 * 1024 * 1024,
    blockDeviceAccess: true,
  },
  injection: {
    enabled: true,
    strictMode: false,
    scanContextFiles: true,
    additionalInjectionPatterns: [],
    unicodeSanitizeEnabled: true,
    normalizeHomoglyphs: false,
  },
  patterns: {
    enabled: true,
    autoUpdateIntervalDays: 90,
    customPatterns: [],
  },
  tools: {
    guardrailsEnabled: true,
    strictMode: false,
    allowlist: [],
    blocklist: [],
    customRules: [],
  },
};

/**
 * 安全配置管理器
 *
 * @deprecated 请使用 @modules/config/ConfigManager 替代（全局配置 + 多源合并）。
 *   本类为独立的文件式安全配置管理，与主配置系统功能重叠。
 *   安全配置应整合到 @modules/config/ConfigManager 的全局配置中。
 *   此文件将在未来版本中移除。
 */
export class SecurityConfigManager extends EventEmitter {
  private config: SecurityConfig;
  private configPath: string;
  private watchEnabled: boolean;
  private watcher: fs.FSWatcher | null = null;

  /**
   * 构造函数
   * @param configPath 配置文件路径
   */
  constructor(configPath?: string) {
    super();
    this.configPath =
      configPath || path.join(resolveSecurityDir(), 'security-config.json');
    this.watchEnabled = false;
    this.config = JSON.parse(JSON.stringify(DEFAULT_SECURITY_CONFIG));
  }

  /**
   * 加载配置
   * @param filePath 配置文件路径
   * @returns 配置对象
   */
  load(filePath?: string): SecurityConfig {
    const target = filePath || this.configPath;

    try {
      if (fs.existsSync(target)) {
        const content = fs.readFileSync(target, 'utf-8');
        const loaded = JSON.parse(content);

        this.config = this.mergeWithDefaults(loaded);
        this.config.updatedAt = Date.now();

        this.emit('configLoaded', {
          path: target,
          version: this.config.version,
        });

        return this.getConfig();
      }
    } catch (err) {
      this.emit('configLoadError', {
        path: target,
        error: err instanceof Error ? err.message : '加载失败',
      });
    }

    return this.getConfig();
  }

  /**
   * 保存配置
   * @param filePath 目标路径
   */
  save(filePath?: string): void {
    const target = filePath || this.configPath;
    const dir = path.dirname(target);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.config.version++;
    this.config.updatedAt = Date.now();

    fs.writeFileSync(target, JSON.stringify(this.config, null, 2), 'utf-8');

    this.emit('configSaved', { path: target, version: this.config.version });
  }

  /**
   * 启用热更新（文件监听）
   */
  enableHotReload(): void {
    if (this.watchEnabled) return;

    try {
      const dir = path.dirname(this.configPath);

      this.watcher = fs.watch(dir, (_eventType, filename) => {
        if (filename === path.basename(this.configPath)) {
          setTimeout(() => {
            this.load();
          }, 200);
        }
      });

      this.watchEnabled = true;
    } catch {
      this.watchEnabled = false;
    }
  }

  /**
   * 禁用热更新
   */
  disableHotReload(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this.watchEnabled = false;
  }

  /**
   * 获取当前配置
   */
  getConfig(): SecurityConfig {
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * 更新配置片段
   * @param path 配置路径（点分隔）
   * @param value 新值
   */
  update(path: string, value: unknown): void {
    const parts = path.split('.');
    let current: Record<string, unknown> = this.config as unknown as Record<
      string,
      unknown
    >;

    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
        return;
      }
      current = current[parts[i]] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
    this.config.updatedAt = Date.now();

    this.emit('configUpdated', { path, value });
  }

  /**
   * 检查脱敏是否启用
   */
  isRedactEnabled(): boolean {
    return this.config.redact.enabled;
  }

  /**
   * 检查脱敏是否为 Dry Run 模式
   */
  isRedactDryRun(): boolean {
    return this.config.redact.dryRunMode;
  }

  /**
   * 检查注入检测是否启用
   */
  isInjectionDetectionEnabled(): boolean {
    return this.config.injection.enabled;
  }

  /**
   * 检查护栏是否启用
   */
  isGuardrailsEnabled(): boolean {
    return this.config.tools.guardrailsEnabled;
  }

  /**
   * 检查读取保护是否启用
   */
  isReadProtectionEnabled(): boolean {
    return this.config.files.readProtectionEnabled;
  }

  /**
   * 检查文件写入安全根是否启用
   */
  isWriteSafeRootEnabled(): boolean {
    return this.config.files.writeSafeRootEnabled;
  }

  /**
   * 与默认配置合并
   * @param loaded 加载的配置
   * @returns 合并后的配置
   */
  private mergeWithDefaults(loaded: Partial<SecurityConfig>): SecurityConfig {
    const defaults = JSON.parse(JSON.stringify(DEFAULT_SECURITY_CONFIG));

    if (loaded.redact) {
      defaults.redact = { ...defaults.redact, ...loaded.redact };
    }

    if (loaded.files) {
      defaults.files = { ...defaults.files, ...loaded.files };
    }

    if (loaded.injection) {
      defaults.injection = { ...defaults.injection, ...loaded.injection };
    }

    if (loaded.patterns) {
      defaults.patterns = { ...defaults.patterns, ...loaded.patterns };
    }

    if (loaded.tools) {
      defaults.tools = { ...defaults.tools, ...loaded.tools };
    }

    defaults.version = loaded.version || defaults.version;

    return defaults;
  }
}

/**
 * 全局安全配置管理器
 */
let globalConfigManager: SecurityConfigManager | null = null;

/**
 * 获取全局安全配置管理器
 */
export function getSecurityConfigManager(): SecurityConfigManager {
  if (!globalConfigManager) {
    globalConfigManager = new SecurityConfigManager();
  }

  return globalConfigManager;
}

/**
 * 初始化安全配置（从文件加载并启用热更新）
 */
export function initializeSecurityConfig(configPath?: string): SecurityConfig {
  const manager = getSecurityConfigManager();

  const config = manager.load(configPath);
  manager.enableHotReload();

  return config;
}
