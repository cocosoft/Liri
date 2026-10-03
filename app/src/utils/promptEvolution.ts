// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * promptEvolution —— 经验**自动演化产物**的受管读写（T-②06 / benchmark §6.4 #9）
 *
 * 形态（用户 2026-10-03 裁定「两者都做」）：
 * - **提示覆盖层**：`<prompt-evolution>/overlay.md` —— 经 `promptEvolution` 系统提示词分段
 *   **自动回灌**（不改动任何内置/用户提示词文件）；
 * - **技能侧车**：`<userSkillsDir>/<name>/.evolution.md` —— 由 `FileSkillLoader` 加载
 *   `SKILL.md` 时**追加合并**（不改写用户 `SKILL.md` 本体）。
 *
 * **为什么是"覆盖层/侧车"而不是改写原文**：自动产物必须**可回滚**（版本目录）且**不侵入
 * 用户文件**（技能来源隔离 `project_rules §1.15`：用户技能目录由用户拥有）。
 *
 * 本模块是这两种产物的**唯一读写实现**（CS01）；读写**同步**（与段落装配读取 AGENTS.md 同款），
 * 失败**不抛**（返回 `null` / `false`），由调用方留痕 —— 观测面失败不得反灌业务（CS03）。
 *
 * ⚠️ 分层：本模块在 `utils`(infra) —— 供 `context`(app，段落装配) 与 `tasks`(app) 共用；
 * 落任一侧都会造成 `context → tasks` 或反向的**同层强耦合**。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import {
  resolvePromptEvolutionDir,
  resolveUserSkillsDir,
} from '@modules/core/paths';

/** 覆盖层正文上限（字符）—— 会注入**每一条**请求的系统提示词，必须有界 */
export const MAX_OVERLAY_CHARS = 4000;
/** 技能侧车正文上限（字符） */
export const MAX_SKILL_EVOLUTION_CHARS = 4000;
/** 保留的历史版本数（超出即裁剪最旧） */
export const MAX_OVERLAY_VERSIONS = 20;

const OVERLAY_FILE = 'overlay.md';
const VERSIONS_DIR = 'versions';
/** 技能侧车文件名（与 `SKILL.md` 同目录） */
export const SKILL_EVOLUTION_FILE = '.evolution.md';

/** 技能目录名安全守卫（写盘路径由磁盘内容推导 ⇒ 必须拒绝越界名） */
const SAFE_SKILL_DIR = /^[A-Za-z0-9._-]+$/;

// ─── 提示覆盖层 ─────────────────────────────────────────────────────────────

/** 覆盖层文件路径（`<prompt-evolution>/overlay.md`） */
export function getOverlayPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolvePromptEvolutionDir(env), OVERLAY_FILE);
}

/**
 * 读取当前生效的覆盖层正文。
 *
 * @returns 不存在 / 空 / 超长 ⇒ `null`（超长视为不可信输入，**不注入**，如实留空）
 */
export function readPromptEvolutionOverlay(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const path = getOverlayPath(env);
  try {
    if (!existsSync(path)) return null;
    const text = readFileSync(path, 'utf-8').trim();
    if (text.length === 0 || text.length > MAX_OVERLAY_CHARS) return null;
    return text;
  } catch {
    // @ignore-catch — 读取失败等同"无覆盖层"（不注入），由调用方决定是否留痕
    return null;
  }
}

/**
 * 写入覆盖层正文（**先归档旧版再覆盖**）。
 *
 * @returns 失败（超长 / 落盘异常）⇒ `null`
 */
export function writePromptEvolutionOverlay(
  text: string,
  options?: { env?: NodeJS.ProcessEnv; now?: number }
): { path: string; version: string | null; bytes: number } | null {
  const env = options?.env ?? process.env;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_OVERLAY_CHARS) return null;

  const dir = resolvePromptEvolutionDir(env);
  const path = join(dir, OVERLAY_FILE);
  const stamp = String(options?.now ?? Date.now());
  try {
    mkdirSync(join(dir, VERSIONS_DIR), { recursive: true });
    // 归档旧版（存在才归档）——回滚依据
    let version: string | null = null;
    if (existsSync(path)) {
      const prev = readFileSync(path, 'utf-8');
      const versionPath = join(dir, VERSIONS_DIR, `${stamp}.md`);
      writeFileSync(versionPath, prev, 'utf-8');
      version = `${stamp}.md`;
      pruneOverlayVersions(dir);
    }
    writeFileSync(path, trimmed, 'utf-8');
    return { path, version, bytes: Buffer.byteLength(trimmed, 'utf-8') };
  } catch {
    // @ignore-catch — 落盘失败如实返回 null（调用方留痕）
    return null;
  }
}

/** 列出历史版本（时间戳文件名，升序） */
export function listPromptEvolutionVersions(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const versionsDir = join(resolvePromptEvolutionDir(env), VERSIONS_DIR);
  try {
    if (!existsSync(versionsDir)) return [];
    return readdirSync(versionsDir)
      .filter((name) => name.endsWith('.md'))
      .sort();
  } catch {
    // @ignore-catch — 目录不可读等同"无历史版本"
    return [];
  }
}

/** 回滚到指定历史版本（版本文件存在且非空 ⇒ 覆盖回 overlay.md） */
export function rollbackPromptEvolutionOverlay(
  version: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!/^[0-9]+\.md$/.test(version)) return false;
  const dir = resolvePromptEvolutionDir(env);
  const versionPath = join(dir, VERSIONS_DIR, version);
  try {
    if (!existsSync(versionPath)) return false;
    const text = readFileSync(versionPath, 'utf-8').trim();
    if (text.length === 0 || text.length > MAX_OVERLAY_CHARS) return false;
    writeFileSync(join(dir, OVERLAY_FILE), text, 'utf-8');
    return true;
  } catch {
    // @ignore-catch — 回滚失败如实返回 false
    return false;
  }
}

/** 裁剪历史版本至 {@link MAX_OVERLAY_VERSIONS}（删除最旧若干个） */
function pruneOverlayVersions(dir: string): void {
  try {
    const versionsDir = join(dir, VERSIONS_DIR);
    const files = readdirSync(versionsDir)
      .filter((name) => name.endsWith('.md'))
      .sort();
    const excess = files.length - MAX_OVERLAY_VERSIONS;
    for (const name of files.slice(0, Math.max(0, excess))) {
      try {
        unlinkSync(join(versionsDir, name));
      } catch {
        // @ignore-catch — 单个版本删除失败不影响其余与主写入流程
      }
    }
  } catch {
    // @ignore-catch — 裁剪失败不影响写入主流程
  }
}

// ─── 演化状态（防抖）─────────────────────────────────────────────────────────

/**
 * 演化状态（防抖依据）—— 与覆盖层同目录 `state.json`。
 *
 * 字段均为**事实记录**（时间戳 / 内容签名），判定不在本模块做（见
 * `tasks/evolution/AdaptationEvolutionService`）。
 */
export interface EvolutionState {
  /** 上次成功演化时间（epoch ms；0 = 从未） */
  lastAppliedAt: number;
  /** 上次依据的失败样本签名（相同 ⇒ 无新经验，不重复演化） */
  lastSampleSignature: string;
}

/** 演化最小间隔：同一批经验在 6 小时内不重复演化（防抖，非业务阈值） */
export const EVOLUTION_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** 状态文件路径（`<prompt-evolution>/state.json`） */
export function getEvolutionStatePath(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolvePromptEvolutionDir(env), 'state.json');
}

/** 读取演化状态（缺失 / 损坏 ⇒ 全零初值，等价"从未演化"） */
export function readEvolutionState(
  env: NodeJS.ProcessEnv = process.env
): EvolutionState {
  try {
    const path = getEvolutionStatePath(env);
    if (!existsSync(path)) return { lastAppliedAt: 0, lastSampleSignature: '' };
    const parsed = JSON.parse(
      readFileSync(path, 'utf-8')
    ) as Partial<EvolutionState>;
    return {
      lastAppliedAt:
        typeof parsed.lastAppliedAt === 'number' &&
        Number.isFinite(parsed.lastAppliedAt)
          ? parsed.lastAppliedAt
          : 0,
      lastSampleSignature:
        typeof parsed.lastSampleSignature === 'string'
          ? parsed.lastSampleSignature
          : '',
    };
  } catch {
    // @ignore-catch — 状态不可读等同"从未演化"（不阻断演化本身）
    return { lastAppliedAt: 0, lastSampleSignature: '' };
  }
}

/** 写入演化状态 */
export function writeEvolutionState(
  state: EvolutionState,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  try {
    mkdirSync(resolvePromptEvolutionDir(env), { recursive: true });
    writeFileSync(
      getEvolutionStatePath(env),
      JSON.stringify(state, null, 2),
      'utf-8'
    );
    return true;
  } catch {
    // @ignore-catch — 状态落盘失败如实返回 false（调用方留痕）
    return false;
  }
}

// ─── 技能侧车（.evolution.md）───────────────────────────────────────────────

/** 技能侧车路径（`<userSkillsDir>/<name>/.evolution.md`；名称越界 ⇒ `null`） */
export function getSkillEvolutionPath(
  skillName: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (
    !SAFE_SKILL_DIR.test(skillName) ||
    skillName === '.' ||
    skillName === '..'
  ) {
    return null;
  }
  return join(resolveUserSkillsDir(env), skillName, SKILL_EVOLUTION_FILE);
}

/**
 * 从**指定技能目录**读取侧车正文（加载器用：扫描目录可为用户/项目/第三方，
 * 侧车必须与 `SKILL.md` **同目录**，不能按用户目录推）。
 */
export function readSkillEvolutionFromDir(dir: string): string | null {
  const path = join(dir, SKILL_EVOLUTION_FILE);
  try {
    if (!existsSync(path)) return null;
    const text = readFileSync(path, 'utf-8').trim();
    if (text.length === 0 || text.length > MAX_SKILL_EVOLUTION_CHARS)
      return null;
    return text;
  } catch {
    // @ignore-catch — 读取失败等同"无侧车"
    return null;
  }
}

/** 读取技能侧车正文（不存在 / 空 / 超长 ⇒ `null`） */
export function readSkillEvolution(
  skillName: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const path = getSkillEvolutionPath(skillName, env);
  if (!path) return null;
  try {
    if (!existsSync(path)) return null;
    const text = readFileSync(path, 'utf-8').trim();
    if (text.length === 0 || text.length > MAX_SKILL_EVOLUTION_CHARS)
      return null;
    return text;
  } catch {
    // @ignore-catch — 读取失败等同"无侧车"
    return null;
  }
}

/**
 * 写入技能侧车正文。
 *
 * ⚠️ 只写**侧车**，**不触碰** `<name>/SKILL.md`（用户文件，见文件头"为什么"）。
 * @returns 失败（名称越界 / 超长 / 落盘异常）⇒ `null`
 */
export function writeSkillEvolution(
  skillName: string,
  text: string,
  env: NodeJS.ProcessEnv = process.env
): { path: string; bytes: number } | null {
  const path = getSkillEvolutionPath(skillName, env);
  if (!path) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SKILL_EVOLUTION_CHARS) {
    return null;
  }
  try {
    mkdirSync(join(resolveUserSkillsDir(env), skillName), { recursive: true });
    writeFileSync(path, trimmed, 'utf-8');
    return { path, bytes: Buffer.byteLength(trimmed, 'utf-8') };
  } catch {
    // @ignore-catch — 落盘失败如实返回 null
    return null;
  }
}
