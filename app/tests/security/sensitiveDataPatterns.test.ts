// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * `SensitiveDataService` 打码/判定口径（P26-2 **P1 + P2**，2026-10-07）
 *
 * Spec：`.trae/specs/guardrails-dual-side.md` §9.2（P1「secrets 收窄为**值形态**」/
 * P2「豁免 MIT 协议头邮箱」）与 §9.2② 的 FP 量化。
 *
 * 锁四件事：
 *   ① **P1**：字段名 + **占位符/短值** 不再命中（旧 FP 消失）；**真实密钥形态**（provider 前缀）仍命中；
 *   ② **P2**：`Copyright (c) …` / `©` **所在行**的邮箱不打码，**其他行的邮箱照常打码**；
 *   ③ **口径同源**：`detectSensitiveData(x) === (sanitize(x) !== x)`，且**连续调用结果稳定**
 *      （旧实现 `/g` + `.test()` 会因 `lastIndex` 残留交替误判 —— 本批已消除）；
 *   ④ PII（SSN / 卡号）与总开关行为不变。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import { sensitiveDataService } from '../../src/security/services/SensitiveDataService.js';

afterEach(() => {
  // 单例：恢复默认开关，避免跨用例污染
  sensitiveDataService.updateConfig({ enableSensitiveDataDetection: true });
});

describe('P1：secrets 判定收窄为「值形态」', () => {
  it('字段名 + 占位符 / 空值 / 短值 / 环境变量引用 ⇒ **不再**命中（旧 FP 消除）', () => {
    const cases = [
      "password: ''",
      'token: string',
      'token: undefined',
      'api_key: process.env.OPENAI_API_KEY',
      'const api_key = config.apiKey',
      "secret_key = ''",
    ];
    for (const text of cases) {
      expect(sensitiveDataService.sanitize(text)).toBe(text);
      expect(sensitiveDataService.detectSensitiveData(text)).toBe(false);
    }
  });

  it('真实密钥**形态**（provider 前缀）⇒ 命中并整段打码', () => {
    const cases = [
      'AKIAIOSFODNN7EXAMPLE', // AWS Access Key
      'ghp_' + 'a'.repeat(36), // GitHub PAT
      'sk_live_' + 'b'.repeat(24), // Stripe
      'xoxb-1234567890-abcdefghij', // Slack
    ];
    for (const secret of cases) {
      const text = `key=${secret}`;
      const sanitized = sensitiveDataService.sanitize(text);
      expect(sanitized).not.toBe(text);
      expect(sanitized).toContain('[REDACTED]');
      expect(sanitized).not.toContain(secret);
      expect(sensitiveDataService.detectSensitiveData(text)).toBe(true);
    }
  });

  it('字段名 + **长值** ⇒ 仍命中；打码覆盖**整段（含字段名）** —— 复用规则表的既有语义', () => {
    expect(sensitiveDataService.sanitize('password: hunter2hunter2')).toBe(
      '[REDACTED]'
    );
  });

  it('残留 FP（如实，非本批引入）：长占位符（≥8 字符）仍会被打码', () => {
    // `generic-secret` 的值形态下限是「≥8 非空白字符」，无法区分"长占位符"与"真口令"
    // ⇒ 该 FP 由**被复用的规则表**决定，本批不擅自收紧（收紧会偏离共享事实源）。见 spec §10。
    expect(sensitiveDataService.sanitize("password: 'placeholder'")).toBe(
      '[REDACTED]'
    );
  });

  it('覆盖边界（如实，P1 裁定）：`token: <长值>` **无 provider 前缀**不再命中', () => {
    // 旧实现的字段名正则（含 `token`）会命中；P1 明确「**不以字段名命中**」⇒ 本边界为**有意**结果。
    // 有前缀者（`sk-`/`ghp_`/…）与 `Bearer xxx` / JWT 仍由规则表覆盖。
    const text = 'token: ' + 'z'.repeat(40);
    expect(sensitiveDataService.sanitize(text)).toBe(text);
  });
});

describe('P2：豁免 MIT 协议头行邮箱', () => {
  it('`Copyright (c) <year> <email>` 所在行 ⇒ 邮箱**保留**', () => {
    const line = '// Copyright (c) 2026 190615273@qq.com';
    expect(sensitiveDataService.sanitize(line)).toBe(line);
    expect(sensitiveDataService.detectSensitiveData(line)).toBe(false);
  });

  it('`©` 写法同样豁免（不依赖固定 `(c)` 文案）', () => {
    const line = '// © 2026 author@example.com';
    expect(sensitiveDataService.sanitize(line)).toBe(line);
  });

  it('非协议头行的邮箱 ⇒ **照常**打码', () => {
    expect(sensitiveDataService.sanitize('联系我 foo@example.com 谢谢')).toBe(
      '联系我 [REDACTED] 谢谢'
    );
  });

  it('多行混合：协议头行保留 + 正文邮箱打码（逐行判定）', () => {
    const text = [
      '// Copyright (c) 2026 190615273@qq.com',
      '// 联系人：ops@example.com',
    ].join('\n');
    expect(sensitiveDataService.sanitize(text)).toBe(
      ['// Copyright (c) 2026 190615273@qq.com', '// 联系人：[REDACTED]'].join(
        '\n'
      )
    );
  });
});

describe('口径同源与稳定性（顺带修掉 `/g` + `.test()` 缺陷）', () => {
  it('`detectSensitiveData` 与 `sanitize` 判定一致', () => {
    const samples = [
      'plain text',
      '// Copyright (c) 2026 190615273@qq.com',
      'mail: foo@example.com',
      'ssn 123-45-6789',
      'AKIAIOSFODNN7EXAMPLE',
      "password: ''",
    ];
    for (const s of samples) {
      expect(sensitiveDataService.detectSensitiveData(s)).toBe(
        sensitiveDataService.sanitize(s) !== s
      );
    }
  });

  it('连续三次调用结果**稳定**（旧实现会交替 true/false）', () => {
    const text = 'mail: foo@example.com';
    const results = [0, 1, 2].map(() =>
      sensitiveDataService.detectSensitiveData(text)
    );
    expect(results).toEqual([true, true, true]);
  });
});

describe('PII 与总开关（行为不变）', () => {
  it('SSN / 卡号 ⇒ 打码', () => {
    expect(sensitiveDataService.sanitize('ssn 123-45-6789')).toBe(
      'ssn [REDACTED]'
    );
    expect(sensitiveDataService.sanitize('card 4111-1111-1111-1111')).toBe(
      'card [REDACTED]'
    );
  });

  it('关闭检测开关 ⇒ 原样返回（sanitize 与 detect 均短路）', () => {
    sensitiveDataService.updateConfig({ enableSensitiveDataDetection: false });
    const text = 'mail: foo@example.com';
    expect(sensitiveDataService.sanitize(text)).toBe(text);
    expect(sensitiveDataService.detectSensitiveData(text)).toBe(false);
  });
});
