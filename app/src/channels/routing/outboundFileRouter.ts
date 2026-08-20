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
 * 出站文件路由（2026-08-20 spec qq-file-transfer）
 *
 * 从 AI 最终回复文本中提取本地文件路径，过滤后经渠道 sendFile 发送。
 * 覆盖两类场景："找到已有文档发给我" + "生成文件发给我"。
 *
 * 安全边界：
 * - 路径必须真实存在且是文件（fs.statSync 校验）
 * - 禁止 ~/.pyapp/ 根（配置/DB/密钥）与系统目录（Windows/Program Files）
 * - 单文件 ≤30MB（QQ 富媒体上限）；单条回复最多随附 2 个文件（被动配额保护）
 */

import { statSync, type Stats } from 'fs';
import { resolvePyappHome } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';

/** QQ 富媒体单文件上限 30MB */
const MAX_FILE_BYTES = 30 * 1024 * 1024;

/** 单条回复最多随附文件数（QQ 被动回复 5 条配额：文本 1 + 工具通知 1 + 文件 ≤2 + 余量） */
const MAX_FILES_PER_REPLY = 2;

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
 * 识别两类形态（AI 输出惯例）：
 * 1. 反引号包裹：`C:\Users\x\文档.docx`
 * 2. 裸 Windows 绝对路径（无空格段）
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
  const bareRe = /[A-Za-z]:\\[^\s*"'<>|，。；！？）】`]+/g;
  for (const m of content.matchAll(bareRe)) {
    pushUnique(paths, seen, m[0].replace(/[.,;:!?)]+$/, ''));
  }

  return paths;
}

function pushUnique(paths: string[], seen: Set<string>, p: string): void {
  const key = p.toLowerCase();
  if (!seen.has(key)) {
    seen.add(key);
    paths.push(p);
  }
}

/**
 * 过滤可发送文件：存在性 + 安全目录 + 大小 + 数量截断
 */
export function filterSendableFiles(paths: string[]): ExtractedFiles {
  const sendable: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  const pyappHome = resolvePyappHome().toLowerCase();
  const lowered = (p: string) => p.toLowerCase();
  const isForbidden = (p: string): string | undefined => {
    const lp = lowered(p);
    if (lp.startsWith(pyappHome)) {
      return '应用数据目录（含配置与密钥）禁止外发';
    }
    if (/\\windows\\/.test(lp) || /\\program files( \(x86\))?\\/.test(lp)) {
      return '系统目录禁止外发';
    }
    return undefined;
  };

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
    const forbiddenReason = isForbidden(p);
    if (forbiddenReason) {
      skipped.push({ path: p, reason: forbiddenReason });
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) {
      skipped.push({
        path: p,
        reason: `超过 30MB 上限（${(stat.size / 1024 / 1024).toFixed(1)}MB）`,
      });
      continue;
    }
    if (sendable.length >= MAX_FILES_PER_REPLY) {
      skipped.push({ path: p, reason: '单条回复最多随附 2 个文件' });
      continue;
    }
    sendable.push(p);
  }

  return { sendable, skipped };
}

const logger = getLogger('channels:routing');

/**
 * 出站文件发送编排（由 messageRouter 在文本回复送达后调用）
 *
 * @param content  AI 最终回复文本（从中提取文件路径）
 * @param target   出站目标（conversationId）
 * @param traceId  全链路追踪 ID
 * @param onOutboundFile 渠道文件发送回调
 * @param onOutbound     文本回调（用于失败/跳过反馈）
 */
export async function sendOutboundFiles(
  content: string,
  target: string,
  traceId: string,
  onOutboundFile: (filePath: string, target: string) => Promise<void>,
  onOutbound?: (content: string, target: string) => Promise<void>
): Promise<void> {
  const candidatePaths = extractLocalFilePaths(content);
  if (candidatePaths.length === 0) {
    return; // 多数回复不含文件路径，零开销退出
  }

  const { sendable, skipped } = filterSendableFiles(candidatePaths);
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
