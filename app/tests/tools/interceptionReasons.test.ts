/**
 * P2-2（2026-11-22，G7）：拦截 reason 码登记表的双向对账判据。
 *
 * bash 域由 `commandGateRegistry` 单独对账；本文件只测非 bash 域的纯判据。
 */
import { describe, expect, it } from 'bun:test';

import {
  INTERCEPTION_REASONS,
  collectReasonCodes,
  validateInterceptionReasons,
  type InterceptionReasonSpec,
} from '@modules/tools/governance/interceptionReasons';

describe('collectReasonCodes：从源码提取 reason 码', () => {
  it('只认小写标识符形的字面量', () => {
    const text = `metadata: { reason: 'ssrf_blocked' }`;
    expect(collectReasonCodes(text)).toEqual(['ssrf_blocked']);
  });

  it('模板/变量/大写描述不进码表', () => {
    const text = [
      'reason: ssrfResult.reason',
      'reason: `${x}`',
      "reason: 'SSRF protection'",
    ].join('\n');
    expect(collectReasonCodes(text)).toEqual([]);
  });
});

describe('validateInterceptionReasons：双向对账', () => {
  const specs: InterceptionReasonSpec[] = [
    { code: 'ssrf_blocked', domain: 'network', sources: ['a.ts'] },
  ];

  it('扫描面与登记一致 ⇒ 通过', () => {
    expect(
      validateInterceptionReasons(
        [{ file: 'a.ts', text: "reason: 'ssrf_blocked'" }],
        specs
      )
    ).toEqual([]);
  });

  it('源码出现未登记的码 ⇒ 失败', () => {
    const errors = validateInterceptionReasons(
      [{ file: 'a.ts', text: "reason: 'ssrf_blocked'; reason: 'new_code'" }],
      specs
    );
    expect(errors).toContain('未登记的拦截 reason 码：new_code（a.ts）');
  });

  it('登记的码在扫描面不存在 ⇒ 失败（防僵尸登记）', () => {
    const errors = validateInterceptionReasons(
      [{ file: 'a.ts', text: '' }],
      specs
    );
    expect(errors).toContain(
      '登记的拦截 reason 码在扫描面不存在：ssrf_blocked'
    );
  });

  it('登记来源未纳入扫描面 ⇒ 失败', () => {
    const errors = validateInterceptionReasons(
      [{ file: 'other.ts', text: "reason: 'ssrf_blocked'" }],
      specs
    );
    expect(errors).toContain('登记来源未纳入扫描面：a.ts（ssrf_blocked）');
  });
});

describe('F6：真实拦截点已登记', () => {
  const byCode = new Map(INTERCEPTION_REASONS.map((s) => [s.code, s]));

  it('PathGuard / LRO 越界 / 策略拒绝 / MCP 未连接', () => {
    expect(byCode.get('path_guard_blocked')?.domain).toBe('file');
    expect(byCode.get('workspace_escape_blocked')?.domain).toBe('file');
    expect(byCode.get('policy_denied')?.domain).toBe('policy');
    expect(byCode.get('mcp_not_connected')?.domain).toBe('mcp');
  });
});
