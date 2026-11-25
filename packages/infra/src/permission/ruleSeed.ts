// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 工具规则**播种**（2026-11-25）。
 *
 * 背景：审批白名单（`~/.pyapp/data/permissions/tool_rules.json`）属第二层数据目录，**不受 Git
 * 跟踪** ⇒ 换机 / 重装后这些"安全窄口"全部丢失，用户要重新逐条点批准。
 *
 * 口径：
 * - 种子规则随代码走（`DEFAULT_TOOL_RULE_SEED`），只在**首次**（或 `version` 提升后）补齐**缺失**项；
 * - **不复活**用户手动删掉的旧规则：已应用过该版本 ⇒ 整个跳过（版本标记落在数据目录，可删）；
 * - 只补缺：同 `(toolName, contentPattern)` 键已有任意规则（含 deny）⇒ 跳过，绝不覆盖用户规则。
 *
 * 所有种子模式都是「单条命令 + 参数内禁 `& | ; < > ` $`」的窄口，串联命令仍走分类器/硬拦截。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { resolvePermissionsDir } from '@openliri/infra/environment';
import { getLogger } from '@openliri/infra/monitoring';

import {
  PermissionBehavior,
  createPermissionRule,
  type PermissionRule,
} from './types/PermissionRule';

const logger = getLogger('permission:ruleSeed');

export interface ToolRuleSeedEntry {
  behavior: 'allow' | 'deny' | 'ask';
  toolName: string;
  contentPattern?: string;
  /** 仅给人看：这条规则想解决什么 */
  note?: string;
}

export interface ToolRuleSeed {
  /** 提升版本 ⇒ 下次启动再补一轮（只补缺失项） */
  version: number;
  rules: ToolRuleSeedEntry[];
}

/** 参数段禁止 shell 元字符（`& | ; < > ` $`），保证"单条命令"语义 */
const SAFE_ARGS = '(?: [^&|;<>`$]*)?$';

/**
 * 默认工具规则种子（2026-11-25 真机周报：未收录命令导致高频审批）。
 *
 * 依据 `audit:approval-rules`：这些模式按"精确匹配"归 `ok`（非前缀放大），
 * 且危险串联（`&&` / `|` / 重定向）不在字符集内 ⇒ 仍由分类器 / 硬拦截处理。
 */
export const DEFAULT_TOOL_RULE_SEED: ToolRuleSeed = {
  version: 1,
  rules: [
    {
      behavior: 'allow',
      toolName: 'bash',
      contentPattern: `^cargo build${SAFE_ARGS}`,
      note: 'cargo build（含参数）免审批；会执行 build.rs',
    },
    {
      behavior: 'allow',
      toolName: 'bash',
      contentPattern: `^cargo test${SAFE_ARGS}`,
      note: 'cargo test（含参数）免审批；会执行测试代码',
    },
    {
      behavior: 'allow',
      toolName: 'bash',
      contentPattern: `^cargo (?:check|clippy)${SAFE_ARGS}`,
      note: 'cargo check / clippy（只读子命令）',
    },
    {
      behavior: 'allow',
      toolName: 'bash',
      contentPattern: `^cargo fmt --check${SAFE_ARGS}`,
      note: '仅 cargo fmt --check（cargo fmt 会改文件，仍审批）',
    },
    {
      behavior: 'allow',
      toolName: 'bash',
      contentPattern: `^mkdir${SAFE_ARGS}`,
      note: '建目录（无破坏性）',
    },
    {
      behavior: 'allow',
      toolName: 'bash',
      contentPattern:
        '^powershell(?:\\.exe)? -NoProfile -Command "(?:Get-Content|Select-String|Get-ChildItem)\\b[^"&|;<>`$]*"$',
      note: 'PowerShell 只读三件套；Remove-Item 等仍走硬拦截',
    },
    {
      behavior: 'allow',
      toolName: 'bash',
      contentPattern: `^gh (?:pr|issue|run|repo|release|workflow|auth) (?:view|list|status)${SAFE_ARGS}`,
      note: 'gh 只读子命令；gh api -X DELETE 仍审批',
    },
  ],
};

/** 播种进度标记（数据目录，可删；删除后下次启动会重新补齐缺失项） */
function defaultMarkerPath(): string {
  return join(resolvePermissionsDir(), 'tool_rules.seed-state.json');
}

function readAppliedVersion(markerPath: string): number {
  if (!existsSync(markerPath)) return 0;
  try {
    const raw = JSON.parse(readFileSync(markerPath, 'utf8')) as {
      appliedVersion?: unknown;
    };
    const version = Number(raw?.appliedVersion);
    return Number.isFinite(version) && version > 0 ? version : 0;
  } catch {
    // @ignore-catch 标记损坏 ⇒ 视为未播种（幂等补齐，不会覆盖用户规则）
    return 0;
  }
}

function writeAppliedVersion(markerPath: string, version: number): void {
  try {
    mkdirSync(dirname(markerPath), { recursive: true });
    writeFileSync(
      markerPath,
      JSON.stringify({ appliedVersion: version, appliedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch (err) {
    // @ignore-catch 标记写失败只影响"下次会再补一轮缺失项"，不影响规则本身
    logger.warn('工具规则播种：进度标记写入失败（下次启动会重试补齐）', {
      markerPath,
      error: String(err),
    });
  }
}

/** 已有规则键（与 `RuleManager.addRule` 的互斥键同口径：toolName + contentPattern） */
function ruleKey(rule: {
  toolName: string;
  contentPattern?: string;
}): string {
  return `${rule.toolName}|${rule.contentPattern ?? ''}`;
}

export interface ApplyToolRuleSeedResult {
  /** 本次新增条数 */
  applied: number;
  /** 已应用过该版本 ⇒ 整体跳过 */
  skipped: boolean;
}

/**
 * 把种子规则补进规则库（**只补缺、不覆盖、不复活**）。
 *
 * @param deps `loadRules` / `addRule` 由调用方注入（生产 = `RuleManager`，测试 = 内存桩）
 */
export function applyToolRuleSeed(
  deps: {
    loadRules: () => readonly PermissionRule[];
    addRule: (rule: PermissionRule) => void;
    markerPath?: string;
  },
  seed: ToolRuleSeed = DEFAULT_TOOL_RULE_SEED
): ApplyToolRuleSeedResult {
  const markerPath = deps.markerPath ?? defaultMarkerPath();
  if (readAppliedVersion(markerPath) >= seed.version) {
    return { applied: 0, skipped: true };
  }

  const existing = new Set(deps.loadRules().map(ruleKey));
  let applied = 0;
  for (const entry of seed.rules) {
    const key = ruleKey(entry);
    if (existing.has(key)) continue;
    deps.addRule(
      createPermissionRule({
        behavior: entry.behavior as PermissionBehavior,
        toolName: entry.toolName,
        ...(entry.contentPattern ? { contentPattern: entry.contentPattern } : {}),
      })
    );
    existing.add(key);
    applied += 1;
  }
  writeAppliedVersion(markerPath, seed.version);
  logger.info('工具规则播种完成（只补缺失项，不覆盖用户规则）', {
    seedVersion: seed.version,
    applied,
    total: seed.rules.length,
  });
  return { applied, skipped: false };
}
