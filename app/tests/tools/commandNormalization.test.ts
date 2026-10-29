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
 * S1-5（2026-10-11）—— 命令规范化"单一事实源" + G22 Windows 路径探测。
 *
 * 覆盖方案 §5 验证要求：
 * - 三处口径共用同一规范化结果（审批哈希 / 安全拦截层 / 最终 spawn，含 `/tmp`、`/dev/null`、
 *   全角冒号三类改写）；
 * - Windows 分支 Unix 绝对路径（`/etc`、`/usr`）处置符合预期（G22，fail-closed），
 *   且**不误伤** Windows 合法开关（`dir /b`、`findstr /i`）。
 */
import { describe, it, expect } from 'bun:test';
import {
  standardizeCommand,
  preprocessWindowsCommand,
  extractPathCandidates,
  isUnixAbsolutePath,
  isUnixSensitivePath,
  deriveBaseCommand,
} from '../../src/tools/bash/commandNormalization.js';
import { BashTool } from '../../src/tools/bash/BashTool.js';
import {
  ApprovedCommandRegistry,
  hashCommand,
  hashCommandForExecution,
} from '../../src/permission/ApprovedCommandRegistry.js';
import type { ToolUseContext } from '../../src/tools/types/Tool.js';

/** 最小可用的 ToolUseContext（仅 execute 用到 sessionId） */
function makeContext(sessionId: string): ToolUseContext {
  return {
    sessionId,
    options: {} as ToolUseContext['options'],
    abortController: new AbortController(),
    readFileState: {},
  } as unknown as ToolUseContext;
}

describe('S1-5 命令规范化：三类改写一次完成', () => {
  it('Windows：`/tmp → %TEMP%`、`/dev/null → NUL`，rewrites 如实记录', () => {
    const std = standardizeCommand('cat /tmp/a > /dev/null', {
      isWindows: true,
    });
    expect(std.preprocessed).toBe('cat %TEMP%/a > NUL');
    expect(std.rewrites).toEqual(['/tmp → %TEMP%', '/dev/null → NUL']);
  });

  it('Windows：含全角冒号的路径 token 自动加引号并记入 rewrites', () => {
    const std = standardizeCommand('type 标的：云景.docx', { isWindows: true });
    expect(std.preprocessed).toContain('"标的：云景.docx"');
    expect(std.rewrites).toContain('含全角冒号的路径 token 自动加引号');
  });

  it('`cd /x` 产生阻断告警（`禁止:` 前缀，由调用方判定）', () => {
    // 注意：`/tmp` 会被先改写为 `%TEMP%`，故此处用不会被改写的 `/usr` 触发 `cd /x` 规则
    const std = standardizeCommand('cd /usr', { isWindows: true });
    expect(std.warnings.some((w) => w.includes('禁止'))).toBe(true);
  });

  it('非 Windows：preprocessWindowsCommand 不触发 ⇒ preprocessed === raw', () => {
    const raw = 'cat /tmp/a';
    const std = standardizeCommand(raw, { isWindows: false });
    expect(std.preprocessed).toBe(raw);
    expect(std.rewrites).toEqual([]);
  });
});

describe('S1-5 单一事实源：三处口径同源', () => {
  it('`preprocessed`（spawn）逐字保留多行；`normalized`（哈希/展示）折叠换行', () => {
    const raw = 'echo  a\nb';
    const std = standardizeCommand(raw, { isWindows: false });
    // spawn 用 preprocessed：多行/原语义不得被破坏（normalizeCommand 会折叠换行 ⇒ 不可 spawn）
    expect(std.preprocessed).toBe(raw);
    // 哈希/展示用 normalized：引号外空白与换行折叠
    expect(std.normalized).toBe('echo a b');
  });

  it('审批哈希与规范化同源：hashCommandForExecution(preprocessed) === hashCommand(normalized)', () => {
    const std = standardizeCommand('rm  -rf   /tmp/x', { isWindows: true });
    expect(hashCommandForExecution(std.preprocessed)).toBe(
      hashCommand(std.normalized)
    );
  });

  it('审批快照口径：normalized 与改写项可对账（原始 ≠ 执行的差异可见）', () => {
    const std = standardizeCommand('cat /tmp/a', { isWindows: true });
    expect(std.raw).toBe('cat /tmp/a');
    expect(std.normalized).toBe('cat %TEMP%/a');
    expect(std.rewrites).toEqual(['/tmp → %TEMP%']);
  });
});

describe('S1-5 路径提取与基命令归一化（统一口径）', () => {
  it('提取**全部**路径候选（非仅首个）', () => {
    expect(extractPathCandidates('cp /a/b C:\\d\\e')).toEqual([
      '/a/b',
      'C:\\d\\e',
    ]);
  });

  it('Unix 绝对路径 / 敏感目录识别；单字母开关不误判（G22 关键）', () => {
    expect(isUnixAbsolutePath('/etc/passwd')).toBe(true);
    expect(isUnixSensitivePath('/etc/passwd')).toBe(true);
    expect(isUnixSensitivePath('/usr/bin/node')).toBe(true);
    expect(isUnixSensitivePath('/i')).toBe(false); // findstr /i
    expect(isUnixSensitivePath('/b')).toBe(false); // dir /b
    expect(isUnixSensitivePath('/c:')).toBe(false); // findstr /c:
  });

  it('Windows 合法开关（dir /b、findstr /i）不被判为敏感路径', () => {
    expect(
      standardizeCommand('dir /b', { isWindows: true }).unixSensitivePaths
    ).toEqual([]);
    expect(
      standardizeCommand('findstr /i x', { isWindows: true }).unixSensitivePaths
    ).toEqual([]);
  });

  it('standardizeCommand 汇总敏感路径（Windows 分支 fail-closed 依据）', () => {
    const std = standardizeCommand('type /etc/shadow', { isWindows: true });
    expect(std.unixSensitivePaths).toEqual(['/etc/shadow']);
  });

  // ── B2-1（2026-10-30，issue #36）：argv 感知提取 ──
  it('B2-1：Windows 开关 / findstr 搜索模式不参与路径判定', () => {
    const std = standardizeCommand(
      'findstr /n /c:"app/src" /c:"../../app" /c:"@modules" E:\\X\\a.ts',
      { isWindows: true }
    );
    // 旧实现产出 ["/n","/c:","/src","/c:","/../app","/c:"] ⇒ 误判路径遍历
    expect(std.paths).toEqual(['E:\\X\\a.ts']);
    expect(std.unixAbsolutePaths).toEqual([]);
    expect(std.unixSensitivePaths).toEqual([]);
  });

  it('B2-1：dir /b /ad 的开关被排除；Unix 顶层目录仍按路径判定', () => {
    expect(
      standardizeCommand('dir /b /ad C:\\x', { isWindows: true }).paths
    ).toEqual(['C:\\x']);
    // /etc 虽是 3 字母，但属 Unix 顶层目录 ⇒ 不得当开关
    expect(
      standardizeCommand('type /etc/passwd', { isWindows: true })
        .unixSensitivePaths
    ).toEqual(['/etc/passwd']);
  });

  it('B2-1：POSIX 语义下不做开关过滤（/n 仍视为根路径，fail-closed 不变）', () => {
    expect(extractPathCandidates('findstr /n x')).toEqual(['/n']);
  });

  it('基命令归一化：去路径前缀 / 去扩展名 / 小写', () => {
    expect(deriveBaseCommand('./node_modules/.bin/Node.EXE -v')).toBe('node');
    expect(deriveBaseCommand('  ')).toBe('');
  });
});

describe('S1-5 预处理迁移等价性（模块迁出后行为不变）', () => {
  it('直接调用 preprocessWindowsCommand 与 standardizeCommand 的改写一致', () => {
    const raw = 'cat /tmp/a > /dev/null';
    expect(preprocessWindowsCommand(raw).command).toBe(
      standardizeCommand(raw, { isWindows: true }).preprocessed
    );
  });
});

describe('G22：Windows 分支 Unix 敏感目录 fail-closed（经 BashTool.execute）', () => {
  it('`echo /etc/passwd` ⇒ 路径安全拦截（path_safety）', async () => {
    if (process.platform !== 'win32') return; // 非 Windows 侧由既有 `/^\//` 覆盖
    const reg = new ApprovedCommandRegistry(60_000, false);
    const tool = new BashTool(reg);
    const r = await tool.execute(
      { command: 'echo /etc/passwd' },
      makeContext('s-g22')
    );
    expect(r.metadata?.securityIntercepted).toBe(true);
    expect(r.metadata?.reason).toBe('path_safety');
    reg.dispose();
  });

  it('反斜杠形态 `echo \\etc\\passwd` 同样被拦截（归一后判定）', async () => {
    if (process.platform !== 'win32') return;
    const reg = new ApprovedCommandRegistry(60_000, false);
    const tool = new BashTool(reg);
    const r = await tool.execute(
      { command: 'echo \\etc\\passwd' },
      makeContext('s-g22b')
    );
    expect(r.metadata?.securityIntercepted).toBe(true);
    expect(r.metadata?.reason).toBe('path_safety');
    reg.dispose();
  });
});
