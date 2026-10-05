/**
 * auto-reply HTTP handlers —— 4 端点契约（P1-10 测试盲区补齐，2026-10-05）
 *
 * 背景（spec `layer-inversion-service-app-app-ui.md` §3.3 ④ 遗留）：全仓 `*.test.ts`
 * grep `AutoReplyEngine|autoReplyEngine|auto-reply` **0 命中** ⇒ 本域 4 个端点
 * **无任何用例覆盖**。本文件锁住 4 端点的**响应形状 + 序列化规则 + 校验/404 分支**。
 *
 * 4 端点：
 *  - GET    /v1/auto-reply/rules        `handleListAutoReplyRules`
 *  - POST   /v1/auto-reply/rules        `handleCreateAutoReplyRule`
 *  - PUT    /v1/auto-reply/rules/:id    `handleUpdateAutoReplyRule`
 *  - DELETE /v1/auto-reply/rules/:id    `handleDeleteAutoReplyRule`
 *
 * 说明：**不使用 `mock.module`**（进程级副作用）；改用 `spyOn` + `mockRestore`，
 * 并**动态导入**被测 handler（静态 import 会被 ESM 提升，早于 spy 生效）。
 */

import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type http from 'http';
import {
  readRequestBody,
  sendError,
} from '../../src/infrastructure/http/handlers/handler-utils';
import type {
  AutoReplyRuleDto,
  AutoReplyRuleInput,
} from '../../src/runtime/api/autoReplyPorts';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';

/** 当前端口返回的规则（每个用例前重置） */
let rules: AutoReplyRuleDto[] = [];
/** 记录 registerRule / updateRule / deleteRule 的入参 */
let registered: AutoReplyRuleInput[] = [];
let updated: Array<[string, Partial<AutoReplyRuleInput>]> = [];
let deleted: string[] = [];

const portStub = {
  getAllRules: () => rules,
  getStats: () => ({ total: rules.length }),
  registerRule: (rule: AutoReplyRuleInput): AutoReplyRuleDto => {
    registered.push(rule);
    return { id: 'new-1', ...rule };
  },
  updateRule: (
    ruleId: string,
    updates: Partial<AutoReplyRuleInput>
  ): AutoReplyRuleDto | null => {
    updated.push([ruleId, updates]);
    const base = rules.find((r) => r.id === ruleId);
    if (!base) return null;
    return { ...base, ...updates };
  },
  deleteRule: (ruleId: string): boolean => {
    deleted.push(ruleId);
    return ruleId === 'exists';
  },
};

const getCoreAPISpy = spyOn(coreAPIModule, 'getCoreAPI').mockReturnValue({
  getAutoReplyPort: async () => portStub,
} as never);

afterAll(() => {
  getCoreAPISpy.mockRestore();
});

beforeEach(() => {
  rules = [];
  registered = [];
  updated = [];
  deleted = [];
});

const {
  handleListAutoReplyRules,
  handleCreateAutoReplyRule,
  handleUpdateAutoReplyRule,
  handleDeleteAutoReplyRule,
} = await import('../../src/infrastructure/http/handlers/auto-reply-handlers');

function makeReq(bodyJson = ''): http.IncomingMessage {
  return {
    url: '/v1/auto-reply/rules',
    headers: {},
    method: 'POST',
    on(event: string, cb: (arg?: unknown) => void) {
      if (event === 'data' && bodyJson) cb(Buffer.from(bodyJson));
      if (event === 'end') queueMicrotask(() => cb());
      return this;
    },
  } as unknown as http.IncomingMessage;
}

function makeRes(): {
  res: http.ServerResponse;
  read: () => { status: number; body: Record<string, unknown> };
} {
  const out = { status: 0, body: '' };
  const res = {
    headersSent: false,
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

describe('auto-reply HTTP handlers（P1-10 盲区补齐）', () => {
  test('list：RegExp → {type:regexp,value,flags}；string → substring；函数 response → 空串', async () => {
    rules = [
      {
        id: 'r1',
        name: 'n1',
        pattern: /hello/gi,
        response: 'hi',
        priority: 2,
        channel: 'qq',
        enabled: true,
        cooldown: 5,
      },
      {
        id: 'r2',
        name: 'n2',
        pattern: 'plain',
        response: () => 'fn',
        priority: 1,
        enabled: false,
      },
    ];

    const { res, read } = makeRes();
    await handleListAutoReplyRules(makeReq(), res);

    expect(read()).toEqual({
      status: 200,
      body: {
        rules: [
          {
            id: 'r1',
            name: 'n1',
            pattern: { type: 'regexp', value: 'hello', flags: 'gi' },
            response: 'hi',
            priority: 2,
            channel: 'qq',
            enabled: true,
            cooldown: 5,
          },
          {
            id: 'r2',
            name: 'n2',
            pattern: { type: 'substring', value: 'plain' },
            response: '',
            priority: 1,
            enabled: false,
          },
        ],
        stats: { total: 2 },
      },
    });
  });

  test('create：缺 name/pattern/response ⇒ 400（端口零调用）', async () => {
    const { res, read } = makeRes();
    await handleCreateAutoReplyRule(
      makeReq(JSON.stringify({ name: 'x' })),
      res
    );

    expect(read()).toEqual({
      status: 400,
      body: { error: { message: 'name / pattern / response 为必填项' } },
    });
    expect(registered).toEqual([]);
  });

  test('create：成功 ⇒ pattern 解析为 RegExp 入库，200 返回序列化规则', async () => {
    const { res, read } = makeRes();
    await handleCreateAutoReplyRule(
      makeReq(
        JSON.stringify({
          name: 'x',
          pattern: { type: 'regexp', value: 'a+b', flags: 'i' },
          response: 'r',
        })
      ),
      res
    );

    expect(registered).toHaveLength(1);
    expect(registered[0].pattern).toBeInstanceOf(RegExp);
    expect((registered[0].pattern as RegExp).source).toBe('a+b');
    expect(registered[0].priority).toBe(1);
    expect(registered[0].enabled).toBe(true);

    expect(read()).toEqual({
      status: 200,
      body: {
        id: 'new-1',
        name: 'x',
        pattern: { type: 'regexp', value: 'a+b', flags: 'i' },
        response: 'r',
        priority: 1,
        enabled: true,
      },
    });
  });

  test('create：pattern 结构非法 ⇒ 400（错误文案含 pattern）', async () => {
    const { res, read } = makeRes();
    await handleCreateAutoReplyRule(
      makeReq(
        JSON.stringify({ name: 'x', pattern: { type: 'bogus' }, response: 'r' })
      ),
      res
    );

    const r = read();
    expect(r.status).toBe(400);
    expect(String((r.body.error as { message: string }).message)).toContain(
      'pattern'
    );
    expect(registered).toEqual([]);
  });

  test('update：规则不存在 ⇒ 404', async () => {
    rules = [];
    const { res, read } = makeRes();
    await handleUpdateAutoReplyRule(
      makeReq(JSON.stringify({ name: 'n' })),
      res,
      'missing'
    );

    expect(updated).toEqual([['missing', { name: 'n' }]]);
    expect(read()).toEqual({
      status: 404,
      body: { error: { message: '规则不存在: missing' } },
    });
  });

  test('update：命中 ⇒ 仅传出现的字段，200 返回序列化规则', async () => {
    rules = [
      {
        id: 'r1',
        name: 'old',
        pattern: 'p',
        response: 'resp',
        priority: 1,
        enabled: true,
      },
    ];
    const { res, read } = makeRes();
    await handleUpdateAutoReplyRule(
      makeReq(JSON.stringify({ enabled: false, pattern: 'q' })),
      res,
      'r1'
    );

    expect(updated).toEqual([['r1', { enabled: false, pattern: 'q' }]]);
    const r = read();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      id: 'r1',
      name: 'old',
      pattern: { type: 'substring', value: 'q' },
      response: 'resp',
      priority: 1,
      enabled: false,
    });
  });

  test('delete：透传 ruleId，200 返回 deleted 布尔', async () => {
    const hit = makeRes();
    await handleDeleteAutoReplyRule(makeReq(), hit.res, 'exists');
    expect(deleted).toEqual(['exists']);
    expect(hit.read()).toEqual({ status: 200, body: { deleted: true } });

    const miss = makeRes();
    await handleDeleteAutoReplyRule(makeReq(), miss.res, 'nope');
    expect(miss.read()).toEqual({ status: 200, body: { deleted: false } });
  });
});
