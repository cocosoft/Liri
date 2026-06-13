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

import { homedir } from 'os';
import { basename, join, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync } from 'fs';

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
 * 优先级：
 * 1. 用户设置中配置的数据目录
 * 2. LIRI_HOME 环境变量
 * 3. 默认：用户主目录下的 .pyapp（优先）
 * 4. 回退：项目安装目录下的 app/data/pyapp（仅当用户目录不可写时，便携模式）
 */
export function resolvePyappHome(env: NodeJS.ProcessEnv = process.env): string {
  // 1. 优先使用运行时设置的目录
  if (userDataDirOverride) {
    return resolve(userDataDirOverride);
  }

  // 2. 环境变量覆盖
  const override = env[ENV_LIRI_HOME]?.trim();
  if (override) {
    return resolve(override);
  }

  // 3. 优先使用用户主目录下的 .pyapp
  const userHomeDir = join(homedir(), '.pyapp');
  try {
    if (!existsSync(userHomeDir)) {
      mkdirSync(userHomeDir, { recursive: true });
    }
    const testFile = join(userHomeDir, '.write_test');
    const fs = require('fs');
    fs.writeFileSync(testFile, '');
    fs.unlinkSync(testFile);
    return userHomeDir;
  } catch {
    // 用户目录不可写，回退到项目数据目录下的 pyapp（便携模式兜底）
    return join(resolveProjectRoot(env), 'app', 'data', 'pyapp');
  }
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
      return parent;
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

/** 会话存储 */
export function resolveSessionsDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDataDir(env), 'sessions');
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
    resolvePyappHome(env),
    resolveUserMemoryDir(env),
    resolveKnowledgeDir(env),
    resolveKnowledgeRawDir(env),
    resolveInboundBaseDir(env),
    resolveUserSkillsDir(env),
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
