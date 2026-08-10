// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * AI 输出文本中路径引用的事后校验服务（方案 1 核心实现）
 *
 * 在 AI 流式输出完成后，提取文本中的路径引用并校验其真实性。
 * 与方案 2（HARD CONSTRAINT 提示词）、方案 4（SessionConfirmedPaths）联动。
 *
 * 设计要点：
 * - 异步批处理：积攒完整文本后统一校验，不阻塞事件循环
 * - Worktree 感知：识别 worktree 路径并标记
 * - 并发限制：超过 10 个候选路径时分批执行
 * - 异常降级：单个路径校验失败不影响其他路径
 */
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { PROJECT_ROOT, LIRI_HOME } from '@modules/core/paths';
import type { SessionConfirmedPaths } from './SessionConfirmedPaths';
import { defaultWhitelist } from './PathWhitelist';

const guardLogger = getLogger('ai:path-guard');

// ============================================================
// 路径正则（模块级常量）
// ============================================================

const PATH_PATTERNS = {
  winAbs:
    /[A-Za-z]:[\\/](?:[^\s"'`<>|?*]+\\)*[^\s"'`<>|?*:]*(\.[a-zA-Z0-9]+)?/g,
  unixAbs: /(?<![a-zA-Z0-9])\/(?:[^\s"'`]+\/)+[^\s"'`]*(\.[a-zA-Z0-9]+)?/g,
  noExt: /(?:(?:from|import|require)\s+['"]|['"])(\.{0,2}\/[^\s"'`]+)(?:['"])/g,
  unc: /\\\\[^\\\s"'`<>|?*]+\\[^\\\s"'`<>|?*]+(?:\\[^\s"'`<>|?*]*)*/g,
  worktree: /\b(?:worktrees|.+-worktree)\b/i,
  aiMarkedNewFile: /\(新文件\)/g,
};

// ============================================================
// 路径校验缓存（LRU）
// ============================================================

const pathCheckCache = new Map<string, { result: boolean; ts: number }>();
const CACHE_MAX_SIZE = 200;
const CACHE_TTL_MS = 30_000;

function addToCache(key: string, result: boolean): void {
  if (pathCheckCache.size >= CACHE_MAX_SIZE) {
    const oldest = pathCheckCache.keys().next().value;
    if (oldest !== undefined) pathCheckCache.delete(oldest);
  }
  pathCheckCache.set(key, { result, ts: Date.now() });
}

// ============================================================
// Worktree 上下文
// ============================================================

let _currentWorktreeDir: string | null = null;

/** 由 BridgeMain / ChatManager 在 worktree 切换时调用 */
export function setCurrentWorktreeDir(dir: string | null): void {
  _currentWorktreeDir = dir;
}

// ============================================================
// 可观测性指标（方案 3 — 可观测性）
// ============================================================

interface ModelMetrics {
  calls: number;
  hallucinations: number;
}

function createEmptyMetrics() {
  return {
    totalCalls: 0,
    totalPaths: 0,
    hallucinatedCount: 0,
    newFileCount: 0,
    restrictedCount: 0,
    unknownCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    byModel: new Map<string, ModelMetrics>(),
  };
}

let _metrics: ReturnType<typeof createEmptyMetrics> | null = null;

function getMetrics() {
  if (!_metrics) _metrics = createEmptyMetrics();
  return _metrics;
}

export function getPathGuardMetrics() {
  const m = getMetrics();
  return {
    totalCalls: m.totalCalls,
    totalPaths: m.totalPaths,
    hallucinatedCount: m.hallucinatedCount,
    newFileCount: m.newFileCount,
    restrictedCount: m.restrictedCount,
    unknownCount: m.unknownCount,
    cacheHits: m.cacheHits,
    cacheMisses: m.cacheMisses,
    hallucinationRate:
      m.totalPaths > 0
        ? `${((m.hallucinatedCount / m.totalPaths) * 100).toFixed(1)}%`
        : '0%',
    cacheHitRate:
      m.cacheHits + m.cacheMisses > 0
        ? `${((m.cacheHits / (m.cacheHits + m.cacheMisses)) * 100).toFixed(1)}%`
        : '0%',
    byModel: Object.fromEntries(m.byModel),
  };
}

export function resetPathGuardMetrics(): void {
  _metrics = null;
}

/** 记录本次校验结果到指标 */
function recordMetrics(
  result: ValidatePathsResult,
  candidateCount: number,
  modelId?: string
): void {
  const m = getMetrics();
  m.totalCalls++;
  m.totalPaths += candidateCount;
  for (const c of result.corrections) {
    switch (c.status) {
      case 'hallucinated':
        m.hallucinatedCount++;
        if (modelId) {
          let entry = m.byModel.get(modelId);
          if (!entry) {
            entry = { calls: 0, hallucinations: 0 };
            m.byModel.set(modelId, entry);
          }
          entry.calls++;
          entry.hallucinations++;
        }
        break;
      case 'new_file':
        m.newFileCount++;
        break;
      case 'restricted':
        m.restrictedCount++;
        break;
      case 'unknown':
        m.unknownCount++;
        break;
    }
  }
  // 按模型统计调用（即使没有幻觉也记录）
  if (modelId) {
    let entry = m.byModel.get(modelId);
    if (!entry) {
      entry = { calls: 0, hallucinations: 0 };
      m.byModel.set(modelId, entry);
    }
    entry.calls++;
  }
}

/** 记录缓存命中 */
export function recordCacheHit(): void {
  getMetrics().cacheHits++;
}

/** 记录缓存未命中 */
export function recordCacheMiss(): void {
  getMetrics().cacheMisses++;
}

function getCurrentWorktreeDir(): string | null {
  return _currentWorktreeDir;
}

// ============================================================
// Guard 旁路开关
// ============================================================

let _guardBypass: boolean | 'dry-run' = false;

/** 设置 guard 模式：true=完全跳过, 'dry-run'=只检测不修改文本 */
export function setGuardBypass(mode: boolean | 'dry-run'): void {
  _guardBypass = mode;
}

export function getGuardBypass(): boolean | 'dry-run' {
  return _guardBypass;
}

// ============================================================
// 路径别名解析
// ============================================================

function getPathAliasMap(): Record<string, string> {
  const projectRoot = PROJECT_ROOT;
  const pyappHome = LIRI_HOME;
  return {
    '@modules/': path.join(projectRoot, 'app', 'src'),
    '@/': path.join(projectRoot, 'app', 'src'),
    '~/': pyappHome,
  };
}

/**
 * 解析路径别名 → 实际文件系统路径
 * Worktree 优先：@/foo → <worktreeDir>/app/src/foo
 */
function resolveAlias(pathLike: string): string {
  const worktreeDir = getCurrentWorktreeDir();

  if (worktreeDir) {
    if (pathLike.startsWith('@modules/') || pathLike.startsWith('@/')) {
      const relativePart = pathLike.replace(/^@(?:modules\/)?/, '');
      const worktreePath = path.join(worktreeDir, 'app', 'src', relativePart);
      if (existsSync(worktreePath)) {
        return worktreePath;
      }
    }
    if (pathLike.startsWith('~/')) {
      const relativePart = pathLike.slice(2);
      const worktreePath = path.join(worktreeDir, relativePart);
      if (existsSync(worktreePath)) {
        return worktreePath;
      }
    }
  }

  const aliasMap = getPathAliasMap();
  for (const [alias, realPath] of Object.entries(aliasMap)) {
    if (pathLike.startsWith(alias)) {
      return pathLike.replace(alias, realPath);
    }
  }

  if (pathLike.startsWith('~/') || pathLike === '~') {
    return path.join(homedir(), pathLike.slice(1));
  }
  return pathLike;
}

// ============================================================
// 路径归一化
// ============================================================

function normalizePath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

// ============================================================
// 异步路径校验（带缓存）
// ============================================================

async function checkPathExistsWithCache(p: string): Promise<boolean> {
  const now = Date.now();
  const cached = pathCheckCache.get(p);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    recordCacheHit();
    return cached.result;
  }

  recordCacheMiss();
  const otel = getOTelTracing();
  const span = otel.startSpan('PathGuard.fsAccess', {
    path: p,
    'path.cached': false,
  });
  try {
    await fs.access(p, fs.constants.F_OK);
    addToCache(p, true);
    return true;
  } catch (err) {
    addToCache(p, false);
    return false;
  } finally {
    otel.endSpan(span);
  }
}

// ============================================================
// 类型
// ============================================================

export interface PathCorrection {
  original: string;
  resolved: string;
  status:
    | 'confirmed'
    | 'exists'
    | 'new_file'
    | 'hallucinated'
    | 'unknown'
    | 'restricted';
  startOffset: number;
  endOffset: number;
  context?: string;
  isWorktreePath?: boolean;
}

export interface ValidatePathsResult {
  text: string;
  corrections: PathCorrection[];
}

interface ValidateOptions {
  confirmedPaths?: Set<string>;
  newFileIndicators?: RegExp;
}

// ============================================================
// 单路径校验
// ============================================================

async function validateOneCandidate(
  m: RegExpMatchArray,
  text: string,
  options?: ValidateOptions
): Promise<{
  rawPath: string;
  resolvedPath: string;
  status: PathCorrection['status'];
}> {
  const rawPath = m[0];
  try {
    const resolvedPath = resolveAlias(rawPath);
    const normalized = normalizePath(rawPath);

    // 方案 4 联动：已确认集合
    if (
      options?.confirmedPaths?.has(normalized) ||
      options?.confirmedPaths?.has(normalizePath(resolvedPath))
    ) {
      return { rawPath, resolvedPath, status: 'confirmed' };
    }

    const context = text.substring(Math.max(0, m.index! - 80), m.index!);

    // 方案 2 联动：(新文件) 标注 → 跳过 I/O
    if (PATH_PATTERNS.aiMarkedNewFile.test(context)) {
      return { rawPath, resolvedPath, status: 'new_file' };
    }

    // 异步校验（带 LRU 缓存）
    const exists = await checkPathExistsWithCache(resolvedPath);
    if (exists) {
      // 白名单检查（方案 3）：文件存在但不在允许范围内 → restricted
      try {
        if (!defaultWhitelist.isAllowed(resolvedPath)) {
          return { rawPath, resolvedPath, status: 'restricted' };
        }
      } catch (err) {
        // 白名单模块加载失败时静默跳过
      }
      return { rawPath, resolvedPath, status: 'exists' };
    }

    // 上下文语义判断
    const newFilePattern =
      options?.newFileIndicators ??
      /(?:\(新文件\)|建议(?!\w)|推荐(?!\w)|新建(?!\w)|创建(?!\w)|可以放在|放到|移动到)/i;
    if (newFilePattern.test(context)) {
      return { rawPath, resolvedPath, status: 'new_file' };
    }

    return { rawPath, resolvedPath, status: 'hallucinated' };
  } catch (err) {
    guardLogger.warn('路径校验异常，降级为 unknown', { path: rawPath });
    return { rawPath, resolvedPath: rawPath, status: 'unknown' };
  }
}

type Candidate = RegExpMatchArray & { type: string };

/** 将 matchAll 结果包装为 Candidate */
function toCandidate(m: RegExpMatchArray, type: string): Candidate {
  const c = m as Candidate;
  c.type = type;
  return c;
}

// ============================================================
// 构建纠正结果
// ============================================================

function buildCorrections(
  text: string,
  candidates: Candidate[],
  results: Array<{
    rawPath: string;
    resolvedPath: string;
    status: PathCorrection['status'];
  }>
): ValidatePathsResult {
  const corrections: PathCorrection[] = [];
  let correctedText = text;

  const sortedResults = results
    .map((r, i) => ({
      ...r,
      index: candidates[i].index!,
      length: candidates[i][0].length,
      context: text.substring(
        Math.max(0, candidates[i].index! - 40),
        Math.min(
          text.length,
          candidates[i].index! + candidates[i][0].length + 40
        )
      ),
      isWorktreePath: PATH_PATTERNS.worktree.test(r.resolvedPath),
    }))
    .filter(
      (r) =>
        r.status === 'hallucinated' ||
        r.status === 'new_file' ||
        r.status === 'restricted'
    )
    .sort((a, b) => b.index - a.index);

  for (const r of sortedResults) {
    let tag: string;
    if (r.status === 'hallucinated') {
      tag = r.isWorktreePath ? ' [Worktree 路径可能已变更]' : ' [路径不存在]';
    } else if (r.status === 'restricted') {
      tag = ' [目录不在AI可引用范围]';
    } else {
      tag = ' [新路径]';
    }
    correctedText =
      correctedText.slice(0, r.index + r.length) +
      tag +
      correctedText.slice(r.index + r.length);
    corrections.push({
      original: r.rawPath,
      resolved: r.resolvedPath,
      status: r.status,
      startOffset: r.index,
      endOffset: r.index + r.length,
      context: r.context,
      isWorktreePath: r.isWorktreePath,
    });
  }

  const hallucinatedCount = corrections.filter(
    (c) => c.status === 'hallucinated'
  ).length;
  if (hallucinatedCount > 0) {
    guardLogger.info('检测到路径幻觉', {
      hallucinatedCount,
      totalPaths: candidates.length,
    });
  }

  const unknownCount = results.filter((r) => r.status === 'unknown').length;
  const unknownRatio =
    candidates.length > 0 ? unknownCount / candidates.length : 0;
  if (unknownRatio > 0.3 && unknownCount >= 3) {
    guardLogger.warn('大量路径校验降级为 unknown（可能磁盘故障或权限异常）', {
      unknownCount,
      totalPaths: candidates.length,
      unknownRatio: `${(unknownRatio * 100).toFixed(1)}%`,
    });
  }

  // 可观测性：记录本次校验结果
  recordMetrics({ text: correctedText, corrections }, candidates.length);

  return { text: correctedText, corrections };
}

// ============================================================
// 无并发限制的直接处理
// ============================================================

async function processCandidates(
  candidates: Candidate[],
  text: string,
  options?: ValidateOptions
): Promise<ValidatePathsResult> {
  const results = await Promise.all(
    candidates.map((m) => validateOneCandidate(m, text, options))
  );
  return buildCorrections(text, candidates, results);
}

// ============================================================
// 分批处理（限制并发 I/O）
// ============================================================

async function processCandidatesBatched(
  candidates: Candidate[],
  text: string,
  options: ValidateOptions | undefined,
  batchSize: number
): Promise<ValidatePathsResult> {
  const results: Array<{
    rawPath: string;
    resolvedPath: string;
    status: PathCorrection['status'];
  }> = [];

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((m) => validateOneCandidate(m, text, options))
    );
    results.push(...batchResults);
  }

  return buildCorrections(text, candidates, results);
}

// ============================================================
// 主入口
// ============================================================

/**
 * 批量校验输出文本中的路径引用
 *
 * @param text AI 输出的完整文本
 * @param confirmedPaths 方案 4 提供的已确认路径集合（来自 SessionConfirmedPaths）
 * @param options 可选配置
 * @returns 纠正后文本 + 修正详情列表
 */
export async function validatePathsInOutput(
  text: string,
  confirmedPaths?: SessionConfirmedPaths,
  options?: ValidateOptions
): Promise<ValidatePathsResult> {
  if (_guardBypass === true) {
    return { text, corrections: [] };
  }

  const otel = getOTelTracing();

  const candidates: Candidate[] = [
    ...[...text.matchAll(PATH_PATTERNS.winAbs)].map((m) =>
      toCandidate(m, 'win')
    ),
    ...[...text.matchAll(PATH_PATTERNS.unixAbs)].map((m) =>
      toCandidate(m, 'unix')
    ),
    ...[...text.matchAll(PATH_PATTERNS.noExt)].map((m) =>
      toCandidate(m, 'noext')
    ),
    ...[...text.matchAll(PATH_PATTERNS.unc)].map((m) => toCandidate(m, 'unc')),
  ].filter((m) => m[0] && m[0].length > 0);

  if (candidates.length === 0) {
    return { text, corrections: [] };
  }

  const span = otel.startSpan('PathGuard.validate', {
    'path.count': candidates.length,
    'path.textLength': text.length,
  });

  try {
    const mergedOptions: ValidateOptions = {
      ...options,
      confirmedPaths: confirmedPaths?.getConfirmedPaths(),
    };

    // dry-run：执行校验但不修改文本
    if (_guardBypass === 'dry-run') {
      const result =
        candidates.length <= 10
          ? await processCandidates(candidates, text, mergedOptions)
          : await processCandidatesBatched(candidates, text, mergedOptions, 10);
      return { text, corrections: result.corrections };
    }

    const MAX_CONCURRENT = 10;
    if (candidates.length <= MAX_CONCURRENT) {
      return await processCandidates(candidates, text, mergedOptions);
    }
    return await processCandidatesBatched(
      candidates,
      text,
      mergedOptions,
      MAX_CONCURRENT
    );
  } finally {
    otel.endSpan(span);
  }
}

/**
 * 清理路径校验缓存（会话切换时调用）
 */
export function clearPathCheckCache(): void {
  pathCheckCache.clear();
}
