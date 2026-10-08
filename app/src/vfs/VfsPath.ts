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
 * VFS 路径结构化解析（`ai-vfs-driver-contract.md` §3.1 硬性约定）。
 *
 * **必须**产出结构化 `{scheme, authority, path}` —— **禁止**用字符串前缀匹配做业务判定（CS02）。
 */

import { vfsError, type VfsPath } from './types.js';

/** scheme 合法字符集：字母开头，允许字母/数字/`_`/`+`/`-` */
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_+-]*$/;

/**
 * 解析 `<scheme>://<authority>[/<path>]`。
 *
 * - 缺失 / 非法 scheme ⇒ `VFS_UNKNOWN_MOUNT`（**不**回退本地文件系统，CS03）；
 * - 解析**只**做结构拆分，不做路径安全判定（穿越 / 逃逸由驱动底座负责）。
 */
export function parseVfsPath(raw: string): VfsPath {
  const input = typeof raw === 'string' ? raw.trim() : '';
  const sepIndex = input.indexOf('://');
  if (sepIndex <= 0) {
    throw vfsError(
      'VFS_UNKNOWN_MOUNT',
      `无法解析 VFS 路径（缺少 scheme://）: "${raw}"`
    );
  }

  const scheme = input.slice(0, sepIndex);
  if (!SCHEME_PATTERN.test(scheme)) {
    throw vfsError('VFS_UNKNOWN_MOUNT', `非法 scheme（挂载点）: "${scheme}"`);
  }

  const rest = input.slice(sepIndex + 3);
  const slashIndex = rest.indexOf('/');
  const authority = slashIndex === -1 ? rest : rest.slice(0, slashIndex);
  const path = slashIndex === -1 ? '' : rest.slice(slashIndex + 1);

  return { scheme, authority, path };
}

/**
 * 取挂载点内的相对路径（`authority` + 可选 `/` + `path`）。
 *
 * 依据契约示例 `dev_docs://配置与安全/sandbox.md` ⇒ 相对 `resolveDocsDir()` 的
 * `配置与安全/sandbox.md`。驱动底座据此拼宿主路径。
 */
export function vfsRelativePath(vfsPath: VfsPath): string {
  return vfsPath.path
    ? `${vfsPath.authority}/${vfsPath.path}`
    : vfsPath.authority;
}

/** 格式化回规范形态（用于日志 / 结果回显） */
export function formatVfsPath(vfsPath: VfsPath): string {
  return `${vfsPath.scheme}://${vfsRelativePath(vfsPath)}`;
}
