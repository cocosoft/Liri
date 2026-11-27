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
 * macOS Seatbelt（SBPL）策略生成。
 *
 * **纯度口径（2026-10-26 订正）**：不 spawn、不写盘；唯一 IO 是 `realpathSync`
 * （见 {@link toKernelPath}）—— 因为 SBPL 的 `(subpath …)` 按**内核解析后的路径**匹配。
 *
 * 首版只做**写隔离**（用户 2026-10-26 裁定）：
 * - `(deny default)` ⇒ 默认拒绝；
 * - `(allow file-read*)` ⇒ 读不设限（bash 是交互通道，先避免读白名单导致的普遍误伤）；
 * - `(allow file-write*)` **仅**白名单目录（工作区 / 受管产物 / 临时目录 / 用户显式追加）；
 * - `(allow process*)` ⇒ 允许 shell 自身 fork/exec；
 * - 网络默认放行（与现有 Landlock bash 口径一致："不 handle 网络 = 不受限"）。
 *
 * A-1（2026-11-27）：读白名单**能力已就位**（`readablePaths`；缺省仍是 `(allow file-read*)` ⇒ 零行为变更）。
 * 是否收紧由调用方决定 —— 需先用 `verify:sandbox-macos` 的诊断段在 macOS 真机确认清单**足够**。
 * 网络收紧（A-2）仍登记为后续项（需与 Linux 网络策略同步，单改 macOS 会与既有裁定冲突）。
 */

import { realpathSync } from 'node:fs';

export interface MacOSSandboxProfileInput {
  /** 写入白名单（逐条 `subpath`）；调用方负责给出绝对路径并自行过滤不存在的项 */
  writablePaths: string[];
  /** 是否放行网络；缺省 `true`（与现有基线同口径） */
  allowNetwork?: boolean;
  /**
   * A-1（2026-11-27）：**读白名单**（逐条 `subpath`）。
   *
   * 缺省 / 空数组 ⇒ 保持 `(allow file-read*)`（读不设限，**零行为变更**）；
   * 传入非空 ⇒ 收紧为「仅这些目录可读」。
   *
   * ⚠️ 收紧前必须用 `verify:sandbox-macos` 的诊断段在 macOS 真机确认清单**足够**
   * （漏一个系统/运行时路径 ⇒ 沙箱内的 shell / 解释器直接起不来）。
   */
  readablePaths?: string[];
}

/**
 * 把路径归一成**内核实际看到的路径**（解析符号链接）。
 *
 * 为什么必须：macOS 上 `/var` → `/private/var`，而 `os.tmpdir()` 返回的正是
 * `/var/folders/…/T`；SBPL 按**解析后**的路径匹配 ⇒ 不归一就会出现「白名单里写了、
 * 却仍被拒」的假阴性（2026-10-26 首次 macOS CI 实证：白名单内写入被拒）。
 *
 * 不存在的路径**原样保留**：profile 可以先于目录创建，纯函数用例也可用假路径。
 */
export function toKernelPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * SBPL 字符串转义：`\` 与 `"` 是 profile 的语法字符，路径里出现会截断规则。
 * 例：`/tmp/a"b` ⇒ `/tmp/a\"b`
 */
export function escapeSbplString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** 归一（符号链接解析）+ 去重（保持声明顺序），并丢弃空串 */
function normalizePaths(paths: string[]): string[] {
  const out: string[] = [];
  for (const raw of paths) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // 先归一再查重：`/tmp` 与 `/private/tmp` 归一后应当合并成一条
    const resolved = toKernelPath(trimmed);
    if (out.includes(resolved)) continue;
    out.push(resolved);
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
  const lines: string[] = ['(version 1)', '(deny default)', ''];

  // A-1（2026-11-27）：读白名单可选 —— 不传 ⇒ 保持 `(allow file-read*)`（零行为变更）
  const readable = normalizePaths(input.readablePaths ?? []);
  if (readable.length === 0) {
    lines.push(
      '; 读：系统与运行时（动态库 / 证书 / 工具链）',
      '(allow file-read*)'
    );
  } else {
    lines.push('; 读：仅白名单目录（A-1 收紧；未命中 ⇒ 落回 default deny）');
    lines.push('(allow file-read*');
    for (const path of readable) {
      lines.push(`  (subpath "${escapeSbplString(path)}")`);
    }
    lines.push(')');
  }
  lines.push(
    '',
    // 2026-11-27（macOS CI 实证，`.trae/specs/macos-sandbox-exec.md` §3.6）：
    // `bun -e` 在缺本条时被内核直接终止（`exit=null`，无退出码）；同 profile 加本条后 `exit=0`。
    // 逐项二分：`mach-lookup` / `ipc-posix-shm` 均无效，**只有 `sysctl-read` 生效**。
    // 语义：允许读取系统信息（CPU / 内存 / 内核参数）—— 与 `file-read*` 同属**只读面**，
    // 不改变本 profile 的安全承诺（写隔离：白名单之外仍被拒）。
    '(allow sysctl-read)',
    '',
    '; 进程：允许 shell 自身 fork/exec（否则无法启动待执行命令）',
    '(allow process*)'
  );

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
