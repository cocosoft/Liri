// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * R4（2026-11-17）：文本去敏的唯一出口（采样 + 审批预览共用）。
 *
 * 黄金样本（治理方案 §4.1 / §11.6-⑦）：Bearer / Basic / ghp_ / AKIA / 连接串 /
 * `--password=` / 长 hex / 长 base64；以及"非密钥文本零改动"（防过度脱敏）。
 */
import { describe, expect, it } from 'bun:test';

import {
  buildRedactedInputPreview,
  redactSensitiveText,
  SENSITIVE_TEXT_PLACEHOLDER,
} from '@openliri/infra/security';

describe('R4：redactSensitiveText 黄金样本', () => {
  const cases: Array<{ name: string; input: string; mustNotContain: string }> =
    [
      {
        name: 'GitHub PAT',
        input:
          'git clone https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/x/y',
        mustNotContain: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      },
      {
        name: 'AWS Access Key',
        input: 'aws s3 ls --key AKIAIOSFODNN7EXAMPLE',
        mustNotContain: 'AKIAIOSFODNN7EXAMPLE',
      },
      {
        name: 'Bearer token',
        input:
          'curl -H "Authorization: Bearer abc123def456" https://api.example.com',
        mustNotContain: 'abc123def456',
      },
      {
        name: 'Basic auth',
        input:
          'curl -H "Authorization: Basic dXNlcjpwYXNz" https://api.example.com',
        mustNotContain: 'dXNlcjpwYXNz',
      },
      {
        name: '连接串内嵌凭据',
        input: 'psql postgres://appuser:s3cr3t-pw@db.internal:5432/app',
        mustNotContain: 's3cr3t-pw',
      },
      {
        name: 'CLI --password=',
        input: 'mytool --user=admin --password=hunter2 --verbose',
        mustNotContain: 'hunter2',
      },
      {
        name: 'TOKEN: 形式',
        input: 'deploy --config "TOKEN: abcdef0123456789"',
        mustNotContain: 'abcdef0123456789',
      },
      {
        name: '长 base64',
        input: `payload ${'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo'.repeat(2)}`,
        mustNotContain: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVoQUJD',
      },
      {
        name: '长 hex',
        input: `commit ${'a1b2c3d4'.repeat(8)}`,
        mustNotContain: 'a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4',
      },
    ];

  for (const testCase of cases) {
    it(`${testCase.name} ⇒ 敏感值不出现在结果里`, () => {
      const result = redactSensitiveText(testCase.input);
      expect(result.hit).toBe(true);
      expect(result.text).not.toContain(testCase.mustNotContain);
    });
  }

  it('非密钥文本零改动（不误伤普通命令）', () => {
    const command = 'git status --short && npm run build --workspace app';
    const result = redactSensitiveText(command);
    expect(result.hit).toBe(false);
    expect(result.text).toBe(command);
  });

  it('占位符可注入（默认 [REDACTED]）', () => {
    const result = redactSensitiveText('mytool --password=hunter2');
    expect(result.text).toContain(`password=${SENSITIVE_TEXT_PLACEHOLDER}`);
  });
});

describe('R4：buildRedactedInputPreview（审批预览）', () => {
  it('先脱敏再截断：预览里不出现密钥', () => {
    const preview = buildRedactedInputPreview(
      { command: 'deploy --password=hunter2 --region cn' },
      200
    );
    expect(preview).toContain('deploy');
    expect(preview).not.toContain('hunter2');
  });

  it('超过 maxChars 截断（预览长度有界）', () => {
    const preview = buildRedactedInputPreview(
      { command: `echo ${'x'.repeat(500)}` },
      50
    );
    expect(preview.length).toBeLessThanOrEqual(50);
  });
});
