/**
 * `runOnboard` 向导**分段/非交互路径**的特征化测试（T3 复杂度清理前置，2026-11-17）。
 *
 * 目的：把向导可脱离 TTY 观测的既有行为钉住，供后续拆分（圈复杂度 69 → 阈值内）时对照：
 *  ① 无 TTY ⇒ 打印手动配置指引并返回 `[]`；
 *  ② `section='soul'` ⇒ 直接进入身份与人格设置（不打印「选择配置模式」）；
 *  ③ `section='channel'` + 回答 `n` ⇒ 打印「已跳过」并返回 `[]`；
 *  ④ 主流程在「选择配置模式」回答 `exit` ⇒ 打印退出提示并返回 `[]`。
 *
 * 边界（如实）：供应商选择 / API Key / 保存与通道热连接段落在本测试中不覆盖 ——
 * 它们依赖真实终端输入、本机端口探测与外网验证；这些段落的等价性由拆分提交的
 * git diff（逐字搬出、仅新增函数头与段末 `return false` 式收尾）佐证。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import type { Interface } from 'readline';

import { runOnboard } from '../../src/commands/builtin/onboard/Onboard';

const logs: string[] = [];
const originalLog = console.log;

function capture(): void {
  logs.length = 0;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(' '));
  };
}

function output(): string {
  return logs.join('\n');
}

/** 按顺序作答的假 readline；答案耗尽后一律回 `exit`（避免测试挂住） */
function fakeRl(answers: string[]): Interface {
  const queue = [...answers];
  return {
    question: (_query: string, cb: (answer: string) => void) => {
      cb(queue.shift() ?? 'exit');
    },
    close: () => {},
  } as unknown as Interface;
}

afterEach(() => {
  console.log = originalLog;
});

describe('runOnboard：分段入口与非交互路径（特征化）', () => {
  it('① 无 TTY ⇒ 打印手动配置指引并返回空数组', async () => {
    capture();
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', {
      value: undefined,
      configurable: true,
    });
    try {
      expect(await runOnboard()).toEqual([]);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
      });
    }
    expect(output()).toContain('检测到非交互环境（无 TTY）');
    expect(output()).toContain('/config list');
  });

  it('② section=soul ⇒ 直接进入身份与人格设置，不打印配置模式选择', async () => {
    capture();
    const result = await runOnboard(fakeRl(['exit']), 'soul');

    expect(result).toEqual([]);
    expect(output()).toContain('身份与人格设置');
    expect(output()).not.toContain('选择配置模式');
  });

  it('③ section=channel + 回答 n ⇒ 跳过并返回空数组', async () => {
    capture();
    const result = await runOnboard(fakeRl(['n']), 'channel');

    expect(result).toEqual([]);
    expect(output()).toContain('配置消息通道');
    expect(output()).toContain('已跳过。');
    expect(output()).not.toContain('选择配置模式');
  });

  it('④ 模式选择回答 exit ⇒ 打印退出提示并返回空数组', async () => {
    capture();
    const result = await runOnboard(fakeRl(['exit']));

    expect(result).toEqual([]);
    expect(output()).toContain('选择配置模式');
    expect(output()).toContain('已退出向导');
    expect(output()).not.toContain('步骤 1/');
  });
});
