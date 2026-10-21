/**
 * 多租户 P5：审计按身份（记录归属 + 分区落盘 + 查询/统计/导出过滤）
 *
 * ① 落盘目录按**写入时身份**解析：本地 ⇒ `data/logs/enterprise-audit`（逐字不变），
 *    已认证 ⇒ `data/tenants/<tenant>/users/<user>/logs/enterprise-audit`；
 * ② 每条事件自动带 `ownerKey` / `tenant`（本地都不写）；
 * ③ `query` / `getStats` / `export` 只覆盖当前身份可见的记录（本地恒放行；
 *    已认证身份对"无归属"的记录 fail-closed）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  EnterpriseAuditService,
  AuditEventType,
  parseAuditFileDate,
} from '../../src/config/enterprise/audit/EnterpriseAuditService.js';
import { setUserDataDirOverride } from '../../src/core/paths.js';
import { runWithPrincipal } from '../../src/core/identity/requestScope.js';
import type { Principal } from '../../src/core/identity/principal.js';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

let root: string;
const dayFile = () => `${new Date().toISOString().slice(0, 10)}_audit.json`;
const service = EnterpriseAuditService.getInstance();

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('等待落盘超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function record(actor: string) {
  return service.log(
    AuditEventType.TOOL_EXECUTION,
    'info',
    actor,
    `${actor} 执行工具`
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-audit-'));
  setUserDataDirOverride(root);
});

afterEach(() => {
  setUserDataDirOverride(null);
  rmSync(root, { recursive: true, force: true });
});

describe('审计按身份（P5）', () => {
  it('本地记录：落全局目录，且不写 ownerKey / tenant', async () => {
    const event = await record('local-probe');

    expect(event.ownerKey).toBeUndefined();
    expect(event.tenant).toBeUndefined();

    const file = join(root, 'data', 'logs', 'enterprise-audit', dayFile());
    await waitFor(() => existsSync(file));
    expect(readFileSync(file, 'utf-8')).toContain('local-probe');
  });

  it('已认证记录：落身份分区目录，并自动带 ownerKey / tenant', async () => {
    const event = await runWithPrincipal(ALICE, () => record('alice-probe'));

    expect(event.ownerKey).toBe('acme:alice');
    expect(event.tenant).toBe('acme');

    const file = join(
      root,
      'data',
      'tenants',
      'acme',
      'users',
      'alice',
      'logs',
      'enterprise-audit',
      dayFile()
    );
    await waitFor(() => existsSync(file));
    expect(readFileSync(file, 'utf-8')).toContain('alice-probe');
    // 本地目录不得出现租户记录（本用例未写本地事件 ⇒ 正常情况下文件根本不存在）
    const localFile = join(root, 'data', 'logs', 'enterprise-audit', dayFile());
    if (existsSync(localFile)) {
      expect(readFileSync(localFile, 'utf-8')).not.toContain('alice-probe');
    }
  });

  it('查询与统计只覆盖当前身份可见的记录', async () => {
    await record('local-probe');
    await runWithPrincipal(ALICE, () => record('alice-probe'));
    await runWithPrincipal(BOB, () => record('bob-probe'));

    const asAlice = await runWithPrincipal(ALICE, () => service.query({}));
    const actorsForAlice = asAlice.events.map((e) => e.actor);
    expect(actorsForAlice).toContain('alice-probe');
    expect(actorsForAlice).not.toContain('bob-probe');
    expect(actorsForAlice).not.toContain('local-probe');

    const asBob = await runWithPrincipal(BOB, () =>
      service.getStats({ from: 0, to: Date.now() })
    );
    expect(asBob.byActor['alice-probe']).toBeUndefined();
    expect(asBob.byActor['bob-probe']).toBeGreaterThan(0);

    // 本地（宿主/运维）恒放行 ⇒ 两类记录都可见
    const asLocal = await service.query({});
    const actorsForLocal = asLocal.events.map((e) => e.actor);
    expect(actorsForLocal).toContain('alice-probe');
    expect(actorsForLocal).toContain('local-probe');
  });

  it('导出落到各自身份的分区目录，且内容已按归属过滤', async () => {
    await runWithPrincipal(ALICE, () => record('alice-probe'));
    await runWithPrincipal(BOB, () => record('bob-probe'));

    const filePath = await runWithPrincipal(ALICE, () =>
      service.export('json')
    );

    expect(filePath).toContain(
      join(
        'tenants',
        'acme',
        'users',
        'alice',
        'logs',
        'enterprise-audit',
        'export'
      )
    );
    const exported = JSON.parse(readFileSync(filePath, 'utf-8')) as Array<{
      actor: string;
    }>;
    expect(exported.map((e) => e.actor)).toContain('alice-probe');
    expect(exported.map((e) => e.actor)).not.toContain('bob-probe');
  });
});

describe('审计日档保留期解析', () => {
  it('日期段按 UTC 零点解析，非法文件名返回 null（不误删）', () => {
    expect(parseAuditFileDate('2026-10-21_audit.json')).toBe(
      Date.parse('2026-10-21T00:00:00Z')
    );
    expect(parseAuditFileDate('garbage.json')).toBeNull();
    expect(parseAuditFileDate('audit_export_1792590730000.json')).toBeNull();
  });
});
