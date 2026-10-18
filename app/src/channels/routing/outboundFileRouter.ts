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
 * 出站文件路由（2026-08-20 spec qq-file-transfer；**2026-10-17 修订可外发资格**）
 *
 * 从 AI 最终回复文本中提取本地文件路径，过滤后经渠道 sendFile 发送。
 * 覆盖两类场景："**本轮产出**的文件发给我" + "（交付面内的）已有附件发给我"。
 *
 * 安全边界（2026-10-17 修订，见 `filterSendableFiles` 头注）：
 * - **资格是白名单式的**：只有在**交付面**（`~/.pyapp/{output,downloads,attachments}`）内、
 *   或**本轮新产出**（mtime ≥ 本轮起点）的文件才外发；其余**静默忽略**（叙述性路径）
 * - 资格判定用 **realpath** ⇒ 交付面内的符号链接**不可**指向面外（防绕过）
 * - 单文件 ≤30MB（QQ 富媒体上限）；单条回复最多随附 2 个文件（被动配额保护）
 */

import { readFileSync, realpathSync, statSync, type Stats } from 'fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';
import {
  resolveAttachmentsDir,
  resolveDownloadsDir,
  resolveOutputDir,
} from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('channels:routing');

/** QQ 富媒体单文件上限 30MB */
const MAX_FILE_BYTES = 30 * 1024 * 1024;

/** 单条回复最多随附文件数（QQ 被动回复 5 条配额：文本 1 + 工具通知 1 + 文件 ≤2 + 余量） */
const MAX_FILES_PER_REPLY = 2;

/** 本轮产出的时间容差（毫秒）：吸收「工具写盘」与「请求起点」之间的时钟/精度抖动 */
const FRESH_MTIME_EPSILON_MS = 2000;

/** 提取结果 */
export interface ExtractedFiles {
  /** 可发送文件路径（截断至 MAX_FILES_PER_REPLY） */
  sendable: string[];
  /** 跳过项及原因（用于文本反馈） */
  skipped: Array<{ path: string; reason: string }>;
}

/**
 * 从回复文本提取本地文件路径
 *
 * 识别四类形态（AI 输出惯例）：
 * 1. 反引号包裹的 Windows 绝对路径：`C:\Users\x\文档.docx`
 * 2. 裸 Windows 绝对路径（无空格段）
 * 3. 反引号包裹的主目录简写：`~/pyapp/output/x.md`（模型常用；允许含空格）
 * 4. 裸主目录简写：`~/pyapp/output/x.md`
 *
 * 为什么认 `~/`（2026-10-17 真机）：模型在正文里写 `~/.pyapp/output/xxx.md`，
 * 而提取器只认 `C:\…` ⇒ 候选为 0、**零日志静默退出**，用户什么也收不到
 * （当时文件实际也不在该目录，见 `FileWriteTool` 回执修复）。
 */
export function extractLocalFilePaths(content: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  // 1) 反引号包裹（允许含空格，如 Program Files）
  const backtickRe = /`([A-Za-z]:\\[^`]+)`/g;
  for (const m of content.matchAll(backtickRe)) {
    pushUnique(paths, seen, m[1]!.trim());
  }

  // 2) 裸路径（不含空格/中文标点结尾）
  // ⚠️ 在**剔除反引号片段**后的文本上匹配：否则 `~/a b.md` 里的 `~/a` 会被当成另一个候选
  const bareText = content.replace(/`[^`]*`/g, ' ');
  const bareRe = /[A-Za-z]:\\[^\s*"'<>|，。；！？）】`]+/g;
  for (const m of bareText.matchAll(bareRe)) {
    pushUnique(paths, seen, m[0].replace(/[.,;:!?)]+$/, ''));
  }

  // 3) 反引号包裹的 `~/…` / `~\…`（允许含空格）
  const tildeBacktickRe = /`(~[\\/][^`]+)`/g;
  for (const m of content.matchAll(tildeBacktickRe)) {
    pushUnique(paths, seen, expandTildePath(m[1]!.trim()));
  }

  // 4) 裸 `~/…` / `~\…`
  const tildeBareRe = /~[\\/][^\s*"'<>|，。；！？）】`]+/g;
  for (const m of bareText.matchAll(tildeBareRe)) {
    pushUnique(paths, seen, expandTildePath(m[0].replace(/[.,;:!?)]+$/, '')));
  }

  return paths;
}

/** `~/…` / `~\…` ⇒ 绝对路径（其它形态原样返回） */
export function expandTildePath(p: string): string {
  if (!p.startsWith('~')) return p;
  const rest = p.slice(1).replace(/^[\\/]+/, '');
  // `~\a\b` 是 Windows 风格写法：POSIX 上反斜杠会被 resolve 当作普通文件名字符
  // ⇒ 先归一为 `/`，否则同一输入在 Windows/Linux 得到不同路径（CI 实测）。
  const normalized =
    process.platform === 'win32' ? rest : rest.replace(/\\/g, '/');
  return resolve(homedir(), normalized);
}

function pushUnique(paths: string[], seen: Set<string>, p: string): void {
  const key = p.toLowerCase();
  if (!seen.has(key)) {
    seen.add(key);
    paths.push(p);
  }
}

/** `filterSendableFiles` 的判定入参 */
export interface SendableFilterOptions {
  /**
   * 本轮请求的起点（毫秒；缺省 ⇒ **只认交付面**）。用于识别「**本轮新产出**的文件」。
   */
  runStartedAtMs?: number;
}

/** `realpathSync` 的安全包装（不存在 / 权限不足 ⇒ `null`，不抛） */
function realpathOf(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * 交付面（可外发目录，spec `qq-file-transfer.md` §3.2③ 原意）：
 * `~/.pyapp/{output,downloads,attachments}`。返回值已 **realpath + 补尾分隔符**
 * （防 `outputs/` 之类前缀误命中）。
 */
function sendableSurfaces(): string[] {
  return [
    resolveOutputDir(),
    resolveDownloadsDir(),
    resolveAttachmentsDir(),
  ].map((d) => `${realpathOf(d) ?? resolve(d)}${sep}`);
}

function isUnder(realPath: string, surfaceWithSep: string): boolean {
  return realPath.toLowerCase().startsWith(surfaceWithSep.toLowerCase());
}

/**
 * 过滤可发送文件：存在性 + **可外发资格** + 大小 + 数量截断。
 *
 * **可外发资格（2026-10-17 修订 —— 本条即「频繁误触发」的修复）**：满足其一即放行 ——
 * ① **在交付面内**（`~/.pyapp/{output,downloads,attachments}`；判定用 **realpath** ⇒ 面内符号链接
 *    指向面外时**不**放行，防绕过）；
 * ② **本轮新产出**（`mtime ≥ runStartedAtMs − 2s`）—— 覆盖「工具刚写出来的文件」；
 * 两者都不满足 ⇒ **静默忽略**（按「叙述性路径」处理，既不投递、也不产生用户可见噪音）。
 *
 * 为什么必须改（真机实证 2026-10-17）：旧判定只有「存在 + 非禁区」⇒ 只要回复正文里**回显**一个
 * 已存在的路径（如让模型 `file_read` 某源码后复述其路径）就会被当成投递意图 —— 连续两条真机消息
 * **各误触发一次**（其中一次还因上传口径错误把「⚠️ 文件未能发送」推给了用户）。
 *
 * 仍**如实告知**（`skipped`）的只剩两类：**超 30MB** 与 **单条超 2 个** —— 这两类是「用户本该拿到
 * 却没发出去」，必须不静默（守 CS03）。
 *
 * **内容去重（2026-10-17 真机）**：模型曾把同一份内容同时写到项目 `output/` 与 `~/.pyapp/output/`
 * 两个路径并都写进正文 ⇒ 用户收到两个同名同大小的附件。故按 **MD5** 去重（首个保留，其余**静默**
 * 跳过 —— 这不是失败，无需噪音）。读盘失败时退回按路径处理（不因去重而漏发）。
 */
export function filterSendableFiles(
  paths: string[],
  opts: SendableFilterOptions = {}
): ExtractedFiles {
  const sendable: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const seenHashes = new Set<string>();
  const surfaces = sendableSurfaces();
  const freshSince =
    opts.runStartedAtMs === undefined
      ? undefined
      : opts.runStartedAtMs - FRESH_MTIME_EPSILON_MS;

  for (const p of paths) {
    let stat: Stats;
    try {
      stat = statSync(p);
    } catch {
      continue; // 不存在的路径是 AI 叙述性文本，静默忽略
    }
    if (!stat.isFile()) {
      continue;
    }

    const real = realpathOf(p);
    const inSurface = real !== null && surfaces.some((s) => isUnder(real, s));
    const isFresh = freshSince !== undefined && stat.mtimeMs >= freshSince;
    if (!inSurface && !isFresh) {
      logger.debug('出站文件：不在交付面且非本轮产出 ⇒ 忽略（叙述性路径）', {
        path: p,
      });
      continue;
    }

    if (stat.size > MAX_FILE_BYTES) {
      skipped.push({
        path: p,
        reason: `超过 30MB 上限（${(stat.size / 1024 / 1024).toFixed(1)}MB）`,
      });
      continue;
    }
    // 同一份内容只发一次（模型可能把文件复制到第二个目录并同时写进正文）
    const hash = contentHashOf(p);
    if (hash !== null) {
      if (seenHashes.has(hash)) {
        logger.info('出站文件：内容与已选文件相同 ⇒ 跳过重复副本', { path: p });
        continue;
      }
      seenHashes.add(hash);
    }
    if (sendable.length >= MAX_FILES_PER_REPLY) {
      skipped.push({ path: p, reason: '单条回复最多随附 2 个文件' });
      continue;
    }
    sendable.push(p);
  }

  return { sendable, skipped };
}

/** 文件内容 MD5（读失败 ⇒ `null`，由调用方按"无法判重"处理，不因去重漏发） */
function contentHashOf(p: string): string | null {
  try {
    return createHash('md5').update(readFileSync(p)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * 出站文件发送编排（由 messageRouter 在文本回复送达后调用）
 *
 * @param content  AI 最终回复文本（从中提取文件路径）
 * @param target   出站目标（conversationId）
 * @param traceId  全链路追踪 ID
 * @param onOutboundFile 渠道文件发送回调
 * @param onOutbound     文本回调（用于失败/跳过反馈）
 * @param opts     可外发资格判定入参（`runStartedAtMs` ⇒ 本轮产出识别）
 */
export async function sendOutboundFiles(
  content: string,
  target: string,
  traceId: string,
  onOutboundFile: (filePath: string, target: string) => Promise<void>,
  onOutbound?: (content: string, target: string) => Promise<void>,
  opts: SendableFilterOptions = {}
): Promise<void> {
  const candidatePaths = extractLocalFilePaths(content);
  if (candidatePaths.length === 0) {
    return; // 多数回复不含文件路径，零开销退出
  }

  const { sendable, skipped } = filterSendableFiles(candidatePaths, opts);
  if (sendable.length === 0 && skipped.length === 0) {
    return; // 均为叙述性路径（不存在），不干预
  }

  logger.info(`[TRACE] ${traceId} outbound_files 阶段开始`, {
    target,
    candidates: candidatePaths.length,
    sendable: sendable.length,
    skipped: skipped.length,
  });

  const failures: Array<{ path: string; reason: string }> = [...skipped];
  for (const filePath of sendable) {
    try {
      await onOutboundFile(filePath, target);
      logger.info(`[TRACE] ${traceId} outbound_files 单文件发送成功`, {
        target,
        filePath,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failures.push({ path: filePath, reason });
      logger.warning(`[TRACE] ${traceId} outbound_files 单文件发送失败`, {
        target,
        filePath,
        reason: reason.slice(0, 200),
      });
    }
  }

  // 反馈文本：任一文件未送达时补发一条说明（文本已送达是事实，不抛错）
  if (failures.length > 0 && onOutbound) {
    const lines = failures.map((f) => `· ${f.path} — ${f.reason}`);
    try {
      await onOutbound(`⚠️ 以下文件未能发送：\n${lines.join('\n')}`, target);
    } catch (fbErr) {
      // @ignore-catch — 反馈文本发送失败不影响主流程（文本回复已送达）
      logger.warning(`[TRACE] ${traceId} outbound_files 反馈文本发送失败`, {
        reason: String(fbErr).slice(0, 100),
      });
    }
  }
}
