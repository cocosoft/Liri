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
 * approvalFingerprint — 「始终允许 / 本会话都允许」的**授权维度**计算（PR-2，2026-10-23）
 *
 * 问题：直接用全参数稳定 JSON 当指纹，对 `file_write` 几乎永不命中 —— `content`
 * 每次都不同，等于「始终允许」形同虚设（方案 §3.2）。
 *
 * 方案：工具可**可选**声明 `approvalFingerprint(input)` 指定自己的授权维度
 * （如 `file_write` 只按路径），缺省仍是全参数稳定 JSON（零行为变更）。
 *
 * 分层约束（R00-001）：本模块属 permission（infra），只依赖**结构化接口**
 * （`{ name, approvalFingerprint? }`），不 import `tools/`。
 */
import { toolCallApprovalKey } from './ApprovedCommandRegistry';

/** 可声明授权维度的工具（结构类型，避免 permission → tools 反向依赖） */
export interface ApprovalFingerprintDeclaringTool {
  name: string;
  approvalFingerprint?(input: Record<string, unknown>): string;
}

/**
 * 计算一次调用的授权指纹。
 *
 * 优先级：工具声明（`approvalFingerprint`）> 全参数稳定 JSON（`toolCallApprovalKey`）。
 * 声明抛错 / 返回空串 ⇒ **回退全参数指纹**（保守：只会更严，不会放宽）。
 */
export function resolveApprovalFingerprint(
  toolOrName: ApprovalFingerprintDeclaringTool | string,
  input: Record<string, unknown> = {}
): string {
  const toolName =
    typeof toolOrName === 'string' ? toolOrName : toolOrName.name;
  if (
    typeof toolOrName !== 'string' &&
    typeof toolOrName.approvalFingerprint === 'function'
  ) {
    try {
      const declared = toolOrName.approvalFingerprint(input);
      if (typeof declared === 'string' && declared.length > 0) return declared;
    } catch {
      // 声明实现抛错 ⇒ 回退全参数指纹（不因声明缺陷而放宽授权）
    }
  }
  return toolCallApprovalKey(toolName, input);
}

/**
 * 路径型指纹归一化：去首尾空白、统一分隔符为 `/`、Windows 下转小写。
 *
 * 不做 `resolve()`（相对路径的基准目录由工具执行期的 `context` 决定，
 * 权限层拿不到）—— 只保证"同一路径文本 ⇒ 同一指纹"。
 */
export function normalizeApprovalPath(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().replace(/\\/g, '/').replace(/\/+$/g, '');
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

/**
 * 指纹的可读预览（≤120 字）—— 供审批卡 / 撤销列表展示，**不落库明文参数**。
 */
export function previewApprovalFingerprint(fingerprint: string): string {
  return fingerprint.length > 120
    ? `${fingerprint.slice(0, 117)}...`
    : fingerprint;
}
