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
 * macOS Seatbelt（SBPL）策略生成（**纯函数**，不 spawn、不读盘）。
 *
 * 首版只做**写隔离**（用户 2026-10-26 裁定）：
 * - `(deny default)` ⇒ 默认拒绝；
 * - `(allow file-read*)` ⇒ 读不设限（bash 是交互通道，先避免读白名单导致的普遍误伤）；
 * - `(allow file-write*)` **仅**白名单目录（工作区 / 受管产物 / 临时目录 / 用户显式追加）；
 * - `(allow process*)` ⇒ 允许 shell 自身 fork/exec；
 * - 网络默认放行（与现有 Landlock bash 口径一致："不 handle 网络 = 不受限"）。
 *
 * 读白名单化 / 网络收紧见方案 §3.5（本次不做，登记为后续项）。
 */

export interface MacOSSandboxProfileInput {
  /** 写入白名单（逐条 `subpath`）；调用方负责给出绝对路径并自行过滤不存在的项 */
  writablePaths: string[];
  /** 是否放行网络；缺省 `true`（与现有基线同口径） */
  allowNetwork?: boolean;
}

/**
 * SBPL 字符串转义：`\` 与 `"` 是 profile 的语法字符，路径里出现会截断规则。
 * 例：`/tmp/a"b` ⇒ `/tmp/a\"b`
 */
export function escapeSbplString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** 去重（保持声明顺序），并丢弃空串 */
function normalizePaths(paths: string[]): string[] {
  const out: string[] = [];
  for (const raw of paths) {
    const trimmed = raw.trim();
    if (!trimmed || out.includes(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}

/**
 * 生成 SBPL profile（可直接作为 `sandbox-exec -p` 的参数）。
 *
 * 规则顺序即语义：`(deny default)` 先立默认拒绝，随后逐项放行；
 * 写入未命中任何 `subpath` ⇒ 落回 default deny（`Operation not permitted`）。
 */
export function buildMacOSSandboxProfile(
  input: MacOSSandboxProfileInput
): string {
  const lines: string[] = [
    '(version 1)',
    '(deny default)',
    '',
    '; 读：系统与运行时（动态库 / 证书 / 工具链）',
    '(allow file-read*)',
    '',
    '; 进程：允许 shell 自身 fork/exec（否则无法启动待执行命令）',
    '(allow process*)',
  ];

  if (input.allowNetwork !== false) {
    lines.push(
      '',
      '; 网络：首版不收紧（与 Landlock bash 口径一致）',
      '(allow network*)'
    );
  }

  const writable = normalizePaths(input.writablePaths);
  if (writable.length > 0) {
    lines.push(
      '',
      '; 写：仅白名单目录（其余落回 default deny）',
      '(allow file-write*'
    );
    for (const path of writable) {
      lines.push(`  (subpath "${escapeSbplString(path)}")`);
    }
    lines.push(')');
  }

  return lines.join('\n');
}
