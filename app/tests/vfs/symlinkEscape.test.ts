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
 * AI-VFS 符号链接逃逸拒绝守卫（补齐 `ai-vfs-readonly-pilot.md §6.3-1`）。
 *
 * 驱动 `DevDocsDriver.resolveHostPath` 对**已存在**的目标做 `realpath` 二次 containment：
 * 若解析后的真实路径越出挂载根 ⇒ `VFS_DENIED`（**不**读到外部内容）。
 *
 * fixture 自建：在临时挂载根内建**目录联接**指向根**之外**的临时目录，再经
 * `read_vfs('<scheme>://<链名>/<外部文件>')` 断言被拒。
 *
 * 平台说明：Windows 用 `fs.symlinkSync(target, path, 'junction')`（**无需管理员权限**）；
 * POSIX 上 `type` 被忽略、等价普通符号链接。若本机确无法创建（`EPERM`/`UNKNOWN` 等）
 * ⇒ 用例**条件跳过**（`describe.skipIf`），**不**写"永真"断言蒙混（CS06）。
 */

import { afterAll, describe, expect, it } from 'bun:test';
import {
  lstatSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadVfsTool } from '../../src/tools/ReadVfsTool/ReadVfsTool.js';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext.js';
import { DevDocsDriver } from '../../src/vfs/drivers/DevDocsDriver.js';
import { vfsMountRegistry } from '../../src/vfs/VfsMountRegistry.js';

/** 测试专用 scheme（与生产 `dev_docs` 及其他用例隔离） */
const SCHEME = 'vfs_symlink_test';

/** 链名（挂载根内的目录联接） */
const LINK_NAME = 'escape';

/** 根外文件内容（用于断言"未被读到"） */
const SECRET = 'OUTSIDE_SECRET_CONTENT\n';

const readTool = ReadVfsTool.create();
const ctx = {} as ToolUseContext;

let root = '';
let outside = '';
let linkOk = false;

// 在**收集期**（module 顶层）创建 fixture —— `describe.skipIf` 需在注册时即知条件。
try {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'vfs-symlink-root-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'vfs-symlink-out-')));
  writeFileSync(join(outside, 'secret.md'), SECRET, 'utf-8');
  // 目录联接：Windows 免特权；POSIX 上等价普通符号链接
  symlinkSync(outside, join(root, LINK_NAME), 'junction');
  linkOk = true;
  if (!vfsMountRegistry.has(SCHEME)) {
    vfsMountRegistry.registerMount(
      SCHEME,
      new DevDocsDriver(root, undefined, SCHEME)
    );
  }
} catch {
  // 无法创建链接（如受限容器 / Windows 策略）⇒ linkOk 保持 false，用例跳过（CS06 如实）
  linkOk = false;
}

afterAll(() => {
  // 先摘除联接（避免递归删除穿过它），再清理两侧临时目录
  if (linkOk) {
    rmSync(join(root, LINK_NAME), { recursive: true, force: true });
  }
  if (root) rmSync(root, { recursive: true, force: true });
  if (outside) rmSync(outside, { recursive: true, force: true });
});

describe.skipIf(!linkOk)(
  '符号链接逃逸 ⇒ VFS_DENIED（realpath 二次 containment）',
  () => {
    it('fixture 前提：链名为真实符号链接/联接（非普通目录）', () => {
      expect(lstatSync(join(root, LINK_NAME)).isSymbolicLink()).toBe(true);
    });

    it('read_vfs 经联接读取外部文件 ⇒ 拒绝，且不读到外部内容', async () => {
      const r = await readTool.execute(
        { path: `${SCHEME}://${LINK_NAME}/secret.md` },
        ctx
      );
      expect(r.success).toBe(false);
      expect(r.error).toContain('VFS_DENIED');
      expect(r.metadata?.errorCode).toBe('VFS_DENIED');
      // 关键：未读到外部内容（失败路径不泄露）
      expect(String(r.data ?? '')).not.toContain('OUTSIDE_SECRET_CONTENT');
    });
  }
);
