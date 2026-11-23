// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 未知命令采样（P2-A，2026-11-17；R4 改造 2026-11-17）—— 审批缺口的**结构化闭环**。
 *
 * 背景：`auto` 档对未收录命令 fail-closed（ask）；此前 `AutoModeClassifier` 只在日志里
 * 记一条 `permission:unknown_command`，没有消费方 ⇒ 缺口永远收敛不了（真机会话
 * `session_mwk2fakzf30b34b448` 的 19 张审批卡即由此类累计）。
 *
 * 本模块把采样落到本地 JSONL（append-only）：`<pyapp-home>/data/permission/unknown-commands.jsonl`。
 * 只做**记录**，不参与任何放行判定；评审后由人改白名单/规则（不做运行时自动学习）。
 *
 * R4（治理方案 §4.1）四项改造：
 * 1. **落盘前去敏**：复用 `security/redact` 的唯一出口（`redactSensitiveText`）；
 * 2. **补字段**：`shell / os / permissionMode / autonomy / decision / segmentIndex / blockedBy`
 *    + `headSeq / surfaceLength`（频次与截断可解释）；
 * 3. **计数口径**：同一 head **每次出现都落一行**（`headSeq` 递增），全进程上限 50 行
 *    —— 此前是"每进程每 head 一次"，重启即归零、也拿不到频次；
 * 4. **轮转**：单文件 ≥ 5 MB 或**跨月**时，把当前文件改名为
 *    `unknown-commands.<YYYY-MM>[-<epoch>].jsonl` 后重新开始（活跃路径恒定，周报脚本无需改）。
 *
 * 覆盖：`PERMISSION_UNKNOWN_COMMAND_LOG` 可指定文件路径、`PERMISSION_UNKNOWN_COMMAND_LOG_MAX_BYTES`
 * 可调整轮转阈值（测试/排障用）。
 */
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { configManager } from '@openliri/infra/config';
import { resolvePyappHome } from '@openliri/infra/environment';
import { getLogger } from '@openliri/infra/monitoring';
import { redactSensitiveText } from '@openliri/infra/security';

const logger = getLogger('permission:unknownCommandSamples');

/** 命令原文（去敏后）落盘的最大长度 */
export const UNKNOWN_COMMAND_SURFACE_MAX_CHARS = 120;

/** 命令名落盘的最大长度 */
export const UNKNOWN_COMMAND_HEAD_MAX_CHARS = 60;

/** 每进程最多落多少行（超出后只计数、不再写盘） */
export const MAX_UNKNOWN_COMMAND_SAMPLES_PER_PROCESS = 50;

/** 单文件轮转阈值（默认 5 MB） */
export const DEFAULT_UNKNOWN_COMMAND_LOG_MAX_BYTES = 5 * 1024 * 1024;

/** 命令方言（入参为 `command` 文本的 shell 工具） */
export type UnknownCommandShell = 'bash' | 'pwsh' | 'cmd';

/** 归因：为什么这条调用需要审批（当前采样点只有分类器兜底） */
export type UnknownCommandBlockedBy =
  | 'rule'
  | 'classifier'
  | 'readonly-miss';

export interface UnknownCommandSample {
  /** 命令名（首个 token，小写，≤60 字符） */
  head: string;
  /** 采样时间（epoch ms） */
  at: number;
  /** 命令原文（**已去敏**，≤120 字符；仅用于评审归类） */
  surface: string;
  /** 去敏/截断前的原文长度（判断"截断是否影响归类"） */
  surfaceLength: number;
  /** 同一 head 在本进程内第几次出现（1 起；用于频次口径） */
  headSeq: number;
  /** 命令方言 */
  shell: UnknownCommandShell;
  /** 平台（`process.platform`） */
  os: string;
  /** 权限档（调用方未提供 ⇒ 缺省不写） */
  permissionMode?: string;
  /** 会话自主度（调用方未提供 ⇒ 缺省不写） */
  autonomy?: string;
  /** 本次判定的结论（当前采样点恒为 ask；保留 allow/deny 供未来采样点复用） */
  decision: 'ask' | 'allow' | 'deny';
  /** 需要审批的片段序号（1 起；无法分段 ⇒ 1） */
  segmentIndex: number;
  /** 归因：规则 / 分类器 / 结构只读未命中 */
  blockedBy: UnknownCommandBlockedBy;
}

/** 采样文件路径（env 覆盖优先，经统一出入口 configManager.env，R05-012） */
export function resolveUnknownCommandLogPath(): string {
  const override = configManager.env('PERMISSION_UNKNOWN_COMMAND_LOG')?.trim();
  if (override) return override;
  return join(
    resolvePyappHome(),
    'data',
    'permission',
    'unknown-commands.jsonl'
  );
}

/** 轮转阈值（env 可覆盖，便于测试与运维压缩；经统一出入口 configManager.env，R05-012） */
export function resolveUnknownCommandLogMaxBytes(): number {
  const raw = Number(
    configManager.env('PERMISSION_UNKNOWN_COMMAND_LOG_MAX_BYTES')
  );
  return Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_UNKNOWN_COMMAND_LOG_MAX_BYTES;
}

/** 月份键（`YYYY-MM`，本地时区 —— 与人的"按月切分"直觉一致） */
export function monthKeyOf(epochMs: number): string {
  const d = new Date(epochMs);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${month}`;
}

/**
 * 是否需要轮转（纯函数，便于单测）。
 *
 * @param sizeBytes 当前文件字节数
 * @param fileMtimeMs 当前文件最后修改时间
 * @param nowMs 当前时间
 * @param maxBytes 单文件上限
 * @returns `'size'` / `'month'` / `null`（不需要轮转）
 */
export function decideUnknownCommandLogRotation(
  sizeBytes: number,
  fileMtimeMs: number,
  nowMs: number,
  maxBytes: number = DEFAULT_UNKNOWN_COMMAND_LOG_MAX_BYTES
): 'size' | 'month' | null {
  if (sizeBytes >= maxBytes) return 'size';
  if (monthKeyOf(fileMtimeMs) !== monthKeyOf(nowMs)) return 'month';
  return null;
}

/** 轮转目标文件名：`<base>.<YYYY-MM>.jsonl`（同月重名 ⇒ 追加时间戳） */
export function resolveRotationTargetPath(
  path: string,
  fileMtimeMs: number,
  nowMs: number
): string {
  const dir = dirname(path);
  const base = basename(path, '.jsonl');
  const stamp = monthKeyOf(fileMtimeMs);
  const primary = join(dir, `${base}.${stamp}.jsonl`);
  if (!existsSync(primary)) return primary;
  return join(dir, `${base}.${stamp}.${nowMs}.jsonl`);
}

/** 异步轮转（失败只 debug：采样属旁路观测，不能因轮转影响判定） */
async function rotateIfNeeded(path: string): Promise<void> {
  try {
    const info = await stat(path);
    const reason = decideUnknownCommandLogRotation(
      info.size,
      info.mtimeMs,
      Date.now(),
      resolveUnknownCommandLogMaxBytes()
    );
    if (!reason) return;
    const target = resolveRotationTargetPath(path, info.mtimeMs, Date.now());
    await rename(path, target);
    logger.info('未知命令采样文件已轮转', {
      reason,
      from: path,
      to: target,
      sizeBytes: info.size,
    });
  } catch (err) {
    // @ignore-catch — 文件不存在（首次写入）/ 并发轮转失败都不应影响采样
    logger.debug('未知命令采样轮转跳过', { path, error: String(err) });
  }
}

// ─── 进程内计数（R4：每 head 计数 + 全进程上限）──────────────────────────────

const headCounts = new Map<string, number>();
let writtenSamples = 0;

/** 仅供测试：清空进程内计数（生产不应调用） */
export function resetUnknownCommandSampleStateForTest(): void {
  headCounts.clear();
  writtenSamples = 0;
}

/** 当前进程已写行数（测试 / 诊断用） */
export function getUnknownCommandSampleWriteCount(): number {
  return writtenSamples;
}

/**
 * 登记一次出现（返回是否写盘 + 该 head 的序号）。
 *
 * 上限只限制**写盘行数**，计数仍继续（`headSeq` 能反映真实出现次数）。
 */
export function shouldRecordUnknownCommandSample(head: string): {
  record: boolean;
  headSeq: number;
} {
  const headSeq = (headCounts.get(head) ?? 0) + 1;
  headCounts.set(head, headSeq);
  if (writtenSamples >= MAX_UNKNOWN_COMMAND_SAMPLES_PER_PROCESS) {
    return { record: false, headSeq };
  }
  writtenSamples += 1;
  return { record: true, headSeq };
}

/** 命令原文 → 命令名（小写首 token） */
export function extractCommandSampleHead(surface: string): string {
  return (
    surface.trim().split(/\s+/)[0]?.toLowerCase().slice(0, UNKNOWN_COMMAND_HEAD_MAX_CHARS) ??
    ''
  );
}

/** 工具名 → 命令方言 */
function resolveShellDialect(toolName: string): UnknownCommandShell {
  const lower = toolName.toLowerCase();
  if (lower === 'powershell' || lower === 'pwsh') return 'pwsh';
  return 'bash';
}

/**
 * 组装一条采样记录（**纯函数**：去敏 + 截断 + 字段补全，不写盘）。
 *
 * @returns `head` 为空或不该写盘（进程内已达上限）⇒ `null`
 */
export function buildUnknownCommandSample(params: {
  /** 完整命令原文（未去敏；通常为"需要审批的那一段"） */
  surface: string;
  toolName: string;
  permissionMode?: string;
  autonomy?: string;
  segmentIndex?: number;
  decision?: 'ask' | 'allow' | 'deny';
  blockedBy?: UnknownCommandBlockedBy;
  /** 注入时间（测试用） */
  now?: number;
}): UnknownCommandSample | null {
  const rawSurface = params.surface.trim();
  const head = extractCommandSampleHead(rawSurface);
  if (!head) return null;

  const { record, headSeq } = shouldRecordUnknownCommandSample(head);
  if (!record) return null;

  return {
    head,
    at: params.now ?? Date.now(),
    surface: redactSensitiveText(rawSurface).text.slice(
      0,
      UNKNOWN_COMMAND_SURFACE_MAX_CHARS
    ),
    surfaceLength: rawSurface.length,
    headSeq,
    shell: resolveShellDialect(params.toolName),
    os: process.platform,
    ...(params.permissionMode ? { permissionMode: params.permissionMode } : {}),
    ...(params.autonomy ? { autonomy: params.autonomy } : {}),
    decision: params.decision ?? 'ask',
    segmentIndex: Math.max(1, params.segmentIndex ?? 1),
    blockedBy: params.blockedBy ?? 'classifier',
  };
}

/**
 * 追加一条采样（fire-and-forget；失败只 debug，不影响判定）。
 *
 * 写前先做**轮转判定**（单文件 5 MB / 跨月），保证单文件不会无限增长。
 */
export function appendUnknownCommandSample(sample: UnknownCommandSample): void {
  const path = resolveUnknownCommandLogPath();
  void (async () => {
    try {
      await mkdir(dirname(path), { recursive: true });
      await rotateIfNeeded(path);
      await appendFile(path, `${JSON.stringify(sample)}\n`, 'utf8');
    } catch (err) {
      // @ignore-catch — 采样属旁路观测，失败不得影响权限判定（CS03）
      logger.debug('未知命令采样写入失败（忽略）', {
        path,
        error: String(err),
      });
    }
  })();
}

/**
 * 采样入口（判定侧调用）：组装 + 落盘 + 结构化日志。
 *
 * @param params 见 `buildUnknownCommandSample`（额外带 `toolName`）
 */
export function sampleUnknownCommand(params: {
  surface: string;
  toolName: string;
  permissionMode?: string;
  autonomy?: string;
  segmentIndex?: number;
  decision?: 'ask' | 'allow' | 'deny';
  blockedBy?: UnknownCommandBlockedBy;
}): void {
  const sample = buildUnknownCommandSample(params);
  if (!sample) return;
  appendUnknownCommandSample(sample);
  logger.info(
    'permission:unknown_command（未收录命令已转审批，供每周采样评审）',
    {
      head: sample.head,
      headSeq: sample.headSeq,
      segmentIndex: sample.segmentIndex,
      shell: sample.shell,
      permissionMode: sample.permissionMode,
      autonomy: sample.autonomy,
    }
  );
}
