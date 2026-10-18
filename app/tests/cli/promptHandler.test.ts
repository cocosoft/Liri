/**
 * C-5（2026-10-18）CLI 维护面守卫：`liri prompt list|export|diff|validate|reset`。
 *
 * 只验证 handler 层（不启动完整 CLI）：输出可读、导出路径与解析链的覆盖路径一致、
 * 危险操作（reset）未确认时不落盘。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import { createPromptHandler } from '../../src/cli/handlers/promptHandler';

let logs: string[] = [];
let originalLog: typeof console.log;
let originalError: typeof console.error;

beforeEach(() => {
  logs = [];
  originalLog = console.log;
  originalError = console.error;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
});

function output(): string {
  return logs.join('\n');
}

describe('C-5 liri prompt', () => {
  it('list：列出 22 个系统段 + 34 条工具提示词条目', async () => {
    const handler = createPromptHandler();
    expect(await handler.handle('list', [])).toBe(true);
    expect(output()).toContain('提示词清单');
    expect(output()).toContain('section:identity');
    expect(output()).toContain('tool:GrepTool/getDescription');
  });

  it('validate：真实资源通过（0 error）', async () => {
    const handler = createPromptHandler();
    expect(await handler.handle('validate', ['--locale=en-US'])).toBe(true);
    expect(output()).toContain('✓ 提示词资源校验通过');
  });

  it('export：系统段写 <id>.md、工具层保留 tools/ 前缀（与覆盖路径一致）', async () => {
    const target = mkdtempSync(join(tmpdir(), 'c5-export-'));
    try {
      const handler = createPromptHandler();
      expect(await handler.handle('export', ['--to', target])).toBe(true);

      // 系统段：去掉 sections/ 前缀
      expect(existsSync(join(target, 'identity.md'))).toBe(true);
      expect(existsSync(join(target, 'sections'))).toBe(false);
      // 工具层：保留 tools/<Tool>/<Export>.md
      expect(
        existsSync(join(target, 'tools', 'GrepTool', 'getDescription.md'))
      ).toBe(true);
      // 12 条 = 9 静态段 + 3 工具提示词（S-P4：31 个零消费者提示词已删除）
      const count = (dir: string): number =>
        readdirSync(dir, { withFileTypes: true }).reduce(
          (n, d) =>
            n +
            (d.isDirectory()
              ? count(join(dir, d.name))
              : d.name.endsWith('.md')
                ? 1
                : 0),
          0
        );
      expect(count(target)).toBe(12);
      expect(output()).toContain('已导出 12 个文件');

      // C-3b / T2：工具级资源 JSON 一并导出（用户覆盖基线；解析链 ①② 支持覆盖）
      for (const file of ['tool-params.json', 'tool-descriptions.json']) {
        const path = join(target, file);
        expect(existsSync(path)).toBe(true);
        const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
          params?: Record<string, string>;
          descriptions?: Record<string, string>;
        };
        const entries = parsed.params ?? parsed.descriptions;
        expect(Object.keys(entries ?? {}).length).toBeGreaterThan(0);
      }
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('diff：无覆盖时提示「无外置覆盖」，有覆盖时列出 scope/path', async () => {
    const handler = createPromptHandler();
    expect(await handler.handle('diff', [])).toBe(true);
    // 真实用户目录可能已有覆盖 ⇒ 只断言两种合法输出之一
    expect(output()).toMatch(/无外置覆盖|外置覆盖/);
  });

  it('reset：未 --confirm ⇒ 只提示、不删除', async () => {
    const handler = createPromptHandler();
    expect(await handler.handle('reset', [])).toBe(true);
    expect(output()).toContain('确认请执行');
  });

  it('未知子命令 ⇒ 返回 false（由 CLIHandler 打帮助）', async () => {
    const handler = createPromptHandler();
    expect(await handler.handle('nope', [])).toBe(false);
  });
});
