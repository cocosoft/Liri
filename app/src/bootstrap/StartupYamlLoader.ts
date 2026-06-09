/**
 * startup.yaml 加载器
 * 提供纯内置 YAML 解析 + 文件加载 + 校验能力
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { Logger } from '../monitoring/logs/Logger.js';
import { configManager } from '@modules/config';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import type { StartupConfig, PluginSource } from './StartupConfig.js';
import { DEFAULT_STARTUP_CONFIG } from './StartupConfig.js';

const logger = new Logger({ level: 'info' as any });

/** 搜索路径优先级 */
const SEARCH_PATHS = ['.', 'config', 'conf'];

/** 文件名候选 */
const FILE_NAMES = ['startup.yaml', 'startup.yml'];

/**
 * YAML 解析错误
 */
export class YamlParseError extends AppError {
  constructor(message: string, line?: number) {
    super(line !== undefined ? `第 ${line} 行: ${message}` : message, ErrorCategory.CONFIGURATION, ErrorSeverity.HIGH);
    this.name = 'YamlParseError';
  }
}

/**
 * 启动配置加载结果
 */
export interface StartupLoadResult {
  config: StartupConfig;
  sourcePath: string | null;
  found: boolean;
  parseErrors: string[];
}

// ============================================================
// YAML 解析器（纯内置实现，支持嵌套/数组/多行）
// ============================================================

interface YamlToken {
  indent: number;
  key: string;
  value: string;
  isArray: boolean;
  line: number;
}

/**
 * YAML 词法分析：将 YAML 文本拆解为扁平 Token 序列
 */
function tokenize(content: string): YamlToken[] {
  const tokens: YamlToken[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const stripped = rawLine.trim();

    // 跳过空行和注释
    if (!stripped || stripped.startsWith('#')) continue;

    // 计算缩进（仅空格）
    const indent = rawLine.length - rawLine.trimStart().length;

    // 数组项：以 "- " 开头
    if (stripped.startsWith('- ')) {
      const arrayContent = stripped.slice(2).trim();
      const colonIdx = findColon(arrayContent);

      if (colonIdx >= 0) {
        const key = arrayContent.slice(0, colonIdx).trim();
        const value = arrayContent.slice(colonIdx + 1).trim();
        tokens.push({
          indent: indent + 2,
          key,
          value,
          isArray: false,
          line: i + 1,
        });
      } else {
        // 纯数组值
        tokens.push({
          indent,
          key: '',
          value: arrayContent,
          isArray: true,
          line: i + 1,
        });
      }
      continue;
    }

    // 普通键值对
    const colonIdx = findColon(stripped);
    if (colonIdx < 0) continue;

    const key = stripped.slice(0, colonIdx).trim();
    const value = stripped.slice(colonIdx + 1).trim();

    tokens.push({ indent, key, value, isArray: false, line: i + 1 });
  }

  return tokens;
}

/**
 * 查找主冒号位置（跳过引号内的冒号）
 */
function findColon(line: string): number {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ':' && !inSingle && !inDouble) return i;
  }

  return -1;
}

/**
 * 将 Token 序列构建为嵌套对象
 */
function buildTree(tokens: YamlToken[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; obj: Record<string, unknown> }> = [
    { indent: -1, obj: root },
  ];

  for (const token of tokens) {
    // 弹出缩进更大的层级
    while (stack.length > 1 && token.indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1].obj;

    if (token.isArray) {
      // 纯数组值
      ensureArray(current, '__array__').push(parseScalar(token.value));
      continue;
    }

    // 有值 => 标量
    if (token.value !== '' && token.value !== '|' && token.value !== '>') {
      current[token.key] = parseScalar(token.value);
      continue;
    }

    // 无值或块指示符 => 嵌套对象
    const nested: Record<string, unknown> = {};
    current[token.key] = nested;
    stack.push({ indent: token.indent, obj: nested });
  }

  return root;
}

/**
 * 确保对象中指定键为数组
 */
function ensureArray(obj: Record<string, unknown>, key: string): unknown[] {
  if (!Array.isArray(obj[key])) {
    obj[key] = [];
  }
  return obj[key] as unknown[];
}

/**
 * 解析 YAML 标量值
 */
function parseScalar(value: string): unknown {
  const trimmed = value.trim();

  // 空值
  if (!trimmed) return null;

  // null
  if (trimmed === 'null' || trimmed === '~') return null;

  // 布尔
  if (trimmed === 'true' || trimmed === 'yes' || trimmed === 'on') return true;
  if (trimmed === 'false' || trimmed === 'no' || trimmed === 'off')
    return false;

  // 数字
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== '' && !isHexColor(trimmed)) return num;

  // 去除引号
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

/**
 * 检查是否为十六进制颜色（避免将 #abc123 解析为 NaN）
 */
function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(value);
}

/**
 * 将数组展平：将 __array__ 结构的嵌套对象转为数组
 */
function normalizeArrays(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key === '__array__') {
      continue;
    }

    if (Array.isArray(value)) {
      result[key] = value;
    } else if (value && typeof value === 'object') {
      const nested = value as Record<string, unknown>;

      // 检测是否为数组结构（只有 __array__ 键的对象）
      if (Object.keys(nested).length === 1 && '__array__' in nested) {
        result[key] = nested.__array__;
      } else {
        // 递归检测子对象中是否有数组
        const childHasArray = Object.values(nested).some(
          (v) =>
            v &&
            typeof v === 'object' &&
            '__array__' in (v as Record<string, unknown>)
        );

        if (childHasArray) {
          result[key] = normalizeArrays(nested);

          // 再次检查是否变成纯数组
          const normalized = result[key] as Record<string, unknown>;
          if (
            Object.keys(normalized).length === 1 &&
            '__array__' in normalized
          ) {
            result[key] = normalized.__array__;
          }
        } else {
          result[key] = normalizeArrays(nested);
        }
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * 将后处理数组项合并：将纯数组值归入最近的父数组
 * 例如：
 *   channels:
 *     - websocket
 *     - telegram
 */
function postProcessArrays(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        result[key] = value;
      } else {
        const nested = postProcessArrays(value as Record<string, unknown>);
        result[key] = nested;
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * 解析 YAML 文本为通用对象
 */
export function parseYaml(content: string): Record<string, unknown> {
  const tokens = tokenize(content);
  const tree = buildTree(tokens);
  const normalized = normalizeArrays(postProcessArrays(tree));
  return normalized;
}

// ============================================================
// 启动配置加载器
// ============================================================

/**
 * 搜索 startup.yaml 文件
 */
function findStartupFile(): string | null {
  const cwd = configManager.env('LIRI_PROJECT_DIR') || process.cwd();

  for (const dir of SEARCH_PATHS) {
    for (const name of FILE_NAMES) {
      const fullPath = join(cwd, dir, name);
      if (existsSync(fullPath)) {
        return resolve(fullPath);
      }
    }
  }

  return null;
}

/**
 * 校验必填字段
 */
function validateConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (raw.mode !== undefined) {
    const validModes = ['cli', 'repl', 'mcp', 'daemon'];
    if (!validModes.includes(String(raw.mode))) {
      errors.push(
        `无效的 mode 值: "${raw.mode}"，有效值: ${validModes.join(', ')}`
      );
    }
  }

  if (
    raw.version !== undefined &&
    (typeof raw.version !== 'number' || raw.version < 1)
  ) {
    errors.push('version 必须为正整数');
  }

  if (raw.debug !== undefined && typeof raw.debug !== 'boolean') {
    errors.push('debug 必须为布尔值');
  }

  if (raw.verbose !== undefined && typeof raw.verbose !== 'boolean') {
    errors.push('verbose 必须为布尔值');
  }

  return errors;
}

/**
 * 将解析后的对象合并到默认配置
 */
function mergeWithDefault(parsed: Record<string, unknown>): StartupConfig {
  const config = { ...DEFAULT_STARTUP_CONFIG };

  if (typeof parsed.version === 'number') config.version = parsed.version;
  if (typeof parsed.mode === 'string')
    config.mode = parsed.mode as StartupConfig['mode'];
  if (typeof parsed.debug === 'boolean') config.debug = parsed.debug;
  if (typeof parsed.verbose === 'boolean') config.verbose = parsed.verbose;

  if (parsed.modules && typeof parsed.modules === 'object') {
    const m = parsed.modules as Record<string, unknown>;
    const modulesConfig = config.modules as NonNullable<
      StartupConfig['modules']
    >;
    if (Array.isArray(m.enabled)) modulesConfig.enabled = m.enabled as string[];
    if (Array.isArray(m.disabled))
      modulesConfig.disabled = m.disabled as string[];
  }

  if (parsed.plugins && typeof parsed.plugins === 'object') {
    const p = parsed.plugins as Record<string, unknown>;
    const pluginsConfig = config.plugins as NonNullable<
      StartupConfig['plugins']
    >;
    if (typeof p.autoLoad === 'boolean') pluginsConfig.autoLoad = p.autoLoad;
    if (Array.isArray(p.allowedSources))
      pluginsConfig.allowedSources = p.allowedSources as PluginSource[];
    if (Array.isArray(p.blacklist))
      pluginsConfig.blacklist = p.blacklist as string[];
  }

  if (parsed.gateway && typeof parsed.gateway === 'object') {
    const g = parsed.gateway as Record<string, unknown>;
    const gatewayConfig = config.gateway as NonNullable<
      StartupConfig['gateway']
    >;
    if (Array.isArray(g.enabledChannels))
      gatewayConfig.enabledChannels = g.enabledChannels as string[];
    if (Array.isArray(g.disabledChannels))
      gatewayConfig.disabledChannels = g.disabledChannels as string[];
    if (g.websocket && typeof g.websocket === 'object') {
      const ws = g.websocket as Record<string, unknown>;
      const wsConfig = gatewayConfig.websocket as NonNullable<
        typeof gatewayConfig.websocket
      >;
      if (typeof ws.enabled === 'boolean') wsConfig.enabled = ws.enabled;
      if (typeof ws.port === 'number') wsConfig.port = ws.port;
    }
  }

  if (parsed.ai && typeof parsed.ai === 'object') {
    const a = parsed.ai as Record<string, unknown>;
    const c = config as any;
    if (typeof a.provider === 'string') c.ai.provider = a.provider;
    if (typeof a.model === 'string') c.ai.model = a.model;
    if (typeof a.baseUrl === 'string') c.ai.baseUrl = a.baseUrl;
  }

  if (parsed.features && typeof parsed.features === 'object') {
    const f = parsed.features as Record<string, unknown>;
    const c = config as any;
    if (typeof f.autoCompact === 'boolean')
      c.features.autoCompact = f.autoCompact;
    if (typeof f.telemetry === 'boolean') c.features.telemetry = f.telemetry;
    if (typeof f.fileCheckpointing === 'boolean')
      c.features.fileCheckpointing = f.fileCheckpointing;
    if (typeof f.terminalProgressBar === 'boolean')
      c.features.terminalProgressBar = f.terminalProgressBar;
  }

  if (parsed.performance && typeof parsed.performance === 'object') {
    const perf = parsed.performance as Record<string, unknown>;
    const c = config as any;
    if (typeof perf.startupTimeoutMs === 'number')
      c.performance.startupTimeoutMs = perf.startupTimeoutMs;
    if (typeof perf.deferredPrefetch === 'boolean')
      c.performance.deferredPrefetch = perf.deferredPrefetch;
  }

  if (parsed.security && typeof parsed.security === 'object') {
    const s = parsed.security as Record<string, unknown>;
    const c = config as any;
    if (typeof s.sandboxIsolation === 'string')
      c.security.sandboxIsolation = s.sandboxIsolation;
    if (typeof s.mtlsEnabled === 'boolean')
      c.security.mtlsEnabled = s.mtlsEnabled;
    if (typeof s.permissionLevel === 'string')
      c.security.permissionLevel = s.permissionLevel;
  }

  return config;
}

/**
 * 加载 startup.yaml 配置
 * 按优先级搜索路径：当前目录 → config/ → conf/
 */
export function loadStartupConfig(): StartupLoadResult {
  const result: StartupLoadResult = {
    config: { ...DEFAULT_STARTUP_CONFIG },
    sourcePath: null,
    found: false,
    parseErrors: [],
  };

  try {
    const filePath = findStartupFile();

    if (!filePath) {
      logger.info('未找到 startup.yaml，使用默认配置');
      return result;
    }

    const content = readFileSync(filePath, 'utf-8');
    const parsed = parseYaml(content);
    const errors = validateConfig(parsed);

    result.sourcePath = filePath;
    result.found = true;
    result.parseErrors = errors;

    if (errors.length > 0) {
      logger.warning('startup.yaml 配置校验发现警告', { errors });
    }

    result.config = mergeWithDefault(parsed);
    logger.info(`已加载启动配置: ${filePath}`, {
      mode: result.config.mode,
      hasModules: (result.config.modules?.enabled?.length ?? 0) > 0,
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.parseErrors = [message];
    logger.error('加载 startup.yaml 失败', { error: message });
    return result;
  }
}

/**
 * 获取启动配置的简短摘要
 */
export function formatConfigSummary(config: StartupConfig): string {
  const parts: string[] = [
    `mode=${config.mode}`,
    `debug=${config.debug}`,
    `verbose=${config.verbose}`,
  ];

  if (
    config.modules &&
    config.modules.enabled &&
    config.modules.enabled.length > 0
  ) {
    parts.push(`modules=[${config.modules.enabled.join(',')}]`);
  }

  if (
    config.gateway &&
    config.gateway.enabledChannels &&
    config.gateway.enabledChannels.length > 0
  ) {
    parts.push(`gateway=[${config.gateway.enabledChannels.join(',')}]`);
  }

  if (config.ai) {
    parts.push(`ai=${config.ai.provider}/${config.ai.model}`);
  }

  return parts.join(' | ');
}
