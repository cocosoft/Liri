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
 * Landlock 沙箱类型定义（P1，2026-08-25）
 *
 * 对齐参考仓库 `REF/BA_REF/deepseek-harness/native/landlock-run` 的
 * policy.json 契约与 CLI 协议（见 dev_docs/20260824/沙箱隔离机制与Landlock集成方案-20260824.md §4.2）。
 */

/** Landlock 不可用原因 */
export type LandlockUnavailableReason =
  | 'no-linux'
  | 'not-in-lsm'
  | 'kernel-too-old'
  | 'enforce-denied'
  | 'helper-missing'
  | 'probe-failed';

/** Landlock 能力探测结果 */
export interface LandlockCapability {
  available: boolean;
  /** ABI 版本（0 = 不可用） */
  abi: number;
  /** 不可用原因（available=false 时） */
  reason?: LandlockUnavailableReason;
}

/** Landlock 文件系统权限词汇表（映射自 landlock-run policy.json 契约） */
export type LandlockFsAccess =
  | 'read'
  | 'write'
  | 'execute'
  | 'make_dir'
  | 'make_reg'
  | 'remove'
  | 'refer';

/** Landlock 文件系统规则（path_beneath） */
export interface LandlockFsRule {
  path: string;
  allow: LandlockFsAccess[];
}

/** Landlock 网络规则 */
export interface LandlockNetRule {
  allow: string[];
  denyBind?: boolean;
}

/** Landlock policy.json（landlock-run 输入） */
export interface LandlockPolicy {
  cwd: string;
  fs: LandlockFsRule[];
  net?: LandlockNetRule;
  abi: number;
}

/** runWithLandlock 执行结果 */
export interface LandlockRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** true = 沙箱初始化失败（exit 125），非目标命令失败 */
  sandboxInitFailed: boolean;
}
