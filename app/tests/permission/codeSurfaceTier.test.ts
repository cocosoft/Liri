// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P4 复查（2026-11-12）：未知命令档**只对 shell 命令工具生效**。
 *
 * 背景：P0 引入「未知命令 ⇒ ask」后，`code` / `code_run` 的源码入参也被兜底命中
 * ⇒ `console.log('hello')` 这类无害代码在 auto 档被要求审批（回归）。
 * 源码面仍有自己的扫描（注入类规则 / 编码 / SSRF / SWD 深扫），因此收窄不放宽危险面。
 */

import { describe, expect, it } from 'bun:test';
import { AutoModeClassifier } from '@openliri/infra/permission/classifiers/AutoModeClassifier';

const classifier = new AutoModeClassifier();

async function check(
  tool: string,
  input: Record<string, unknown>
): Promise<{ deny: boolean; ask: boolean }> {
  const decision = await classifier.classify(tool, input, []);
  return {
    deny: decision.shouldBlock,
    ask: Boolean(decision.requiresApproval),
  };
}

describe('P4 复查：code 面不再被「未知命令」兜底', () => {
  it('无害源码 ⇒ allow', async () => {
    for (const code of [
      "console.log('hello')",
      "print('hello')",
      'let total = 1 + 2',
    ]) {
      const result = await check('code', { code });
      expect(result.deny, code).toBe(false);
      expect(result.ask, code).toBe(false);
    }
  });

  it('危险源码仍 deny（危险面未放宽）', async () => {
    for (const code of [
      "require('child_process').execSync('rm -rf /')",
      "eval('process.exit(1)')",
      "fetch('http://127.0.0.1:1/x')",
    ]) {
      const result = await check('code', { code });
      expect(result.deny, code).toBe(true);
    }
  });

  it('shell 命令面的未知兜底仍生效', async () => {
    const result = await check('bash', { command: 'cargo publish' });
    expect(result.deny).toBe(false);
    expect(result.ask).toBe(true);
  });
});
