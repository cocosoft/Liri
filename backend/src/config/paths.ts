/**
 * 统一路径管理
 *
 * 按文件存储规范（三层分离）集中管理所有路径模板：
 *   第一层：backend/docs/       Git 跟踪，系统文档
 *   第二层：backend/data/       不跟踪，项目运行时数据
 *   第三层：~/.pyapp/           不跟踪，用户级数据
 *
 * 各模块通过本模块获取路径，不再硬编码路径字符串。
 * 支持运行时通过环境变量切换根目录（测试友好）。
 */

import { homedir } from 'os';
import { join, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';

// ─── 环境变量键名 ─────────────────────────────

const ENV_PYAPP_HOME = 'PYAPP_HOME';
const ENV_PYAPP_PROJECT_DIR = 'PYAPP_PROJECT_DIR';
const ENV_PYAPP_DATA_DIR = 'PYAPP_DATA_DIR';

// ─── 基础目录解析（可注入 thunk 便于测试） ────

/**
 * 获取用户主目录
 * 可通过 PYAPP_HOME 环境变量覆盖
 */
export function resolvePyappHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[ENV_PYAPP_HOME]?.trim();
  if (override) {
    return resolve(override);
  }
  return join(homedir(), '.pyapp');
}

/**
 * 获取项目根目录
 * 可通过 PYAPP_PROJECT_DIR 环境变量覆盖
 * 默认使用 process.cwd()
 */
export function resolveProjectRoot(
  env: NodeJS.ProcessEnv = process.env
): string {
  const override = env[ENV_PYAPP_PROJECT_DIR]?.trim();
  if (override) {
    return resolve(override);
  }
  return resolve(process.cwd());
}

/**
 * 获取项目数据目录（第二层）
 * 可通过 PYAPP_DATA_DIR 环境变量覆盖
 * 默认：backend/data/
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[ENV_PYAPP_DATA_DIR]?.trim();
  if (override) {
    return resolve(override);
  }
  return join(resolveProjectRoot(env), 'data');
}

// ─── 第一层：代码文档 ─────────────────────────

export function resolveDocsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveProjectRoot(env), 'docs');
}

/** 知识库文档目录（backend/docs/知识库/） */
export function resolveKnowledgeBaseDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDocsDir(env), '知识库');
}

/** 项目配置目录（backend/configs/） */
export function resolveConfigsDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveProjectRoot(env), 'configs');
}

/** 项目配置文件路径（config.json） */
export function resolveProjectConfigPath(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveProjectRoot(env), 'config.json');
}

/** 项目设置文件路径（settings.json） */
export function resolveProjectSettingsPath(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveProjectRoot(env), 'settings.json');
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

/** 用户附件 */
export function resolveAttachmentsDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveDataDir(env), 'attachments');
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
    resolvePyappHome(env),
    resolveUserMemoryDir(env),
    resolveKnowledgeDir(env),
    resolveUserSkillsDir(env),
    resolveUserPermissionsDir(env),
  ];

  for (const dir of dirs) {
    ensureDir(dir);
  }
}

// ─── 常量（默认值） ───────────────────────────

export const PYAPP_HOME = resolvePyappHome();
export const PROJECT_ROOT = resolveProjectRoot();
export const DATA_DIR = resolveDataDir();
export const DB_PATH = resolveDbPath();
export const SESSIONS_DIR = resolveSessionsDir();
export const TRANSCRIPTS_DIR = resolveTranscriptsDir();
export const MEMORY_DIR = resolveMemoryDir();
export const TEAM_MEMORY_DIR = resolveTeamMemoryDir();
export const ATTACHMENTS_DIR = resolveAttachmentsDir();
export const CACHE_DIR = resolveCacheDir();
export const SECURITY_DIR = resolveSecurityDir();
export const OAUTH_DIR = resolveOAuthDir();
export const PERMISSIONS_DIR = resolvePermissionsDir();
export const CHRONOS_DIR = resolveChronosDir();
export const SNAPSHOTS_DIR = resolveSnapshotsDir();
export const USER_CONFIG_PATH = resolveUserConfigPath();
export const USER_SETTINGS_PATH = resolveUserSettingsPath();
export const SOUL_PATH = resolveSoulPath();
export const USER_PROFILE_PATH = resolveUserProfilePath();
export const USER_MEMORY_DIR = resolveUserMemoryDir();
export const KNOWLEDGE_DIR = resolveKnowledgeDir();
export const USER_SKILLS_DIR = resolveUserSkillsDir();
export const USER_PERMISSIONS_DIR = resolveUserPermissionsDir();
export const DOCS_DIR = resolveDocsDir();
export const KNOWLEDGE_BASE_DIR = resolveKnowledgeBaseDir();
export const CONFIGS_DIR = resolveConfigsDir();
export const PROJECT_CONFIG_PATH = resolveProjectConfigPath();
export const PROJECT_SETTINGS_PATH = resolveProjectSettingsPath();
