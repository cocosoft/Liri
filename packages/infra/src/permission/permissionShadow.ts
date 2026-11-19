/**
 * 权限 **B3 影子台账**（2026-11-19）—— **只记录、不改变任何判定**。
 *
 * 背景：B3 的两处收紧（`demandHardDeny` 硬拒词表、`demandAutoAllowQuota` 每会话配额）上线后
 * 一直是"零真实样本"：命中率、误拒率、命令分布都只能靠翻日志人工数。本模块给它们补一个
 * **观察模式**（`PERMISSION_SHADOW=true`，默认关）：
 *
 * - `hard_deny_hit`：demand 自动放行候选被硬拒词表按住（**判定不变**，仍回落 ask）；
 * - `quota_hit`：配额已用满（**判定不变**，仍回落 ask）。
 *
 * 为什么**不改判定**：静默放行 `runas` / `msiexec` / `powershell -enc` 属安全姿态倒退；
 * 观察目标（阈值是否过严 / 配额定多少）用"命中分布 + 用户后续处置"就能回答，无需放行。
 *
 * 台账：`<dataDir>/permission/deny-shadow.jsonl`（5MB 轮转，失败只留痕不影响判定）。
 * 不落命令全文：只留 ≤200 字符预览；会话 id 只落 8 位哈希。
 */

import { createHash } from 'node:crypto';
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { configManager } from '@openliri/infra/config';
import { resolveDataDir } from '@openliri/infra/environment';
import { handleError } from '@openliri/infra/error';
import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('permission:shadow');

/** 开关（默认关）：只认显式 `true`；进程启动期读一次 */
export function isPermissionShadowEnabled(): boolean {
  return configManager.env('PERMISSION_SHADOW')?.trim().toLowerCase() === 'true';
}

/** 台账路径（`<dataDir>/permission/deny-shadow.jsonl`） */
export function resolvePermissionShadowPath(): string {
  return join(resolveDataDir(), 'permission', 'deny-shadow.jsonl');
}

/** 单文件上限（超出即轮转；影子属短期观测） */
export const PERMISSION_SHADOW_MAX_BYTES = 5 * 1024 * 1024;

/** 命令预览上限（不落全文） */
export const PERMISSION_SHADOW_COMMAND_PREVIEW = 200;

/** 记录类型：两处收紧各一种 */
export type PermissionShadowKind = 'hard_deny_hit' | 'quota_hit';

export interface PermissionShadowRecord {
  at: number;
  kind: PermissionShadowKind;
  /** 生效的权限模式（`context.permissionMode`） */
  mode?: string;
  toolName: string;
  /** 会话 id 的 8 位哈希（不落原值） */
  sessionHash?: string;
  /** 命令预览（仅 `hard_deny_hit`；≤200 字符） */
  commandPreview?: string;
  /** 命中方式（仅 `hard_deny_hit`）：命令头 / 子命令模式 */
  matchedBy?: 'head' | 'pattern';
  /** 命中的命令头或模式描述（仅 `hard_deny_hit`） */
  matched?: string;
  /** 已自动放行次数（仅 `quota_hit`） */
  count?: number;
  /** 生效上限（仅 `quota_hit`） */
  limit?: number;
}

/** 会话 id → 8 位哈希（缺省 ⇒ undefined，不落空串） */
export function hashSessionId(
  sessionId: string | null | undefined
): string | undefined {
  if (!sessionId) return undefined;
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
}

/** 硬拒命中记录（纯函数） */
export function toHardDenyShadowRecord(
  input: {
    toolName: string;
    command?: string;
    sessionId?: string | null;
    mode?: string;
    matched?: string;
    matchedBy?: 'head' | 'pattern';
  },
  now: number = Date.now()
): PermissionShadowRecord {
  const preview = (input.command ?? '').trim().slice(0, PERMISSION_SHADOW_COMMAND_PREVIEW);
  return {
    at: now,
    kind: 'hard_deny_hit',
    toolName: input.toolName,
    ...(input.mode ? { mode: input.mode } : {}),
    ...(hashSessionId(input.sessionId)
      ? { sessionHash: hashSessionId(input.sessionId) }
      : {}),
    ...(preview ? { commandPreview: preview } : {}),
    ...(input.matchedBy ? { matchedBy: input.matchedBy } : {}),
    ...(input.matched ? { matched: input.matched } : {}),
  };
}

/** 配额命中记录（纯函数） */
export function toQuotaShadowRecord(
  input: {
    toolName: string;
    sessionId?: string | null;
    mode?: string;
    count: number;
    limit: number;
  },
  now: number = Date.now()
): PermissionShadowRecord {
  return {
    at: now,
    kind: 'quota_hit',
    toolName: input.toolName,
    ...(input.mode ? { mode: input.mode } : {}),
    ...(hashSessionId(input.sessionId)
      ? { sessionHash: hashSessionId(input.sessionId) }
      : {}),
    count: input.count,
    limit: input.limit,
  };
}

/** 超阈值时把活跃文件改名为 `<base>.<epoch>.jsonl`（失败只 debug） */
async function rotateIfNeeded(file: string): Promise<void> {
  try {
    const info = await stat(file);
    if (info.size < PERMISSION_SHADOW_MAX_BYTES) return;
    const target = `${file.replace(/\.jsonl$/, '')}.${Date.now()}.jsonl`;
    await rename(file, target);
    logger.info('permission:shadow_rotated', {
      from: file,
      to: target,
      sizeBytes: info.size,
    });
  } catch (err) {
    // @ignore-catch — 首次写入时文件不存在属正常；轮转失败不得影响判定
    logger.debug('permission:shadow_rotate_skipped', {
      path: file,
      error: String(err),
    });
  }
}

/**
 * 追加一条影子记录。**失败只留痕**（判定已在调用方完成，不能因观测失败而改变）。
 */
export async function recordPermissionShadow(
  record: PermissionShadowRecord,
  opts: { file?: string } = {}
): Promise<void> {
  const file = opts.file ?? resolvePermissionShadowPath();
  try {
    await mkdir(dirname(file), { recursive: true });
    await rotateIfNeeded(file);
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (err) {
    await handleError(err, {
      module: 'permission:shadow',
      action: 'record',
      context: { kind: record.kind },
    });
  }
}
