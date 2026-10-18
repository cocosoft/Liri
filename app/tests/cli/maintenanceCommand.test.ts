/**
 * C-5 生产入口守卫（2026-10-18）：`liri prompt …` 的 argv 分发。
 *
 * 背景：`LaunchMode.CLI` 于 D-229 删除后，`PromptHandler` 只剩测试直达，
 * `liri prompt validate` 会落入 REPL（并启动 HTTP/通道）。本守卫锁两件事：
 * - **白名单识别**：只有登记过的维护命令才被接管，其余词照旧走启动模式；
 * - **显式退出码**：成功 0 / 未识别子命令 1（帮助可读、不抛异常）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import {
  parseMaintenanceCommand,
  runMaintenanceCommand,
} from '../../src/cli/maintenanceCommand';

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

describe('维护命令 argv 分发', () => {
  it('识别 prompt 子命令并保留其参数', () => {
    expect(
      parseMaintenanceCommand([
        'prompt',
        'validate',
        '--locale=en-US',
        '--json',
      ])
    ).toEqual({
      name: 'prompt',
      subcommand: 'validate',
      args: ['--locale=en-US', '--json'],
    });
  });

  it('剔除启动器内部旗标（--legacy-repl / --no-legacy-repl）', () => {
    expect(
      parseMaintenanceCommand(['prompt', 'list', '--legacy-repl'])
    ).toEqual({ name: 'prompt', subcommand: 'list', args: [] });
  });

  it('无子命令时返回空串（交由 handler 打印帮助）', () => {
    expect(parseMaintenanceCommand(['prompt'])).toEqual({
      name: 'prompt',
      subcommand: '',
      args: [],
    });
  });

  it('非白名单词不被接管（启动模式语义不变）', () => {
    for (const argv of [[], ['repl'], ['mcp'], ['healthcheck'], ['deploy']]) {
      expect(parseMaintenanceCommand(argv)).toBeNull();
    }
  });

  it('validate：经真实校验器执行并返回 0', async () => {
    const command = parseMaintenanceCommand([
      'prompt',
      'validate',
      '--locale=zh-CN',
      '--json',
    ]);
    expect(command).not.toBeNull();
    expect(await runMaintenanceCommand(command!)).toBe(0);
    expect(output()).toContain('"errors": 0');
  });

  it('未识别子命令：打印帮助并返回 1（不抛异常）', async () => {
    const command = parseMaintenanceCommand(['prompt', 'nope']);
    expect(command).not.toBeNull();
    expect(await runMaintenanceCommand(command!)).toBe(1);
    expect(output()).toContain('prompt —— 提示词维护');
  });
});
