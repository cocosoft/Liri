/**
 * 配置管理器
 * 提供配置加载、保存、缓存和监控功能
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  copyFileSync,
  statSync,
  readdirSync,
  watchFile,
  unwatchFile,
} from 'fs';
import { join, dirname, basename } from 'path';
import { createHash } from 'crypto';
import {
  GlobalConfig,
  ProjectConfig,
  createDefaultGlobalConfig,
  DEFAULT_PROJECT_CONFIG,
  ConfigStats,
  ConfigSource,
} from './types.js';
import { ConfigValidator } from './ConfigValidator.js';
import { ConfigMigration } from './ConfigMigration.js';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
} from '@modules/error/types.js';
import { handleError } from '@modules/error/handleError.js';
import { ConfigSnapshot, createDefaultConfigSnapshot } from './ConfigSnapshot';
import { ConfigRecovery } from './ConfigRecovery';
import { redactConfig } from './ConfigRedactor';
import { ConfigIO } from './io/ConfigIO';
import { deepMerge } from '../utils/common.js';
import { loadUserSettings } from './settings/userSettings.js';
import { loadProjectSettings } from './settings/projectSettings.js';
import { loadLocalSettings } from './settings/localSettings.js';
import {
  loadPolicySettings,
  isPolicySettingsAvailable,
} from './settings/policySettings.js';
import {
  resolveUserConfigPath,
  resolvePyappHome,
  ensureDir,
} from '@modules/core/paths.js';
import {
  setRuntimeConfigSnapshot,
  clearRuntimeConfigSnapshot,
  getRuntimeConfigSnapshotMetadata,
  hashRuntimeConfigValue as hashRuntimeConfigSnapshotValue,
  registerRuntimeConfigWriteListener,
} from './RuntimeConfigSnapshot.js';

import { getLogger } from '../monitoring/logs/Logger.js';
const logger = getLogger('config:ConfigManager');

/**
 * 🔴 hash-debug 专用 helper：收集对象所有 JSON 叶子路径 + 类型（用于归一化前后对比）。
 * ⚠ 仅记录路径+类型，绝不记录值，避免 config 中的 secret/API Key 落日志。
 */
function collectLeafTypes(node: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  function walk(n: unknown, p: string): void {
    if (n === null) {
      out[p || '<root>'] = 'null';
      return;
    }
    const t = typeof n;
    if (t === 'string' || t === 'number' || t === 'boolean') {
      out[p || '<root>'] = t;
      return;
    }
    if (Array.isArray(n)) {
      n.forEach((item, i) => walk(item, p ? `${p}[${i}]` : `[${i}]`));
      return;
    }
    if (t === 'object') {
      const record = n as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      if (keys.length === 0) {
        out[p || '<root>'] = 'object(empty)';
        return;
      }
      for (const k of keys) {
        const v = record[k];
        const keyPath = p ? `${p}.${k}` : k;
        // 标记非 JSON-native 类型（undefined/Date/BigInt/symbol/function）
        if (v === undefined) {
          out[keyPath] = 'undefined(会被 JSON 归一化删除该键)';
          continue;
        }
        const vt = typeof v;
        if (v instanceof Date) {
          out[keyPath] =
            `Date(iso=${v.toISOString()}:会被 JSON 归一化转 string)`;
          continue;
        }
        if (vt === 'bigint') {
          out[keyPath] =
            `BigInt(${String(v)}:会被 JSON 归一化抛 TypeError 或截断)`;
          continue;
        }
        if (Number.isNaN(v as number)) {
          out[keyPath] = 'NaN(会被 JSON 归一化转 null)';
          continue;
        }
        if (v === Infinity || v === -Infinity) {
          out[keyPath] =
            `${v === Infinity ? '' : '-'}Infinity(会被 JSON 归一化转 null)`;
          continue;
        }
        if (vt === 'symbol' || vt === 'function') {
          out[keyPath] = `${vt}(会被 JSON 归一化删除/省略该值)`;
          continue;
        }
        walk(v, keyPath);
      }
    }
  }
  walk(node, prefix);
  return out;
}

/**
 * 🔴 hash-debug 专用 helper：对比两份 leaf type 表，返回人类可读差异列表。
 * 每条 [path, before→after]，仅输出前 60 条避免刷屏，超过的输出总量。
 */
function diffLeafTypes(
  before: Record<string, string>,
  after: Record<string, string>,
  limit = 60
): { lines: string[]; truncated: number } {
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: Array<{
    k: string;
    type: 'changed' | 'removed' | 'added';
    line: string;
  }> = [];
  for (const k of allKeys) {
    const b = before[k];
    const a = after[k];
    if (b === a) continue;
    if (b !== undefined && a === undefined) {
      changes.push({
        k,
        type: 'removed',
        line: `  - ${k} :: ${b}  (键被 JSON 归一化删除)`,
      });
    } else if (b === undefined && a !== undefined) {
      changes.push({ k, type: 'added', line: `  + ${k} :: ${a}  (键新增)` });
    } else {
      changes.push({ k, type: 'changed', line: `  ~ ${k} :: ${b}  →  ${a}` });
    }
  }
  changes.sort((x, y) => x.k.localeCompare(y.k, 'en'));
  return {
    lines: changes.slice(0, limit).map((c) => c.line),
    truncated: Math.max(0, changes.length - limit),
  };
}

/**
 * 确定性 JSON 序列化，用于配置 Hash 计算
 * 保证相同配置值总是产生相同字符串
 *
 * K-3 修复 (2026-08-21)：根因是「内存对象」和「磁盘 JSON.parse 对象」在 JSON-non-native 类型上的语义差：
 *   - undefined 属性：JSON.stringify 会省略该键，原 stableStringify 保留键并把 undefined 写成 "null"
 *   - Date：JSON.stringify 输出 ISO 字符串，原 stableStringify 把 Date 当普通 record 输出 `{}`
 *   - NaN/Infinity/BigInt：JSON.stringify 行为特殊，原实现没对齐
 * 修复方案：先 `JSON.parse(JSON.stringify(v))` 做一次 JSON 归一化（符合 RFC 8259 纯对象），
 *   结果和磁盘 JSON.parse 的值形态完全一致，再排序键 → 确定性序列化。
 *   这样 computeHash(memoryConfig) 与 verifyConfigHash(fileParsed) 对同一语义配置必相等。
 *
 * @param debugLabel  传入时打印「归一化前后类型差异 + 长度对比」结构化日志。
 *                    递归内部不建议传（会刷屏），仅在顶层 computeHash / verifyConfigHash 等处传入。
 */
function stableStringify(value: unknown, debugLabel?: string): string {
  // 🔴 hash-debug (before)：仅当顶层传了 label 才采样归一化前快照（叶子路径+类型，不含值）
  const beforeLeaves = debugLabel ? collectLeafTypes(value) : null;
  const beforeRawLen = debugLabel
    ? (() => {
        try {
          return JSON.stringify(value)?.length ?? 0;
        } catch {
          return -1; // 循环引用等 JSON.stringify 失败，标记为 -1 方便识别
        }
      })()
    : 0;

  // Step 1: 归一化到 JSON 语义（undefined→删键、Date→ISO string、NaN/Infinity→null、循环引用报错）
  // 这是让「内存对象的 hash」与「磁盘 JSON.parse 回来对象的 hash」对齐的关键
  let normalized: unknown;
  try {
    normalized = JSON.parse(JSON.stringify(value));
  } catch (err) {
    if (debugLabel) {
      logger.warn(
        '[hash-debug] stableStringify: JSON 归一化失败，该值将被当作 null 处理（不影响旧语义）',
        {
          label: debugLabel,
          error:
            err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          valueType: typeof value,
          valueIsArray: Array.isArray(value),
          valueKeys:
            typeof value === 'object' && value !== null
              ? Object.keys(value).slice(0, 30)
              : undefined,
        }
      );
    }
    normalized = null;
  }

  // 🔴 hash-debug (after)：输出归一化前后的叶子类型差异
  if (debugLabel && beforeLeaves) {
    const afterLeaves = collectLeafTypes(normalized);
    const diff = diffLeafTypes(beforeLeaves, afterLeaves);
    const beforeTotalKeys = Object.keys(beforeLeaves).length;
    const afterTotalKeys = Object.keys(afterLeaves).length;
    const afterRawLen = (() => {
      try {
        return JSON.stringify(normalized)?.length ?? 0;
      } catch {
        return -1;
      }
    })();
    logger.debug(
      '[hash-debug] stableStringify: 归一化前后对比（仅路径+类型，不含值）',
      {
        label: debugLabel,
        before: {
          rawJsonLen: beforeRawLen, // JSON.stringify 后的字节长度（失败=-1）
          totalLeafKeys: beforeTotalKeys,
          // 采样前 15 个可疑（非 string/number/boolean/object/array/primitive-ok）类型，帮助快速找到 Date/undefined/NaN/Infinity/BigInt
          suspiciousTypesSample: Object.entries(beforeLeaves)
            .filter(
              ([, t]) =>
                t.startsWith('undefined') ||
                t.startsWith('Date') ||
                t.startsWith('NaN') ||
                t.startsWith('Infinity') ||
                t.startsWith('-Infinity') ||
                t.startsWith('BigInt') ||
                t.startsWith('symbol') ||
                t.startsWith('function')
            )
            .slice(0, 15)
            .map(([k, t]) => `${k}=${t}`),
        },
        after: {
          rawJsonLen: afterRawLen,
          totalLeafKeys: afterTotalKeys,
        },
        summary: {
          rawLenDelta: afterRawLen - beforeRawLen,
          totalKeysDelta: afterTotalKeys - beforeTotalKeys,
          diffLines: diff.lines,
          diffTruncatedCount: diff.truncated,
        },
      }
    );
  }

  // Step 2: 键排序的确定性序列化
  function canonical(node: unknown): string {
    if (node === null) return 'null';
    const t = typeof node;
    if (t === 'string' || t === 'number' || t === 'boolean') {
      return JSON.stringify(node);
    }
    if (Array.isArray(node)) {
      return `[${node.map((entry) => canonical(entry)).join(',')}]`;
    }
    if (t === 'object') {
      const record = node as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      return `{${keys
        .map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`)
        .join(',')}}`;
    }
    // JSON 归一化后不会走到这里（symbol/undefined/function 都已被 JSON.stringify 清除/转换）
    return 'null';
  }

  return canonical(normalized);
}

/**
 * 配置原子修改冲突错误
 * 在 mutateConfigFile() 检测到外部修改时抛出
 */
export class ConfigMutationConflictError extends AppError {
  readonly expectedHash: string | null;
  readonly actualHash: string | null;

  constructor(
    message: string,
    params: { expectedHash: string | null; actualHash: string | null }
  ) {
    super(
      message,
      ErrorCategory.CONFIGURATION,
      ErrorSeverity.HIGH,
      undefined,
      params
    );
    this.name = 'ConfigMutationConflictError';
    this.expectedHash = params.expectedHash;
    this.actualHash = params.actualHash;
  }
}

/**
 * 配置管理器类
 */
export class ConfigManager {
  private globalConfigPath: string;
  private configCache: { config: GlobalConfig | null; mtime: number } = {
    config: null,
    mtime: 0,
  };
  private configHash: string | null = null;
  private lastHashCheckTime: number = 0;
  private configHashRevision: number = 0;
  private stats: ConfigStats = {
    readCount: 0,
    writeCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    hashChecks: 0,
    hashMismatches: 0,
  };
  private freshnessWatcherStarted = false;
  private readonly CONFIG_FRESHNESS_POLL_MS = 1000;
  private readonly CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5分钟
  private readonly HASH_CHECK_INTERVAL_MS = 30000; // 30秒
  private configReadingAllowed = false;
  private configSnapshot: ConfigSnapshot;
  private configRecovery: ConfigRecovery;
  private configIO: ConfigIO;
  /** 备份文件命名自增序号，避免同进程同毫秒多次写入覆盖同名备份 */
  private backupSeq = 0;

  // --- 多源合并相关 ---
  private sourceConfigs: Map<string, Record<string, unknown>> = new Map();
  private mergedCache: Record<string, unknown> = {};
  private sourcePriority: string[] = [
    'userSettings',
    'projectSettings',
    'localSettings',
    'flagSettings',
    'policySettings',
  ];

  /**
   * 构造函数
   * @param configPath 配置文件路径
   * @param lockTimeout 文件锁超时时间（毫秒）
   */
  constructor(configPath?: string, lockTimeout?: number) {
    this.globalConfigPath = configPath || this.resolveConfigPath();
    const configDir = dirname(this.globalConfigPath);
    this.configSnapshot = createDefaultConfigSnapshot(configDir);
    this.configRecovery = new ConfigRecovery(
      this.configSnapshot,
      this.globalConfigPath
    );
    this.configIO = new ConfigIO(configDir, lockTimeout);
  }

  /**
   * 解析配置文件路径，含旧路径迁移
   * @returns 配置文件路径
   */
  private resolveConfigPath(): string {
    const pyappHome = resolvePyappHome();
    const LEGACY_CONFIG_DIR = '.Liri';
    const oldPath = join(pyappHome, '..', LEGACY_CONFIG_DIR, 'config.json');
    const newPath = resolveUserConfigPath();

    // 首次启动时自动迁移从 ~/.Liri/ 到 ~/.pyapp/
    if (existsSync(oldPath) && !existsSync(newPath)) {
      try {
        const data = readFileSync(oldPath, 'utf-8');
        ensureDir(dirname(newPath));
        writeFileSync(newPath, data, 'utf-8');
        renameSync(oldPath, oldPath + '.bak');
        logger.info('配置路径迁移完成', { from: oldPath, to: newPath });
      } catch (e) {
        logger.warn('配置路径迁移失败，继续使用旧路径', { error: String(e) });
        return oldPath;
      }
    }

    return newPath;
  }

  /**
   * 获取默认配置文件路径
   * @returns 默认配置文件路径
   */
  private getDefaultConfigPath(): string {
    return resolveUserConfigPath();
  }

  /**
   * 获取配置备份目录
   * @returns 配置备份目录路径
   */
  private getConfigBackupDir(): string {
    return join(dirname(this.globalConfigPath), 'backups');
  }

  /**
   * 启用配置系统
   */
  enableConfigs(): void {
    if (this.configReadingAllowed) {
      return;
    }

    this.configReadingAllowed = true;
    // 预加载配置
    this.getGlobalConfig();
    logger.info('配置系统已启用');
  }

  /**
   * 获取全局配置
   * 每次调用都会周期性校验运行时快照 Hash，检测外部修改
   * @returns 全局配置
   */
  getGlobalConfig(): GlobalConfig {
    // 快速路径：内存读取 + 周期性 Hash 校验
    if (this.configCache.config) {
      this.stats.cacheHits++;
      // 周期性校验快照 Hash，检测外部修改
      if (this.shouldVerifyHash()) {
        this.verifyConfigHash();
      }
      return this.configCache.config;
    }

    // 慢速路径：从文件加载
    this.stats.cacheMisses++;

    // 配置系统未启用时，直接返回默认配置（不缓存），
    // 避免模块级单例在 enableConfigs() 前访问配置时抛出错误。
    // enableConfigs() 会再次调用 getGlobalConfig() 正常加载文件。
    if (!this.configReadingAllowed && this.env('NODE_ENV') !== 'test') {
      return createDefaultGlobalConfig();
    }

    try {
      let stats: { mtimeMs: number; size: number } | null = null;
      try {
        stats = statSync(this.globalConfigPath);
      } catch (err) {
        // 文件不存在

        handleError(err, {
          module: 'config:ConfigManager',
          action: 'fileNotExist',
        });
      }

      const config = this.loadConfigFromFile();
      this.configCache = {
        config,
        mtime: stats?.mtimeMs ?? Date.now(),
      };
      // 🔴 hash-debug: loadConfig 从磁盘读入后记录首个内存 hash（用于与后续写入/校验追踪）
      this.configHash = this.computeHash(
        config,
        `loadConfig:fromFile#read=${this.stats.readCount ?? 0}`
      );
      this.lastHashCheckTime = Date.now();
      this.configHashRevision++;
      this.stats.readCount++;
      this.stats.lastReadTime = Date.now();

      // 更新运行时配置快照
      setRuntimeConfigSnapshot(config);

      // 启动文件监控
      this.startFreshnessWatcher();
      return config;
    } catch (error) {
      void handleError(error, {
        module: 'config:manager',
        action: 'get_global_config',
      });
      // 诊断：记录调用栈
      logger.warning('getGlobalConfig catch 调用栈', {
        errorName: error instanceof Error ? error.name : typeof error,
        errorCode: (error as unknown as Record<string, unknown>)?.code,
        errorMessage: error instanceof Error ? error.message : String(error),
        stack: new Error().stack?.split('\n').slice(3).join('\n'),
        configReadingAllowed: this.configReadingAllowed,
      });
      return createDefaultGlobalConfig();
    }
  }

  /**
   * 获取脱敏后的全局配置（用于日志和安全输出）
   * @returns 脱敏后的全局配置
   */
  getRedactedGlobalConfig(): GlobalConfig {
    return redactConfig(
      this.getGlobalConfig() as unknown as Record<string, unknown>
    ) as unknown as GlobalConfig;
  }

  /**
   * 判断是否需要进行 Hash 校验
   * 基于距离上次校验的时间间隔
   */
  private shouldVerifyHash(): boolean {
    return Date.now() - this.lastHashCheckTime >= this.HASH_CHECK_INTERVAL_MS;
  }

  /**
   * 计算配置对象的确定性 Hash 值
   * 使用 SHA-256 算法，保证相同配置产生相同 Hash
   *
   * @param config  待哈希的 config 对象（通常是 GlobalConfig 或 fileParsed 形态）
   * @param callerLabel  来源标识：传入则开启 hash-debug，打印「归一化前后差异 + 最终 hash」
   *                     仅在关键路径传入：save/mutate/reload/verify；不要在高频递归内传
   */
  private computeHash(
    config: GlobalConfig | Record<string, unknown>,
    callerLabel?: string
  ): string {
    // 🔴 hash-debug：顶层 stableStringify 打归一化差异日志
    const debugLabel = callerLabel ? `computeHash[${callerLabel}]` : undefined;
    const canonical = stableStringify(config, debugLabel);
    const hash = createHash('sha256').update(canonical).digest('hex');

    if (callerLabel) {
      logger.debug(
        '[hash-debug] computeHash: 输出 hash（不包含 canonical 原文以免 secret 落盘）',
        {
          caller: callerLabel,
          configTopLevelKeys:
            typeof config === 'object' && config !== null
              ? Object.keys(config as Record<string, unknown>).sort()
              : [],
          canonicalLen: canonical.length,
          hashPrefix: `${hash.slice(0, 8)}…${hash.slice(-6)}`, // 仅展示 hash 前后缀用于比对，完整 hash 由 mismatch 分支打印
          configPath: this.globalConfigPath,
        }
      );
    }

    return hash;
  }

  /**
   * 无锁读取配置文件内容（用于 Hash 校验）
   * 不获取文件锁，避免并发竞争
   * @returns 文件内容字符串，读取失败返回 null
   */
  private readConfigFileSnapshot(): string | null {
    try {
      return readFileSync(this.globalConfigPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * 校验运行时配置快照 Hash
   * 对比内存中配置的 Hash 与配置文件的 Hash
   * 不匹配时自动重载配置并记录告警
   */
  private verifyConfigHash(): void {
    if (!this.configHash || !this.configCache.config) {
      return;
    }

    this.stats.hashChecks = (this.stats.hashChecks ?? 0) + 1;
    this.lastHashCheckTime = Date.now();
    const checkSeq = this.stats.hashChecks;

    try {
      const fileContent = this.readConfigFileSnapshot();
      if (fileContent === null) {
        logger.debug(
          '[hash-debug] verifyConfigHash: 配置文件不可读，跳过本次校验',
          {
            checkSeq,
            configPath: this.globalConfigPath,
          }
        );
        return;
      }

      const fileParsed: Record<string, unknown> = JSON.parse(fileContent);
      // 🔴 hash-debug: file 侧走 computeHash（传 caller 开启 stableStringify 归一化差异日志）
      const fileHash = this.computeHash(
        fileParsed,
        `verifyConfigHash:file#${checkSeq}`
      );
      // L-4 回归根因：configHash 为「内存完整配置」hash（含仅内存的默认值键，如 ai/channels/features），
      // 而磁盘 config.json 仅持久化部分键（稀疏配置），两者键集合不同 → hash 恒不匹配。
      // hash 校验语义应为「检测外部对已持久化配置的修改」，
      // 故 expected 侧按文件存在的顶层键裁剪内存配置后计算。
      const configObj = this.configCache.config as Record<string, unknown>;
      const memorySubset: Record<string, unknown> = {};
      for (const key of Object.keys(fileParsed)) {
        if (Object.prototype.hasOwnProperty.call(configObj, key)) {
          memorySubset[key] = configObj[key];
        }
      }
      const expectedFull = this.computeHash(
        memorySubset,
        `verifyConfigHash:mem#${checkSeq}`
      );
      const actualFull = fileHash;

      if (actualFull !== expectedFull) {
        this.stats.hashMismatches = (this.stats.hashMismatches ?? 0) + 1;

        // 🔴 hash-debug (mismatch)：对比内存配置与文件解析后配置的「叶子类型 + 路径」差异
        //   （只输出路径 + 类型 / key 集合，不输出任何具体值——避免 secret 泄露）
        const memoryLeaves = collectLeafTypes(this.configCache.config);
        const fileLeaves = collectLeafTypes(fileParsed);
        const leafDiff = diffLeafTypes(memoryLeaves, fileLeaves, 50);
        const memoryKeys =
          typeof this.configCache.config === 'object' &&
          this.configCache.config !== null
            ? Object.keys(
                this.configCache.config as Record<string, unknown>
              ).sort()
            : [];
        const fileKeys = Object.keys(fileParsed).sort();
        const topLevelKeyDelta: string[] = [
          ...memoryKeys
            .filter((k) => !fileKeys.includes(k))
            .map((k) => `-${k}(仅内存)`),
          ...fileKeys
            .filter((k) => !memoryKeys.includes(k))
            .map((k) => `+${k}(仅文件)`),
        ];

        logger.warn(
          '[hash-debug] verifyConfigHash: hash 不匹配（内存 vs 文件），已触发 reload',
          {
            checkSeq,
            // 完整 hash（此处 OK，hash 本身不可逆 → 不含 secret 明文）
            expectedHash_full: expectedFull,
            actualHash_full: actualFull,
            hashDiff_startPosition: (() => {
              let pos = -1;
              for (
                let i = 0;
                i < Math.max(expectedFull.length, actualFull.length);
                i++
              ) {
                if (expectedFull[i] !== actualFull[i]) {
                  pos = i;
                  break;
                }
              }
              return pos === -1 ? 'identical(理论上不可达)' : `${pos}/64`;
            })(),
            // 结构级差异（仅路径 + 类型 / 顶层 key 名，不含值）
            topLevelKeys: {
              memory: memoryKeys,
              file: fileKeys,
              delta: topLevelKeyDelta,
            },
            leafTypeDiff: {
              totalMemoryLeafKeys: Object.keys(memoryLeaves).length,
              totalFileLeafKeys: Object.keys(fileLeaves).length,
              changedLines: leafDiff.lines,
              truncatedCount: leafDiff.truncated,
            },
            fileRawSize: fileContent.length,
            configPath: this.globalConfigPath,
            statsSnapshot: {
              hashChecks: this.stats.hashChecks,
              hashMismatches: this.stats.hashMismatches,
              hashRevision: this.configHashRevision,
            },
          }
        );
        this.reloadConfig();
      } else {
        logger.debug(
          '[hash-debug] verifyConfigHash: hash 匹配（本次校验正常）',
          {
            checkSeq,
            hashPrefix: `${fileHash.slice(0, 8)}…${fileHash.slice(-6)}`,
            totalChecks: this.stats.hashChecks,
            totalMismatches: this.stats.hashMismatches,
            configPath: this.globalConfigPath,
          }
        );
      }
    } catch (error) {
      logger.warn(
        '[hash-debug] verifyConfigHash: Hash 校验流程异常，跳过本次校验',
        {
          checkSeq,
          error:
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error),
          configPath: this.globalConfigPath,
        }
      );
    }
  }

  /**
   * 获取运行时配置快照信息
   * 委托给 RuntimeConfigSnapshot 模块，提供增强的快照元数据
   * @returns 运行时快照信息，包含 Hash、修订号和更新时间
   */
  getRuntimeSnapshot(): {
    hash: string;
    revision: number;
    updatedAt: number;
    fingerprint?: string;
    cacheKey?: string;
  } | null {
    const metadata = getRuntimeConfigSnapshotMetadata();
    if (!metadata && !this.configHash) {
      return null;
    }
    if (metadata) {
      return {
        hash: this.configHash ?? metadata.fingerprint,
        revision: metadata.revision,
        updatedAt: metadata.updatedAtMs,
        fingerprint: metadata.fingerprint,
        cacheKey: `runtime:${metadata.revision}:${metadata.fingerprint}`,
      };
    }
    return {
      hash: this.configHash!,
      revision: this.configHashRevision,
      updatedAt: this.lastHashCheckTime,
    };
  }

  /**
   * 从文件加载配置
   * @returns 全局配置
   */
  private loadConfigFromFile(): GlobalConfig {
    if (!this.configReadingAllowed && this.env('NODE_ENV') !== 'test') {
      logger.error('loadConfigFromFile 被禁止访问', {
        configReadingAllowed: this.configReadingAllowed,
        stack: new Error().stack?.split('\n').slice(2).join('\n'),
      });
      throw new AppError(
        '配置系统在启用前不可访问',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    try {
      const fileContent = readFileSync(this.globalConfigPath, 'utf-8');
      const parsedConfig = JSON.parse(fileContent);

      // 迁移配置
      const needPersistMigration = ConfigMigration.needsMigration(parsedConfig);
      const migratedConfig = ConfigMigration.migrate(parsedConfig);

      // 迁移落盘（一次性：仅当确实发生迁移，失败 WARN 不阻断启动）
      if (needPersistMigration) {
        try {
          this.atomicWriteConfig(migratedConfig as GlobalConfig);
          logger.info('配置迁移结果已落盘');
        } catch (migrateErr) {
          logger.warn('配置迁移落盘失败（不阻断启动），下次启动将重试', {
            error: String(migrateErr),
          });
        }
      }

      // 合并默认配置
      const config: GlobalConfig = {
        ...createDefaultGlobalConfig(),
        ...migratedConfig,
      };

      // 验证配置
      const validation = ConfigValidator.validate(config);
      if (!validation.valid) {
        logger.warn('配置验证失败，使用默认值修正', {
          errors: validation.errors,
        });
      }

      return config;
    } catch (error) {
      const errCode = (error as unknown as Record<string, unknown>)?.code;
      if (errCode === 'ENOENT') {
        logger.info('配置文件不存在，使用默认配置');
        return createDefaultGlobalConfig();
      }

      if (error instanceof SyntaxError) {
        logger.error('配置文件格式错误，尝试从快照恢复', error);
        // 备份损坏的配置
        this.backupCorruptedConfig();

        // 尝试从快照恢复
        const recovery = this.configRecovery.attemptRecovery();
        if (recovery.recovered && recovery.config) {
          const recoveredConfig: GlobalConfig = {
            ...createDefaultGlobalConfig(),
            ...(recovery.config as unknown as Partial<GlobalConfig>),
          };
          logger.warn('配置已从快照恢复，请检查配置完整性', {
            snapshotPath: recovery.snapshotPath,
          });
          return recoveredConfig;
        }

        logger.error('快照恢复失败，使用默认配置');
        if (recovery.error) {
          logger.warn('恢复错误详情', { error: recovery.error });
        }
        return createDefaultGlobalConfig();
      }

      throw error;
    }
  }

  /**
   * 保存全局配置
   * @param updater 配置更新函数
   */
  saveGlobalConfig(
    updater: (currentConfig: GlobalConfig) => GlobalConfig
  ): void {
    try {
      const currentConfig = this.getGlobalConfig();
      const newConfig = updater(currentConfig);

      // 如果没有变化，跳过保存
      if (newConfig === currentConfig) {
        return;
      }

      // 写入前创建快照
      this.configSnapshot.saveSnapshot(
        newConfig as unknown as Record<string, unknown>
      );

      // 原子写入
      this.atomicWriteConfig(newConfig);

      // 更新缓存和 Hash
      this.configCache = { config: newConfig, mtime: Date.now() };
      // 🔴 hash-debug: saveGlobalConfig 写入完成后更新内存 hash
      this.configHash = this.computeHash(
        newConfig,
        `saveGlobalConfig:postWrite#write=${(this.stats.writeCount ?? 0) + 1}`
      );
      this.lastHashCheckTime = Date.now();
      this.configHashRevision++;
      this.stats.writeCount++;
      this.stats.lastWriteTime = Date.now();

      // 同步运行时快照
      setRuntimeConfigSnapshot(newConfig);
    } catch (error) {
      void handleError(error, {
        module: 'config:manager',
        action: '保存配置失败',
      });
      throw error;
    }
  }

  /**
   * 原子修改配置 — 读 → 改 → 写校验 模式
   * 写入前对比文件 Hash，检测到外部修改时抛出 ConfigMutationConflictError
   * @param mutator 配置变异函数，接收当前配置的深拷贝（draft），修改 draft 后返回
   * @returns 修改后的配置
   * @throws ConfigMutationConflictError 当检测到外部修改时
   */
  mutateConfigFile(mutator: (draft: GlobalConfig) => void): GlobalConfig {
    const expectedHash = this.configHash;

    // 克隆当前配置作为 draft
    const draft: GlobalConfig = structuredClone(this.getGlobalConfig());

    // 应用变异
    mutator(draft);

    // 写入前验证文件未被外部修改 —— 重新读取文件并计算 Hash
    try {
      const fileContent = this.readConfigFileSnapshot();
      if (fileContent !== null) {
        const fileParsed: Record<string, unknown> = JSON.parse(fileContent);
        // 🔴 hash-debug: mutate 预检阶段 file 侧 hash（带 label，触发 stableStringify 归一化日志）
        const fileHash = this.computeHash(
          fileParsed,
          `mutateConfigFile:preCheck:file#expectedSeq=${this.configHashRevision}`
        );

        if (expectedHash !== null && fileHash !== expectedHash) {
          this.stats.hashMismatches = (this.stats.hashMismatches ?? 0) + 1;
          // 🔴 hash-debug (冲突)：输出内存 vs 文件的 leaf-type + 顶层 key 差异
          const memoryLeaves = this.configCache.config
            ? collectLeafTypes(this.configCache.config)
            : {};
          const fileLeaves = collectLeafTypes(fileParsed);
          const leafDiff = diffLeafTypes(memoryLeaves, fileLeaves, 50);
          const memoryKeys =
            this.configCache.config &&
            typeof this.configCache.config === 'object'
              ? Object.keys(
                  this.configCache.config as Record<string, unknown>
                ).sort()
              : [];
          const fileKeys = Object.keys(fileParsed).sort();
          logger.warn(
            '[hash-debug] mutateConfigFile: 预检冲突 — 配置自上次加载后已被外部修改，抛出 ConfigMutationConflictError',
            {
              expectedHash_full: expectedHash,
              actualHash_full: fileHash,
              fileRawSize: fileContent.length,
              topLevelKeysDelta: [
                ...memoryKeys
                  .filter((k) => !fileKeys.includes(k))
                  .map((k) => `-${k}(仅内存)`),
                ...fileKeys
                  .filter((k) => !memoryKeys.includes(k))
                  .map((k) => `+${k}(仅文件)`),
              ],
              leafTypeDiff_lines: leafDiff.lines,
              leafTypeDiff_truncatedCount: leafDiff.truncated,
              configPath: this.globalConfigPath,
              hashRevision: this.configHashRevision,
            }
          );
          throw new ConfigMutationConflictError(
            '配置自上次加载后已被外部修改，写入冲突',
            { expectedHash, actualHash: fileHash }
          );
        } else {
          logger.debug(
            '[hash-debug] mutateConfigFile: 预检通过（内存 hash 与文件 hash 一致）',
            {
              expectedHash_prefix: expectedHash
                ? `${expectedHash.slice(0, 8)}…${expectedHash.slice(-6)}`
                : 'null(expectedHash 未初始化，首次写入跳过)',
              actualHash_prefix: `${fileHash.slice(0, 8)}…${fileHash.slice(-6)}`,
              fileRawSize: fileContent.length,
              hashRevision: this.configHashRevision,
            }
          );
        }
      }
    } catch (error) {
      if (error instanceof ConfigMutationConflictError) {
        throw error;
      }
      logger.warn('[hash-debug] mutateConfigFile: 预检读盘异常，继续执行写入', {
        error:
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
      });
    }

    // 执行原子写入
    this.atomicWriteConfig(draft);

    // 更新缓存和 Hash
    this.configCache = { config: draft, mtime: Date.now() };
    // 🔴 hash-debug: mutate 写入完成后更新内存 hash
    this.configHash = this.computeHash(
      draft,
      `mutateConfigFile:applyDraft#write=${(this.stats.writeCount ?? 0) + 1}`
    );
    this.lastHashCheckTime = Date.now();
    this.configHashRevision++;
    this.stats.writeCount++;
    this.stats.lastWriteTime = Date.now();

    // 同步运行时快照
    setRuntimeConfigSnapshot(draft);

    logger.debug('配置原子修改完成');
    return draft;
  }

  /**
   * 原子写入配置
   * 使用唯一临时文件名（pid + timestamp），避免多进程冲突
   * 写入完成后通过 rename 实现原子替换
   * @param config 配置对象
   */
  private atomicWriteConfig(config: GlobalConfig): void {
    const lockPath = this.globalConfigPath + '.lock';

    // 获取文件锁
    this.configIO.acquireLock(lockPath);

    let tempPath = '';

    try {
      const configDir = dirname(this.globalConfigPath);

      // 确保目录存在
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      // 创建备份
      this.createBackup();

      // 写入临时文件（唯一名称，避免多进程冲突）
      tempPath = `${this.globalConfigPath}.tmp.${process.pid}.${Date.now()}`;
      const filteredConfig = this.filterDefaults(config);

      writeFileSync(tempPath, JSON.stringify(filteredConfig, null, 2), {
        encoding: 'utf-8',
        mode: 0o600, // 仅限所有者读写
      });

      // 原子重命名
      renameSync(tempPath, this.globalConfigPath);
    } catch (error) {
      // 清理临时文件
      if (tempPath && existsSync(tempPath)) {
        try {
          unlinkSync(tempPath);
        } catch (err) {
          // 忽略清理错误

          handleError(err, {
            module: 'config:ConfigManager',
            action: 'ignoreCleanupTempError',
          });
        }
      }
      throw error;
    } finally {
      // 释放文件锁
      this.configIO.releaseLock(lockPath);
    }

    // 清理旧备份移到锁外：清理仅删除旧文件，不涉及当前文件一致性，
    // 避免持锁期间执行 readdir/stat/unlink 拉长锁持有时间（并发写配置排队）。
    this.cleanupOldBackups();
  }

  /**
   * 过滤默认值
   * @param config 配置对象
   * @returns 过滤后的配置
   */
  private filterDefaults(config: GlobalConfig): Partial<GlobalConfig> {
    const defaultConfig = createDefaultGlobalConfig();
    const filtered: Partial<GlobalConfig> = {};

    for (const [key, value] of Object.entries(config)) {
      const defaultValue = (defaultConfig as Record<string, unknown>)[key];
      if (JSON.stringify(value) !== JSON.stringify(defaultValue)) {
        (filtered as Record<string, unknown>)[key] = value;
      }
    }

    return filtered;
  }

  /**
   * 创建配置备份
   */
  private createBackup(): void {
    if (!existsSync(this.globalConfigPath)) {
      return;
    }

    try {
      const backupDir = this.getConfigBackupDir();
      if (!existsSync(backupDir)) {
        mkdirSync(backupDir, { recursive: true });
      }

      const fileBase = basename(this.globalConfigPath);
      // 命名含 pid + 自增序号，避免同进程同毫秒多次写入覆盖同名备份
      const backupPath = join(
        backupDir,
        `${fileBase}.backup.${Date.now()}.${process.pid}.${++this.backupSeq}`
      );

      copyFileSync(this.globalConfigPath, backupPath);
    } catch (error) {
      logger.warn('创建配置备份失败', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 清理旧备份，只保留最近 5 个普通备份和 5 个损坏备份
   * - 普通备份与损坏备份分开保留：损坏备份是配置损坏时的现场证据，不被普通备份配额挤掉
   * - 仅处理普通文件（readdirSync withFileTypes + isFile），避免 unlink 目录抛错中断清理
   * - 排序含文件名 tie-break，避免同毫秒 mtime 相等时删除顺序不确定
   * - 在文件锁外调用（见 atomicWriteConfig），清理仅删旧文件，不涉及当前文件一致性
   */
  private cleanupOldBackups(): void {
    try {
      const backupDir = this.getConfigBackupDir();
      if (!existsSync(backupDir)) {
        return;
      }

      const fileBase = basename(this.globalConfigPath);
      const entries = readdirSync(backupDir, { withFileTypes: true });

      const backups = this.listBackups(entries, fileBase, '.backup.');
      const corrupted = this.listBackups(entries, fileBase, '.corrupted.');

      // 普通备份与损坏备份各自保留最近 5 个
      this.removeExcessBackups(backups, 5);
      this.removeExcessBackups(corrupted, 5);
    } catch (err) {
      // @ignore-catch: 备份清理失败不阻断（备份已创建，仅记录 WARN 供排查）
      logger.warn('清理旧备份失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 列出指定后缀的备份文件（仅普通文件），按时间倒序、文件名 tie-break
   */
  private listBackups(
    entries: import('fs').Dirent[],
    fileBase: string,
    suffix: string
  ): { p: string; name: string; mtimeMs: number }[] {
    return entries
      .filter((e) => e.isFile() && e.name.startsWith(fileBase + suffix))
      .map((e) => {
        const p = join(this.getConfigBackupDir(), e.name);
        return { p, name: e.name, mtimeMs: statSync(p).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  }

  /**
   * 删除超过保留上限的备份；单条删除失败不中断其余清理
   * （并发场景下文件可能已被其他进程删除，ENOENT 属正常）
   */
  private removeExcessBackups(
    backups: { p: string }[],
    keepCount: number
  ): void {
    for (const backup of backups.slice(keepCount)) {
      try {
        unlinkSync(backup.p);
      } catch {
        // @ignore-catch: 并发清理时文件可能已被其他进程删除（ENOENT），跳过继续
      }
    }
  }

  /**
   * 备份损坏的配置
   */
  private backupCorruptedConfig(): void {
    if (!existsSync(this.globalConfigPath)) {
      return;
    }

    try {
      const backupDir = this.getConfigBackupDir();
      if (!existsSync(backupDir)) {
        mkdirSync(backupDir, { recursive: true });
      }

      const fileBase = basename(this.globalConfigPath);
      // 命名含 pid + 自增序号，避免同进程同毫秒多次写入覆盖同名备份
      const corruptedPath = join(
        backupDir,
        `${fileBase}.corrupted.${Date.now()}.${process.pid}.${++this.backupSeq}`
      );

      copyFileSync(this.globalConfigPath, corruptedPath);
      // 损坏备份有独立保留配额（见 cleanupOldBackups），创建后同步清理避免无限累积
      this.cleanupOldBackups();
      logger.info(`损坏的配置已备份到: ${corruptedPath}`);
    } catch (error) {
      logger.warn('备份损坏配置失败', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 启动配置新鲜度监控
   */
  private startFreshnessWatcher(): void {
    if (this.freshnessWatcherStarted || this.env('NODE_ENV') === 'test') {
      return;
    }

    this.freshnessWatcherStarted = true;

    watchFile(
      this.globalConfigPath,
      { interval: this.CONFIG_FRESHNESS_POLL_MS, persistent: false },
      (curr) => {
        // 跳过自己的写入
        if (curr.mtimeMs <= this.configCache.mtime) {
          return;
        }

        try {
          const content = readFileSync(this.globalConfigPath, 'utf-8');
          const parsed = JSON.parse(content);

          const mergedConfig: GlobalConfig = {
            ...createDefaultGlobalConfig(),
            ...parsed,
          };

          this.configCache = {
            config: mergedConfig,
            mtime: curr.mtimeMs,
          };
          // 🔴 hash-debug: 文件监控检测到外部变更（非我们写入），更新内存 hash
          this.configHash = this.computeHash(
            mergedConfig,
            'freshnessWatcher:fileModified'
          );
          this.lastHashCheckTime = Date.now();
          this.configHashRevision++;
          setRuntimeConfigSnapshot(mergedConfig);
          logger.debug('文件监控检测到配置变更，已更新缓存和快照');
        } catch (err) {
          // 忽略读取错误

          handleError(err, {
            module: 'config:ConfigManager',
            action: 'ignoreReadError',
          });
        }
      }
    );
  }

  /**
   * 获取项目配置
   * @param projectPath 项目路径
   * @returns 项目配置
   */
  getProjectConfig(projectPath: string): ProjectConfig {
    const globalConfig = this.getGlobalConfig();

    if (!globalConfig.projects) {
      return { ...DEFAULT_PROJECT_CONFIG };
    }

    return globalConfig.projects[projectPath] ?? { ...DEFAULT_PROJECT_CONFIG };
  }

  /**
   * 保存项目配置
   * @param projectPath 项目路径
   * @param updater 配置更新函数
   */
  saveProjectConfig(
    projectPath: string,
    updater: (currentConfig: ProjectConfig) => ProjectConfig
  ): void {
    this.saveGlobalConfig((currentConfig) => {
      const currentProjectConfig = currentConfig.projects?.[projectPath] ?? {
        ...DEFAULT_PROJECT_CONFIG,
      };
      const newProjectConfig = updater(currentProjectConfig);

      // 如果没有变化，跳过保存
      if (newProjectConfig === currentProjectConfig) {
        return currentConfig;
      }

      return {
        ...currentConfig,
        projects: {
          ...currentConfig.projects,
          [projectPath]: newProjectConfig,
        },
      };
    });
  }

  /**
   * 通过点号路径获取配置值（支持嵌套存取）
   * @param key 点号路径，如 'models.current'
   * @param defaultValue 默认值
   */
  getValue<T = any>(key: string, defaultValue?: T): T | undefined {
    const parts = key.split('.');
    let current: unknown = this.getGlobalConfig();

    for (const part of parts) {
      if (
        current === null ||
        current === undefined ||
        typeof current !== 'object'
      ) {
        return defaultValue;
      }
      current = (current as Record<string, unknown>)[part];
    }

    if (current === undefined) {
      return defaultValue;
    }
    return current as T;
  }

  /**
   * 通过点号路径设置配置值（支持嵌套存取）
   * @param key 点号路径，如 'models.current'
   * @param value 要设置的值
   */
  setValue(key: string, value: unknown): void {
    const parts = key.split('.');
    this.saveGlobalConfig((config) => {
      const draft = { ...config } as typeof config;
      let current: Record<string, unknown> = draft;

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!(part in current) || typeof current[part] !== 'object') {
          current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
      }

      current[parts[parts.length - 1]] = value;
      return draft;
    });
  }

  /**
   * 获取配置值
   * @param key 配置键
   * @returns 配置值
   */
  getConfigValue<T = unknown>(key: string): T | undefined {
    const config = this.getGlobalConfig();
    if (key in config) {
      return config[key] as T | undefined;
    }
    // 点号路径回退：兼容 setValue（点号嵌套写入）的读取，统一读写语义
    return this.getValue<T>(key);
  }

  /**
   * 设置配置值
   * @param key 配置键
   * @param value 配置值
   */
  setConfigValue<T = unknown>(key: string, value: T): void {
    this.saveGlobalConfig((config) => ({
      ...config,
      [key]: value,
    }));
  }

  /**
   * 获取配置统计
   * @returns 配置统计信息
   */
  getStats(): ConfigStats {
    return { ...this.stats };
  }

  /**
   * 重置配置统计
   */
  resetStats(): void {
    this.stats = {
      readCount: 0,
      writeCount: 0,
      cacheHits: 0,
      cacheMisses: 0,
      hashChecks: 0,
      hashMismatches: 0,
    };
  }

  /**
   * 获取环境变量值（统一入口）
   *
   * 所有 process.env 读取应优先通过此方法访问，便于集中管理和审计。
   * 当前为轻量代理层，后续可扩展为支持默认值、类型转换、变量白名单等功能。
   *
   * @param name 环境变量名称
   * @param defaultValue 可选默认值
   */
  env(name: string, defaultValue?: string): string | undefined {
    return process.env[name] ?? defaultValue;
  }

  /**
   * 清除配置缓存和运行时快照
   */
  clearCache(): void {
    this.configCache = { config: null, mtime: 0 };
    this.configHash = null;
    this.lastHashCheckTime = 0;
    clearRuntimeConfigSnapshot();
    logger.debug('配置缓存已清除');
  }

  /**
   * 重新加载配置
   * @returns 重新加载的配置
   */
  reloadConfig(): GlobalConfig {
    this.clearCache();
    return this.getGlobalConfig();
  }

  /**
   * 重置配置为默认值
   */
  resetConfig(): void {
    const defaultConfig = createDefaultGlobalConfig();
    this.atomicWriteConfig(defaultConfig);
    this.configCache = { config: defaultConfig, mtime: Date.now() };
    // 🔴 hash-debug: resetConfig 重置为默认值后更新内存 hash
    this.configHash = this.computeHash(defaultConfig, 'resetConfig:toDefault');
    this.lastHashCheckTime = Date.now();
    this.configHashRevision++;
    setRuntimeConfigSnapshot(defaultConfig);
    logger.info('配置已重置为默认值');
  }

  // ========== 多源合并 ==========

  /**
   * 获取指定源的配置
   */
  getSourceConfig(source: string): Record<string, unknown> | undefined {
    return this.sourceConfigs.get(source);
  }

  /**
   * 设置指定源的配置
   */
  setSourceConfig(source: string, config: Record<string, unknown>): void {
    this.sourceConfigs.set(source, config);
    this.rebuildMergedConfig();
  }

  /**
   * 加载所有同步设置源
   * 优先级从低到高：userSettings < projectSettings < localSettings < flagSettings < policySettings
   */
  loadSyncSources(): void {
    this.sourceConfigs.set('userSettings', loadUserSettings());
    this.sourceConfigs.set('projectSettings', loadProjectSettings());
    this.sourceConfigs.set('localSettings', loadLocalSettings());
    this.sourceConfigs.set(
      'policySettings',
      isPolicySettingsAvailable() ? loadPolicySettings() : {}
    );
    this.rebuildMergedConfig();
  }

  /**
   * 刷新同步设置源
   */
  refreshSyncSources(): void {
    this.loadSyncSources();
  }

  /**
   * 获取合并后的多源配置
   */
  getMergedConfig(): Record<string, unknown> {
    return this.mergedCache;
  }

  /**
   * 重建合并配置
   * 按优先级合并各源：低优先级 < 高优先级
   */
  private rebuildMergedConfig(): void {
    let merged: Record<string, unknown> = {};

    for (const source of this.sourcePriority) {
      const config = this.sourceConfigs.get(source);
      if (config && Object.keys(config).length > 0) {
        merged = deepMerge(merged, config);
      }
    }

    this.mergedCache = merged;
  }

  /**
   * 获取设置值及其来源
   */
  getSettingWithSource(
    key: string
  ): { value: unknown; source: string } | undefined {
    const reversed = [...this.sourcePriority].reverse();

    for (const source of reversed) {
      const config = this.sourceConfigs.get(source);
      if (!config) continue;
      const keys = key.split('.');
      let current: Record<string, unknown> = config as Record<string, unknown>;
      let found = true;

      for (const k of keys) {
        if (
          current === null ||
          current === undefined ||
          typeof current !== 'object'
        ) {
          found = false;
          break;
        }
        current = current[k] as Record<string, unknown>;
      }

      if (found && current !== undefined) {
        return { value: current, source };
      }
    }

    return undefined;
  }

  // ========== 文件 I/O 委托（供 CliConfigManager 等外部模块使用） ==========

  /**
   * 读取任意 JSON 文件（使用文件锁）
   * @param filePath 文件路径
   * @returns 解析后的 JSON 对象，失败返回 null
   */
  readJsonFile(filePath: string): Record<string, unknown> | null {
    const lockPath = filePath + '.lock';
    this.configIO.acquireLock(lockPath);

    try {
      if (!existsSync(filePath)) {
        return null;
      }
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    } finally {
      this.configIO.releaseLock(lockPath);
    }
  }

  /**
   * 写入任意 JSON 文件（使用文件锁和原子写入）
   * @param filePath 文件路径
   * @param data JSON 数据
   */
  writeJsonFile(filePath: string, data: Record<string, unknown>): boolean {
    const lockPath = filePath + '.lock';
    const tempPath = filePath + '.tmp.' + process.pid + '.' + Date.now();

    if (!this.configIO.acquireLock(lockPath)) {
      return false;
    }

    try {
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(tempPath, JSON.stringify(data, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });
      renameSync(tempPath, filePath);
      return true;
    } catch (error) {
      try {
        if (existsSync(tempPath)) {
          unlinkSync(tempPath);
        }
      } catch (err) {
        // 忽略清理错误

        handleError(err, {
          module: 'config:ConfigManager',
          action: 'ignoreCleanupTempError',
        });
      }
      void handleError(error, {
        module: 'config:manager',
        action: 'JSON文件写入失败',
      });
      return false;
    } finally {
      this.configIO.releaseLock(lockPath);
    }
  }

  /**
   * 销毁配置管理器
   */
  destroy(): void {
    if (this.freshnessWatcherStarted) {
      unwatchFile(this.globalConfigPath);
      this.freshnessWatcherStarted = false;
    }
  }
}

let _configManager: ConfigManager | undefined;

/**
 * 获取全局 ConfigManager 单例（懒加载）
 * 避免模块加载时直接实例化导致的循环依赖 TDZ 问题
 */
export function getConfigManager(): ConfigManager {
  if (!_configManager) {
    _configManager = new ConfigManager();
  }
  return _configManager;
}

/**
 * 测试专用：替换全局 ConfigManager 实例。
 * 用于将全局配置指向独立临时路径，避免测试进程间共享 ~/.pyapp/config.json
 * 导致并发读写竞态（L4：workspace-trust-integration 全量偶发失败根因）。
 * 仅测试环境调用；生产路径不触发，行为零影响。
 */
export function setConfigManagerForTest(manager: ConfigManager): void {
  _configManager = manager;
}

// 使用 Proxy 保持向后兼容，所有现有 import { configManager } 仍可正常工作
export const configManager = new Proxy({} as ConfigManager, {
  get(_, prop: keyof ConfigManager) {
    const instance = getConfigManager();
    const value = instance[prop];
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
  set(_, prop: keyof ConfigManager, value) {
    (getConfigManager() as unknown as Record<string, unknown>)[prop] = value;
    return true;
  },
});
