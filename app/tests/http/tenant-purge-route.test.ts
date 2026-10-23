/**
 * 多租户 P5：删除租户的 HTTP 入口（`DELETE /v1/tenants/:tenantId`）
 *
 * 覆盖：
 * ① 路由命中与不命中（GET / 空 id / 带查询串）；
 * ② `local` / 空租户 ⇒ **400**（且在触碰任何数据**之前**拒绝）；
 * ③ 清除成功 ⇒ **200** + 报告原样返回（`removed` / `blocked` / `notPurged`）；
 * ④ 清除过程抛错 ⇒ **500**（不谎报成功）；
 * ⑤ URL 百分号编码的租户标识被解码后传给清除器。
 *
 * 说明：清除本身的顺序与幂等已由 `tests/runtime/tenantPurge.test.ts` 覆盖，
 * 本文件只验证 **HTTP 编排**（校验 → 调用 → 审计 → 响应），故注入 stub 清除器。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type http from 'http';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { setUserDataDirOverride } from '@modules/core/paths.js';
import {
  validatePurgeableTenantId,
  type TenantPurgeReport,
} from '../../src/runtime/tenantPurge.js';
import { handleDeleteTenant } from '../../src/infrastructure/http/handlers/tenant-handlers';
import { dispatchTenantRoutes } from '../../src/infrastructure/http/handlers/routes/tenant-routes';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import { AuthUserStore } from '../../src/infrastructure/http/auth/AuthUserStore';
import { __setAuthUserStoreForTest } from '../../src/infrastructure/http/handlers/auth-handlers';

const noopBroadcast = (): void => {};
const ctx = {} as HandlerCtx;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-tenant-route-'));
  // 审计落盘走临时数据根（不污染真实 `~/.pyapp`）
  setUserDataDirOverride(root);
  // 删除成功后会解绑该租户的账号 ⇒ 用户存储也换成临时文件（不碰真实 users.json）
  __setAuthUserStoreForTest(new AuthUserStore(join(root, 'users.json')));
});

afterEach(() => {
  setUserDataDirOverride(null);
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // @ignore-catch — 清理临时目录失败不影响断言（Windows 句柄可能延迟释放）
  }
});

function makeReq(method: string): http.IncomingMessage {
  return { method, on: () => {} } as unknown as http.IncomingMessage;
}

function createRes(): {
  res: http.ServerResponse;
  read: () => { status: number; body: Record<string, unknown> };
} {
  const out = { status: 0, body: '' };
  const res = {
    writeHead: (code: number) => {
      out.status = code;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    read: () => ({
      status: out.status,
      body: out.body ? (JSON.parse(out.body) as Record<string, unknown>) : {},
    }),
  };
}

/** 最小清除报告（形状完整，便于断言"原样返回"） */
function makeReport(tenantId: string): TenantPurgeReport {
  return {
    tenantId,
    ownerPrefix: `${tenantId}:`,
    removed: {
      tenantDataDir: true,
      channelConfigs: 1,
      cronJobs: 2,
      taskFlows: 3,
      usageRecords: 4,
      modelUsageLogs: 5,
      skillUsageRecords: 6,
      projects: 1,
      sseConnections: 0,
      tenantChannels: 0,
      scopedConnections: 0,
      dailyBudgets: 1,
      scopedCaches: 2,
      approvedCommands: 0,
    },
    blocked: [],
    notPurged: ['示例：不可定位数据面'],
  };
}

describe('dispatcher：DELETE /v1/tenants/:tenantId', () => {
  it('GET 同路径不命中（本入口只允许 DELETE）', async () => {
    const { res } = createRes();
    const matched = await dispatchTenantRoutes(
      makeReq('GET'),
      res,
      '/v1/tenants/acme',
      noopBroadcast,
      ctx
    );
    expect(matched).toBe(false);
  });

  it('路径缺 tenantId 片段 ⇒ 不命中', async () => {
    const { res } = createRes();
    const matched = await dispatchTenantRoutes(
      makeReq('DELETE'),
      res,
      '/v1/tenants/',
      noopBroadcast,
      ctx
    );
    expect(matched).toBe(false);
  });

  it('DELETE /v1/tenants/local ⇒ 命中且 400（拒绝清除宿主身份）', async () => {
    const { res, read } = createRes();
    const matched = await dispatchTenantRoutes(
      makeReq('DELETE'),
      res,
      '/v1/tenants/local',
      noopBroadcast,
      ctx
    );
    expect(matched).toBe(true);
    const { status, body } = read();
    expect(status).toBe(400);
    expect(String((body['error'] as { message?: string })?.message)).toContain(
      'local'
    );
  });

  it('查询串不影响路径匹配（DELETE /v1/tenants/local?force=1 ⇒ 400）', async () => {
    const { res, read } = createRes();
    const matched = await dispatchTenantRoutes(
      makeReq('DELETE'),
      res,
      '/v1/tenants/local?force=1',
      noopBroadcast,
      ctx
    );
    expect(matched).toBe(true);
    expect(read().status).toBe(400);
  });
});

describe('handler：校验 / 调用 / 响应', () => {
  it('空白租户标识 ⇒ 400 且**不调用**清除器（不触碰任何数据）', async () => {
    const calls: string[] = [];
    const { res, read } = createRes();
    await handleDeleteTenant(makeReq('DELETE'), res, '   ', async (id) => {
      calls.push(id);
      return makeReport(id);
    });
    expect(calls).toEqual([]);
    expect(read().status).toBe(400);
  });

  it('成功 ⇒ 200 + 报告原样返回，且清除器收到 trim 后的标识', async () => {
    const calls: string[] = [];
    const { res, read } = createRes();
    await handleDeleteTenant(makeReq('DELETE'), res, '  acme  ', async (id) => {
      calls.push(id);
      return makeReport(id);
    });
    expect(calls).toEqual(['acme']);
    const { status, body } = read();
    expect(status).toBe(200);
    expect(body['tenantId']).toBe('acme');
    expect(body['ownerPrefix']).toBe('acme:');
    expect((body['removed'] as Record<string, number>)['cronJobs']).toBe(2);
    expect(body['notPurged']).toEqual(['示例：不可定位数据面']);
  });

  it('百分号编码的租户标识被解码后传给清除器', async () => {
    const calls: string[] = [];
    const { res } = createRes();
    await handleDeleteTenant(
      makeReq('DELETE'),
      res,
      'acme%2Fcorp',
      async (id) => {
        calls.push(id);
        return makeReport(id);
      }
    );
    expect(calls).toEqual(['acme/corp']);
  });

  it('清除器抛错 ⇒ 500 且错误信息回传（不谎报成功）', async () => {
    const { res, read } = createRes();
    await handleDeleteTenant(makeReq('DELETE'), res, 'acme', async () => {
      throw new Error('磁盘忙');
    });
    const { status, body } = read();
    expect(status).toBe(500);
    expect(String((body['error'] as { message?: string })?.message)).toContain(
      '磁盘忙'
    );
  });
});

describe('validatePurgeableTenantId（与 purgeTenant 同源判定）', () => {
  it('空白 / local 被拒；其余 trim 后通过', () => {
    expect(validatePurgeableTenantId('  ').ok).toBe(false);
    expect(validatePurgeableTenantId('local').ok).toBe(false);
    expect(validatePurgeableTenantId(' acme ')).toEqual({
      ok: true,
      tenantId: 'acme',
    });
  });
});
