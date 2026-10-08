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
 * AI-VFS 只读试点 —— 契约类型与错误码（权威依据：`.trae/specs/ai-vfs-readonly-pilot.md` v1.1
 * 与 `.trae/specs/ai-vfs-driver-contract.md` §3）。
 *
 * 命名空间形态：`<scheme>://<authority>[/<path>]`。
 * - `VfsPath` 由 `VfsPath.ts` 的 `parseVfsPath()` **结构化解析**产出（**禁止**用字符串前缀做业务判定，CS02）。
 * - 未注册 `scheme` ⇒ `VFS_UNKNOWN_MOUNT`（**不**回退本地文件系统，CS03）。
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

/** 结构化 VFS 路径：`<scheme>://<authority>[/<path>]` */
export interface VfsPath {
  /** 命名空间 scheme（挂载点键） */
  readonly scheme: string;
  /** 授权段（首段；无则为空串） */
  readonly authority: string;
  /** 授权段之后的剩余路径（无则为空串） */
  readonly path: string;
}

/** 目录枚举条目 */
export interface VfsEntry {
  /** 相对被列举目录的名称（非递归 = basename；递归 = 子路径） */
  readonly name: string;
  readonly kind: 'file' | 'dir';
  readonly size?: number;
  readonly mtime?: number;
}

/** `stat_vfs` 结果 */
export interface VfsStat {
  readonly kind: 'file' | 'dir';
  readonly size: number;
  readonly mtime: number;
  readonly mimeType?: string;
  /** 承载该书目的挂载点 scheme */
  readonly mount: string;
  readonly readOnly: boolean;
}

/** `read_vfs` 结果 */
export interface VfsReadResult {
  readonly data: string;
  readonly mimeType: string;
  readonly size: number;
  readonly truncated: boolean;
}

/** `write_vfs` 入参 */
export interface VfsWriteInput {
  readonly content: string;
  readonly mode: 'create' | 'overwrite' | 'append';
}

/** `write_vfs` 结果 */
export interface VfsWriteResult {
  readonly written: number;
  readonly path: string;
}

/** 驱动运行时能力声明 —— 决定 4 系统调用中哪些可达 */
export interface VfsDriverCapabilities {
  readonly read: boolean;
  readonly write: boolean;
  readonly list: boolean;
}

/**
 * 挂载点驱动契约（照 `ai-vfs-driver-contract.md` §3.3）。
 *
 * ⚠️ 驱动**不**自行裁决权限（权限由工具层统一裁决）—— 但路径安全（归一化 / 逃逸拒绝 /
 * 宿主路径过 `PathGuard`）是驱动底座自身的职责，任何驱动实现都必须做。
 */
export interface IVfsDriver {
  readonly capabilities: VfsDriverCapabilities;
  list(
    path: VfsPath,
    opts: { recursive: boolean; limit: number }
  ): Promise<VfsEntry[]>;
  stat(path: VfsPath): Promise<VfsStat>;
  read(
    path: VfsPath,
    range?: { offset: number; limit: number }
  ): Promise<VfsReadResult>;
  write(path: VfsPath, data: VfsWriteInput): Promise<VfsWriteResult>;
}

/** VFS 稳定错误码（统一经 `AppError.code` 承载，禁止裸字符串，CS06） */
export type VfsErrorCode =
  | 'VFS_UNKNOWN_MOUNT'
  | 'VFS_NOT_FOUND'
  | 'VFS_IS_DIR'
  | 'VFS_NOT_DIR'
  | 'VFS_DENIED'
  | 'VFS_READ_ONLY_MOUNT'
  | 'VFS_CONFLICT';

/** 错误码 → 分类映射（严重度统一 MEDIUM，除权限类为 HIGH） */
const CATEGORY_BY_CODE: Record<VfsErrorCode, ErrorCategory> = {
  VFS_UNKNOWN_MOUNT: ErrorCategory.VALIDATION,
  VFS_NOT_FOUND: ErrorCategory.FILESYSTEM,
  VFS_IS_DIR: ErrorCategory.FILESYSTEM,
  VFS_NOT_DIR: ErrorCategory.FILESYSTEM,
  VFS_DENIED: ErrorCategory.PERMISSION,
  VFS_READ_ONLY_MOUNT: ErrorCategory.PERMISSION,
  VFS_CONFLICT: ErrorCategory.VALIDATION,
};

const SEVERITY_BY_CODE: Record<VfsErrorCode, ErrorSeverity> = {
  VFS_UNKNOWN_MOUNT: ErrorSeverity.MEDIUM,
  VFS_NOT_FOUND: ErrorSeverity.LOW,
  VFS_IS_DIR: ErrorSeverity.LOW,
  VFS_NOT_DIR: ErrorSeverity.LOW,
  VFS_DENIED: ErrorSeverity.HIGH,
  VFS_READ_ONLY_MOUNT: ErrorSeverity.MEDIUM,
  VFS_CONFLICT: ErrorSeverity.MEDIUM,
};

/** 构造带稳定错误码的 VFS `AppError` */
export function vfsError(
  code: VfsErrorCode,
  message: string,
  context?: Record<string, unknown>
): AppError {
  return new AppError(
    message,
    CATEGORY_BY_CODE[code],
    SEVERITY_BY_CODE[code],
    code,
    context
  );
}
