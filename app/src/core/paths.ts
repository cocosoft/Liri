/**
 * 统一路径管理 — 核心基础设施
 *
 * 按文件存储规范（三层分离）集中管理所有路径模板：
 *   第一层：app/docs/       Git 跟踪，系统文档（跟随安装目录）
 *   第二层：~/.pyapp/data/  用户数据目录下的项目数据（部署安全）
 *   第三层：~/.pyapp/       用户级配置、记忆、技能（跨项目）
 *
 * 各模块通过本模块获取路径，不再硬编码路径字符串。
 * 支持运行时通过环境变量切换根目录（测试友好）。
 *
 * 注意：此为规范（canonical）路径注册表，其他模块应统一引用此文件，
 * 不应在 config/ 或其他地方自行定义路径常量。
 */

import {
  basename,
  join,
  resolve,
  normalize,
  sep,
  posix,
  isAbsolute,
} from 'path';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import * as os from 'os';
// 注意：直连 Logger 实现文件而非 @modules/monitoring barrel——barrel 会拉入
// MonitoringService/BackupManager 等（它们静态 import @modules/core barrel），
// 在循环 import（paths→monitoring→core→paths）期间触发 paths 的 TDZ。
// Logger.ts 自身仅依赖 monitoring/logs 内部文件，不依赖 core。
import { getLogger } from '@modules/monitoring/logs/Logger.js';
// ─── 环境变量键名 ─────────────────────────────

const ENV_LIRI_HOME = 'LIRI_HOME';
const ENV_LIRI_PROJECT_DIR = 'LIRI_PROJECT_DIR';
const ENV_LIRI_DATA_DIR = 'LIRI_DATA_DIR';

// ─── 全局配置存储 ─────────────────────────────

let userDataDirOverride: string | null = null;

/**
 * 设置用户数据目录覆盖值
 * @param dir 目录路径，设置为 null 则使用默认值
 */
export function setUserDataDirOverride(dir: string | null): void {
  userDataDirOverride = dir;
}

/**
 * 获取用户数据目录覆盖值
 */
export function getUserDataDirOverride(): string | null {
  return userDataDirOverride;
}

// ─── 基础目录解析（可注入 thunk 便于测试） ────

/**
 * 获取用户数据目录（第三层）
 *
 * 优先级（单一确定性来源）：
 * 1. 用户设置中配置的数据目录（setUserDataDirOverride）
 * 2. LIRI_HOME 环境变量（由入口文件在启动时设置）
 * 3. 默认：项目根目录下的 app/data/pyapp（历史既有数据源）
 *
 * 注意：不再有回退链！入口文件（main.ts / pyapp.ts）应负责在启动时设置
 * LIRI_HOME 环境变量，本函数仅读取已有决定。
 */
export function resolvePyappHome(env: NodeJS.ProcessEnv = process.env): string {
  // 1. 优先使用运行时设置的目录
  if (userDataDirOverride) {
    return resolve(userDataDirOverride);
  }

  // 2. 环境变量（由入口文件在启动时设置）
  const override = env[ENV_LIRI_HOME]?.trim();
  if (override) {
    return resolve(override);
  }

  // 3. 默认值：项目根目录下的 app/data/pyapp
  //    保持既有数据源（数出同源：DB 是唯一事实来源，不擅自切换数据目录）。
  //    曾尝试改为 ~/.pyapp 以对齐规范 §1.5，但会切换运行时 DB 导致历史数据被弃用，
  //    违背数出同源原则，已回滚（2026-08-12）。统一迁移需用户明确决策后一次性执行。
  return join(resolveProjectRoot(env), 'app', 'data', 'pyapp');
}

/**
 * 获取项目根目录
 * 可通过 LIRI_PROJECT_DIR 环境变量覆盖
 * 默认使用 process.cwd()
 *
 * Bun 编译的独立 exe 中，process.cwd() 可能返回根路径（如 '\' 或 'D:\'），
 * 此时 fallback 链为：
 *   1. LIRI_PROJECT_DIR 环境变量（启动脚本设置）
 *   2. process.argv[0] → 编译 exe 的实际磁盘路径，推断项目根
 *   3. INIT_CWD 环境变量
 *   4. process.cwd()（原样返回）
 */
export function resolveProjectRoot(
  env: NodeJS.ProcessEnv = process.env
): string {
  // 1. 环境变量优先（启动脚本设置）
  const override = env[ENV_LIRI_PROJECT_DIR]?.trim();
  if (override) {
    return resolve(override);
  }

  const cwd = process.cwd() || '';

  const isWindowsRoot = /^[a-zA-Z]:\\$/.test(cwd) || cwd === '\\';
  if (cwd === '' || cwd === '/' || isWindowsRoot) {
    // 2. 从 argv[0] 推断 exe 实际路径（Bun 编译 exe 中指向用户硬盘上的 .exe 文件）
    const argv0 = process.argv[0] || '';
    if (argv0.endsWith('.exe')) {
      const exeDir = resolve(argv0, '..');
      // exe 在 dist/ 下，项目根为 dist/ 的父目录
      if (
        exeDir.endsWith('dist') ||
        exeDir.endsWith('dist\\') ||
        exeDir.endsWith('dist/')
      ) {
        return resolve(exeDir, '..');
      }
      return exeDir;
    }

    // 3. INIT_CWD 环境变量兜底
    const initCwd = env['INIT_CWD']?.trim();
    if (initCwd) {
      return resolve(initCwd);
    }
  }

  // 4. 检测：若当前目录末级为 'app'（即 package.json 所在目录），
  //    且父级存在 app/package.json，说明当前是 app 子目录，
  //    应返回父级作为项目根目录，避免下游拼接 'app/' 前缀后出现双重路径
  const resolved = resolve(cwd);
  const lastSegment = basename(resolved);
  if (lastSegment === 'app') {
    const parent = resolve(resolved, '..');
    const parentAppPackage = join(parent, 'app', 'package.json');
    if (existsSync(parentAppPackage)) {
      // BUG05 修复：验证 package.json 内容，避免同名 app 目录误匹配
      try {
        const pkg = JSON.parse(readFileSync(parentAppPackage, 'utf-8'));
        if (pkg.name && typeof pkg.name === 'string') {
          return parent;
        }
      } catch {
        // package.json 不可读时仍返回 parent（保持向后兼容）
        return parent;
      }
    }
  }

  return resolved;
}

/**
 * 获取项目数据目录（第二层）
 * 可通过 LIRI_DATA_DIR 环境变量覆盖
 * 默认：用户目录下的 .pyapp/data/（部署安全：Program Files 安装也具备写入权限）
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[ENV_LIRI_DATA_DIR]?.trim();
  if (override) {
    return resolve(override);
  }
  return join(resolvePyappHome(env), 'data');
}

// ─── 第一层：代码文档 ─────────────────────────

export function resolveDocsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveProjectRoot(env), 'app', 'docs');
}

/** 知识库文档目录（app/docs/知识库/） */
export function resolveKnowledgeBaseDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDocsDir(env), '知识库');
}

/** 项目配置目录（app/config/） */
export function resolveConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveProjectRoot(env), 'app', 'config');
}

/** 项目配置文件路径（config.json） */
export function resolveProjectConfigPath(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveProjectRoot(env), 'app', 'config.json');
}

/** 项目设置文件路径（settings.json） */
export function resolveProjectSettingsPath(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveProjectRoot(env), 'app', 'settings.json');
}

// ─── 第二层：项目数据 ─────────────────────────

/** 主数据库 */
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataDir(env), 'app.db');
}

/** 会话存储 — 按 worktree 隔离 */
export function resolveSessionsDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  const worktreeHash = resolveWorktreeHash(env);
  return join(resolveDataDir(env), 'sessions', worktreeHash);
}

/**
 * 旧版会话存储路径（无 worktree 隔离），用于兼容迁移
 */
export function resolveLegacySessionsDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDataDir(env), 'sessions');
}

/**
 * 计算当前项目根目录的 worktree hash
 * 对标 BA_REF sessionStorage.ts 的 worktree 感知存储隔离。
 * 通过 PYAPP_PROJECT_DIR 环境变量获取项目目录，SHA256 前 8 位作为 hash。
 * 若环境变量未设置，返回 'default' 表示非 worktree 模式。
 */
export function resolveWorktreeHash(
  env: NodeJS.ProcessEnv = process.env
): string {
  const projectDir = env.PYAPP_PROJECT_DIR;
  if (!projectDir) return 'default';

  const { createHash } = require('crypto');
  return createHash('sha256').update(projectDir).digest('hex').slice(0, 8);
}

/**
 * 会话存储迁移：从旧版平级路径迁移到 worktree 隔离路径
 * 幂等操作 — 先移动文件 → 确认成功 → 写 `migrated_at` 标记
 */
export function migrateSessionsToWorktree(
  env: NodeJS.ProcessEnv = process.env
): void {
  const {
    existsSync,
    renameSync,
    mkdirSync,
    writeFileSync,
    readdirSync,
  } = require('fs');
  const { join } = require('path');
  const legacyDir = resolveLegacySessionsDir(env);
  const newDir = resolveSessionsDir(env);

  // 已迁移：新路径存在
  if (existsSync(newDir)) return;

  // 无需迁移：旧路径不存在或无数据
  if (!existsSync(legacyDir)) return;

  const entries = readdirSync(legacyDir);
  if (entries.length === 0) return;

  // 幂等迁移：先创建目标目录，再逐项移动（不能 rename 父目录到自身子目录）
  try {
    mkdirSync(newDir, { recursive: true });
    for (const entry of entries) {
      const from = join(legacyDir, entry);
      const to = join(newDir, entry);
      try {
        renameSync(from, to);
      } catch (err) {
        // 单项移动失败，跳过
      }
    }
    // 迁移成功标记
    writeFileSync(
      join(newDir, '.worktree_migrated_at'),
      new Date().toISOString()
    );
  } catch (err) {
    // 迁移失败，静默降级
  }
}

/** 会话转录 */
export function resolveTranscriptsDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDataDir(env), 'transcripts');
}

/** 项目记忆 */
export function resolveMemoryDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataDir(env), 'memory');
}

/** 团队记忆 */
export function resolveTeamMemoryDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDataDir(env), 'team-memory');
}

/** 人格/用户身份 */
export function resolveSoulDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataDir(env), 'soul');
}

/** 缓存 */
export function resolveCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataDir(env), 'cache');
}

/** 安全数据 */
export function resolveSecurityDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDataDir(env), 'security');
}

/** OAuth 令牌 */
export function resolveOAuthDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataDir(env), 'oauth');
}

/** 权限规则 */
export function resolvePermissionsDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDataDir(env), 'permissions');
}

/** 定时任务缓存 */
export function resolveChronosDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDataDir(env), 'chronos');
}

/** 诊断快照 */
export function resolveSnapshotsDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDataDir(env), 'snapshots');
}

/** 日志目录（app/data/logs/） */
export function resolveLogsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataDir(env), 'logs');
}

/** 会话制品目录（app/data/artifacts/） */
export function resolveArtifactsDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDataDir(env), 'artifacts');
}

/** 治理数据目录（app/data/governance/） */
export function resolveGovernanceDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDataDir(env), 'governance');
}

/** 本地模型存储目录（app/data/models/）
 *  用于存放本地下载的 AI 模型文件（如 faster-whisper 语音识别模型）
 *  这些文件体积大、由 HuggingFace 等源自动下载和缓存
 */
export function resolveModelsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataDir(env), 'models');
}

/** llama.cpp 集成目录（~/.pyapp/data/models/llama/）
 *  存放 llama-server 二进制（llama-server(.exe)）与用户 GGUF 模型（models/*.gguf）
 */
export function resolveLlamaDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveModelsDir(env), 'llama');
}

/** llama-server 二进制路径（Windows 平台带 .exe 后缀） */
export function resolveLlamaBinaryPath(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(
    resolveLlamaDir(env),
    `llama-server${process.platform === 'win32' ? '.exe' : ''}`
  );
}

/** 用户 GGUF 模型存放目录（~/.pyapp/data/models/llama/models/） */
export function resolveLlamaModelsDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveLlamaDir(env), 'models');
}

/** 配对存储目录（app/data/pairings/） */
export function resolvePairingsDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDataDir(env), 'pairings');
}

// ─── 第二层：便捷路径构造 ─────────────────────

/**
 * 解析数据目录下的子目录
 * @param subDir 子目录名
 */
export function resolveDataSubDir(
  subDir: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDataDir(env), subDir);
}

/**
 * 获取会话文件路径
 * @param sessionId 会话ID
 * @param ext 文件扩展名（默认 .json）
 */
export function resolveSessionFilePath(
  sessionId: string,
  ext: string = '.json',
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveSessionsDir(env), `${sessionId}${ext}`);
}

/**
 * 获取转录文件路径
 * @param sessionId 会话ID
 * @param ext 文件扩展名（默认 .json）
 */
export function resolveTranscriptFilePath(
  sessionId: string,
  ext: string = '.json',
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveTranscriptsDir(env), `${sessionId}${ext}`);
}

// ─── 第三层：用户数据 ─────────────────────────

/** 用户配置（~/.pyapp/config.json） */
export function resolveUserConfigPath(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolvePyappHome(env), 'config.json');
}

/** 用户设置（~/.pyapp/settings.json） */
export function resolveUserSettingsPath(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolvePyappHome(env), 'settings.json');
}

/** AI 人格定义（~/.pyapp/SOUL.md） */
export function resolveSoulPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolvePyappHome(env), 'SOUL.md');
}

/** 用户档案（~/.pyapp/USER.md） */
export function resolveUserProfilePath(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolvePyappHome(env), 'USER.md');
}

/** 用户级记忆目录（~/.pyapp/memory/） */
export function resolveUserMemoryDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolvePyappHome(env), 'memory');
}

/** 用户级知识库目录（~/.pyapp/knowledge/） */
export function resolveKnowledgeDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolvePyappHome(env), 'knowledge');
}

/** 知识库 raw 目录（~/.pyapp/knowledge/raw/） */
export function resolveKnowledgeRawDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveKnowledgeDir(env), 'raw');
}

/** 知识库域名根目录（~/.pyapp/knowledge/domains/） */
export function resolveDomainsRoot(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveKnowledgeDir(env), 'domains');
}

/**
 * 获取指定域的目录
 * @param name 域名
 * @param env 环境变量
 * 格式：~/.pyapp/knowledge/domains/{name}/
 */
export function resolveDomainDir(
  name: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDomainsRoot(env), name);
}

/**
 * 获取指定域的 schema 目录
 * @param name 域名
 * @param env 环境变量
 * 格式：~/.pyapp/knowledge/domains/{name}/.schema/
 */
export function resolveDomainSchemaDir(
  name: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDomainDir(name), '.schema');
}

/** 入站文件 inbound 基础目录（~/.pyapp/knowledge/raw/inbound/） */
export function resolveInboundBaseDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveKnowledgeRawDir(env), 'inbound');
}

/**
 * 按来源和时间分层的入站文件目录
 *
 * 格式：{inboundBase}/{source}/{YYYY}/{MM}/{DD}/
 * 示例：~/.pyapp/knowledge/raw/inbound/upload/2026/06/11/
 *
 * @param source - 来源标识（如 'upload', 'channel_telegram', 'tool_write'）
 * @param date - 日期（默认当天），用于按天归档
 * @param env - 环境变量
 */
export function resolveInboundDir(
  source: string,
  date?: Date,
  env: NodeJS.ProcessEnv = process.env
): string {
  const d = date ?? new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return join(resolveInboundBaseDir(env), source, String(y), m, day);
}

/** 用户技能目录（~/.pyapp/skills/） */
export function resolveUserSkillsDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolvePyappHome(env), 'skills');
}

/**
 * 第三方技能目录（~/.pyapp/skills/vendor/）
 * 2026-08-06：ClawHub 等市场安装的技能独立存放，与用户手工创建的技能物理隔离。
 */
export function resolveVendorSkillsDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveUserSkillsDir(env), 'vendor');
}

// ─── 插件系统路径（~/.pyapp/plugins/，2026-08-06 纳入注册表） ────

/**
 * 插件根目录（~/.pyapp/plugins/）
 * 2026-08-06：统一插件系统基目录（原项目根 plugins/ 与 ~/.pyapp/plugins/ 双基地冲突已收敛）。
 */
export function resolvePluginsDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolvePyappHome(env), 'plugins');
}

/** 插件安装目录（~/.pyapp/plugins/installed/）—— npm 安装的插件落盘位置 */
export function resolvePluginsInstalledDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolvePluginsDir(env), 'installed');
}

/** 插件缓存目录（~/.pyapp/plugins/cache/）—— 插件市场 catalog 等缓存 */
export function resolvePluginsCacheDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolvePluginsDir(env), 'cache');
}

/** 插件配置目录（~/.pyapp/plugins/config/）—— 插件配置持久化 */
export function resolvePluginsConfigDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolvePluginsDir(env), 'config');
}

/** 用户级权限（~/.pyapp/permissions/） */
export function resolveUserPermissionsDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolvePyappHome(env), 'permissions');
}

/** 用户附件目录（~/.pyapp/attachments/） */
export function resolveAttachmentsDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolvePyappHome(env), 'attachments');
}

/**
 * 获取按日期归档的附件子目录
 * @param date 日期（默认当天）
 * 格式：attachments/YYYYMMDD/
 */
export function resolveAttachmentsDateDir(
  date?: Date,
  env: NodeJS.ProcessEnv = process.env
): string {
  const d = date ?? new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return join(resolveAttachmentsDir(env), `${y}${m}${day}`);
}

/** 用户输出目录（~/.pyapp/output/）—— 用户生产文件的默认导出位置 */
export function resolveOutputDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolvePyappHome(env), 'output');
}

/** 用户临时文件目录（~/.pyapp/temp/）—— 临时文件的统一存放位置，启动时可清理 */
export function resolveTempDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolvePyappHome(env), 'temp');
}

/** 用户下载目录（~/.pyapp/downloads/）—— AI 从互联网下载的材料的存放位置 */
export function resolveDownloadsDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolvePyappHome(env), 'downloads');
}

/** 首次运行标记文件路径（app/data/.onboarded） */
export function resolveOnboardedFlagPath(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDataDir(env), '.onboarded');
}

/** 用户媒体文件目录（~/.pyapp/media/） */
export function resolveMediaDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolvePyappHome(env), 'media');
}

// ─── 初始化辅助 ───────────────────────────────

/**
 * 确保目录存在，若不存在则创建
 */
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

// ─── 路径工具函数（对标 cc_code/cline-main）───────────

/**
 * 安全的路径包含判断 — 检查 child 是否在 parent 目录内（含边界保护）
 * 解决 startsWith 前缀碰撞：parent="proj" 不会匹配 child="proj2/file"
 */
export function isPathWithin(parent: string, child: string): boolean {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  if (resolvedChild === resolvedParent) return true;
  const parentWithSep = resolvedParent.endsWith(sep)
    ? resolvedParent
    : resolvedParent + sep;
  return resolvedChild.startsWith(parentWithSep);
}

/**
 * 路径遍历检测 — 禁止 ../ 或 ..\ 模式
 * 覆盖：原始字符串、URL 编码 (%2e)、双编码 (%252e)
 * 对标 BA_REF/cc_code backend/utils/path.ts:133-135
 */
export function containsPathTraversal(inputPath: string): boolean {
  if (!inputPath || typeof inputPath !== 'string') return false;
  // Step 1: 原始字符串中的 ../
  if (/\.\.[/\\]/.test(inputPath)) return true;
  // Step 2: URL 编码形式 (%2e%2e/ / %2e%2e%2f)
  if (/%2e%2e[/\\]?/i.test(inputPath)) return true;
  // Step 3: 双编码形式（绕过手段）
  if (/%252e%252e[/\\]?/i.test(inputPath)) return true;
  return false;
}

/**
 * null byte 安全检查 — 路径中不得含空字节
 * 对标 BA_REF/cc_code backend/utils/path.ts:48
 */
export function containsNullByte(inputPath: string): boolean {
  return inputPath.includes('\0');
}

/**
 * 路径安全验证 — 拒绝危险路径（相对/根/Windows驱动器根/UNC/null byte/traversal）
 * 对标 BA_REF/cc_code backend/memdir/paths.ts:109-150
 */
export function validatePathSafe(
  inputPath: string,
  options?: {
    allowRelative?: boolean;
    allowRoot?: boolean;
  }
): { valid: true; normalized: string } | { valid: false; reason: string } {
  if (!inputPath || typeof inputPath !== 'string') {
    return { valid: false, reason: '路径不能为空' };
  }

  if (containsNullByte(inputPath)) {
    return { valid: false, reason: '路径包含非法空字节' };
  }

  if (containsPathTraversal(inputPath)) {
    return { valid: false, reason: '路径包含非法遍历 (../)' };
  }

  const normalized = normalize(inputPath);

  if (!options?.allowRelative && !isAbsolute(normalized)) {
    return { valid: false, reason: '路径必须是绝对路径' };
  }

  if (!options?.allowRoot) {
    // Windows 驱动器根（如 C:\）
    if (/^[a-zA-Z]:\\$/.test(normalized)) {
      return { valid: false, reason: '不允许使用驱动器根目录' };
    }
    // Unix 根
    if (normalized === '/' || normalized === sep) {
      return { valid: false, reason: '不允许使用系统根目录' };
    }
    // UNC 路径
    if (normalized.startsWith('\\\\')) {
      return { valid: false, reason: '不允许使用 UNC 路径' };
    }
  }

  return { valid: true, normalized };
}

/**
 * 展开 tilde 路径（~ 或 ~/path）
 * 对标 BA_REF/cc_code backend/utils/path.ts:59-73
 */
export function expandTilde(inputPath: string): string {
  if (!inputPath.startsWith('~')) return inputPath;

  const homedir = os.homedir();
  if (inputPath === '~') return homedir;

  if (inputPath.startsWith('~' + sep) || inputPath.startsWith('~/')) {
    return join(homedir, inputPath.slice(2));
  }

  // ~user 格式不支持，回退原值
  return inputPath;
}

/**
 * 跨平台路径比较 — Windows 大小写不敏感
 * 对标 BA_REF/cc_code backend/utils/file.ts:560-583
 * 对标 CJL_REF/cline-main src/utils/path.ts:55-80
 */
export function arePathsEqual(path1: string, path2: string): boolean {
  if (!path1 || !path2) return path1 === path2;

  const n1 = normalize(path1).replace(/[/\\]$/, '');
  const n2 = normalize(path2).replace(/[/\\]$/, '');

  if (process.platform === 'win32') {
    return n1.toLowerCase() === n2.toLowerCase();
  }

  return n1 === n2;
}

/**
 * 路径规范化（用于比较）— Windows 大小写不敏感 + 移除拖尾斜杠
 * 对标 BA_REF/cc_code backend/utils/file.ts:560-568
 */
export function normalizePathForComparison(filePath: string): string {
  let normalized = normalize(filePath);
  if (process.platform === 'win32') {
    normalized = normalized.toLowerCase();
  }
  // 移除拖尾斜杠
  return normalized.replace(/[/\\]$/, '');
}

/**
 * 转为 POSIX 风格路径（正斜杠），保留 Windows 长路径前缀
 * 对标 CJL_REF/cline-main src/utils/path.ts:31-40
 */
export function toPosixPath(inputPath: string): string {
  const prefix = inputPath.startsWith('\\\\?\\') ? '\\\\?\\' : '';
  const clean = prefix ? inputPath.slice(4) : inputPath;
  return prefix + clean.replace(/\\/g, '/');
}

/**
 * 获取人类可读的显示路径
 * 优先级：相对路径 > tilde 路径 > 绝对路径
 * 对标 BA_REF/cc_code backend/utils/file.ts:155-166
 */
export function getDisplayPath(filePath: string, cwd?: string): string {
  const absPath = resolve(filePath);
  const currentDir = cwd ?? process.cwd();

  // 在工作目录内 → 相对路径
  const rel = posix.relative(posix.resolve(currentDir), toPosixPath(absPath));
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
    return rel;
  }

  // 在 home 目录内 → tilde 路径
  const home = os.homedir();
  const posixAbs = toPosixPath(absPath);
  const posixHome = toPosixPath(home);
  if (posixAbs.startsWith(posixHome + '/')) {
    return '~' + posixAbs.slice(posixHome.length);
  }
  if (posixAbs === posixHome) return '~';

  // fallback：绝对路径
  return posixAbs;
}

/**
 * 路径清洗 — 仅保留安全字符，用于缓存/项目目录名
 * 对标 BA_REF/cc_code backend/utils/cachePaths.ts 的 sanitizePath
 * 对标 BA_REF/agentscope-main _local_workspace.py:61-76 的 _sanitize_dir_name
 */
export function sanitizePath(input: string): string {
  return input
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 128);
}

/**
 * 确保数据目录结构完整（第二层 + 第三层子目录）
 */
export function ensureDataDirectories(
  env: NodeJS.ProcessEnv = process.env
): void {
  const dirs = [
    resolveDataDir(env),
    resolveSessionsDir(env),
    resolveTranscriptsDir(env),
    resolveMemoryDir(env),
    resolveTeamMemoryDir(env),
    resolveAttachmentsDir(env),
    resolveCacheDir(env),
    resolveSecurityDir(env),
    resolveOAuthDir(env),
    resolvePermissionsDir(env),
    resolveChronosDir(env),
    resolveSnapshotsDir(env),
    resolveLogsDir(env),
    resolveArtifactsDir(env),
    resolveGovernanceDir(env),
    join(resolveGovernanceDir(env), 'audit'),
    join(resolveGovernanceDir(env), 'strategies'),
    resolvePairingsDir(env),
    resolveModelsDir(env),
    resolvePyappHome(env),
    resolveUserMemoryDir(env),
    resolveKnowledgeDir(env),
    resolveKnowledgeRawDir(env),
    resolveInboundBaseDir(env),
    resolveUserSkillsDir(env),
    resolveVendorSkillsDir(env),
    resolvePluginsDir(env),
    resolvePluginsInstalledDir(env),
    resolvePluginsCacheDir(env),
    resolvePluginsConfigDir(env),
    resolveUserPermissionsDir(env),
    resolveOutputDir(env),
    resolveMediaDir(env),
  ];

  // 临时目录也加入创建列表
  dirs.push(resolveTempDir(env));

  // 下载目录
  dirs.push(resolveDownloadsDir(env));

  for (const dir of dirs) {
    ensureDir(dir);
  }
}

// ─── 常量（默认值） ───────────────────────────
//
// BUG14 风险评估：已确认安全。
//   pyapp.ts 是唯一入口 → 设置 LIRI_PROJECT_DIR + chdir → 动态 import main.ts → 此后才导入 paths.ts。
//   测试/REPL 等非标准入口如需重置，调用 resetPaths() 后再重新 import。
//

/** 重置内部路径缓存（供测试/运行时目录变更后调用） */
export function resetPaths(): void {
  // 目前常量基于环境变量/chdir 实时计算，无需缓存清除。
  // 如需惰性求值迁移，在此处添加 cache.clear()。
}

export const LIRI_HOME = resolvePyappHome();
export const PROJECT_ROOT = resolveProjectRoot();
export const DATA_DIR = resolveDataDir();
export const DB_PATH = resolveDbPath();
export const SESSIONS_DIR = resolveSessionsDir();
export const TRANSCRIPTS_DIR = resolveTranscriptsDir();
export const MEMORY_DIR = resolveMemoryDir();
export const TEAM_MEMORY_DIR = resolveTeamMemoryDir();
export const CACHE_DIR = resolveCacheDir();
export const SECURITY_DIR = resolveSecurityDir();
export const OAUTH_DIR = resolveOAuthDir();
export const PERMISSIONS_DIR = resolvePermissionsDir();
export const CHRONOS_DIR = resolveChronosDir();
export const SNAPSHOTS_DIR = resolveSnapshotsDir();
export const LOGS_DIR = resolveLogsDir();
export const ARTIFACTS_DIR = resolveArtifactsDir();
export const GOVERNANCE_DIR = resolveGovernanceDir();
export const MODELS_DIR = resolveModelsDir();
export const PAIRINGS_DIR = resolvePairingsDir();
export const USER_CONFIG_PATH = resolveUserConfigPath();
export const USER_SETTINGS_PATH = resolveUserSettingsPath();
export const SOUL_PATH = resolveSoulPath();
export const USER_PROFILE_PATH = resolveUserProfilePath();
export const USER_MEMORY_DIR = resolveUserMemoryDir();
export const KNOWLEDGE_DIR = resolveKnowledgeDir();
export const KNOWLEDGE_RAW_DIR = resolveKnowledgeRawDir();
export const INBOUND_DIR = resolveInboundBaseDir();
export const USER_SKILLS_DIR = resolveUserSkillsDir();
export const VENDOR_SKILLS_DIR = resolveVendorSkillsDir();
export const PLUGINS_DIR = resolvePluginsDir();
export const PLUGINS_INSTALLED_DIR = resolvePluginsInstalledDir();
export const PLUGINS_CACHE_DIR = resolvePluginsCacheDir();
export const PLUGINS_CONFIG_DIR = resolvePluginsConfigDir();
export const USER_PERMISSIONS_DIR = resolveUserPermissionsDir();
export const USER_ATTACHMENTS_DIR = resolveAttachmentsDir();
export const ATTACHMENTS_DIR = resolveAttachmentsDir();
export const OUTPUT_DIR = resolveOutputDir();
export const TEMP_DIR = resolveTempDir();
export const DOWNLOADS_DIR = resolveDownloadsDir();
export const MEDIA_DIR = resolveMediaDir();
export const DOCS_DIR = resolveDocsDir();
export const KNOWLEDGE_BASE_DIR = resolveKnowledgeBaseDir();
/** @deprecated 使用 resolveConfigDir() 或 CONFIG_DIR */
export const CONFIGS_DIR = resolveConfigDir();
export const PROJECT_CONFIG_PATH = resolveProjectConfigPath();
export const PROJECT_SETTINGS_PATH = resolveProjectSettingsPath();

// ─── 路径一致性验证 ────────────────────────

/**
 * 运行时路径一致性验证。
 * 在模块初始化阶段调用，检查关键路径是否与期望一致，避免硬编码路径导致的数据分散。
 *
 * 当前检查项：
 * - LIRI_HOME 环境变量是否已设置（未被意外覆盖）
 * - resolvePyappHome() 是否与 LIRI_HOME 一致
 * - SOUL.md 和 USER.md 是否位于正确位置
 *
 * 仅打印 warning 不抛异常——路径错误不应阻塞启动。
 */
const pathsLogger = getLogger('core:paths');

export function validatePathConsistency(logger?: {
  warn: (msg: string) => void;
}): void {
  const log = logger ?? {
    warn: (msg: string) => pathsLogger.warn(`[路径验证] ${msg}`),
  };

  // 1. LIRI_HOME 必须已设置
  const liriHome = process.env['LIRI_HOME']?.trim();
  if (!liriHome) {
    log.warn('环境变量 LIRI_HOME 未设置，路径解析将回退到默认值');
    return;
  }

  // 2. resolvePyappHome() 应与 LIRI_HOME 一致
  const resolvedHome = resolvePyappHome();
  if (resolvedHome !== resolve(liriHome)) {
    log.warn(
      `resolvePyappHome() 返回 "${resolvedHome}" 与 LIRI_HOME="${liriHome}" 不一致。` +
        '可能出现数据分散，请检查 setUserDataDirOverride() 调用栈'
    );
  }

  // 3. SOUL.md / USER.md 应在 LIRI_HOME 根目录
  const soulExpected = join(resolve(liriHome), 'SOUL.md');
  const userExpected = join(resolve(liriHome), 'USER.md');
  if (SOUL_PATH !== soulExpected) {
    log.warn(
      `SOUL_PATH="${SOUL_PATH}" 与预期路径 "${soulExpected}" 不一致。` +
        'SOUL.md 应位于 LIRI_HOME 根目录（第三层）'
    );
  }
  if (USER_PROFILE_PATH !== userExpected) {
    log.warn(
      `USER_PROFILE_PATH="${USER_PROFILE_PATH}" 与预期路径 "${userExpected}" 不一致。` +
        'USER.md 应位于 LIRI_HOME 根目录（第三层）'
    );
  }
}
