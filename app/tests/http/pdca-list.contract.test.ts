// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * POST /v1/pdca/list 契约测试（1-5 P1 前置，2026-09-03）
 * 验证：checkpoint 回退（无内存 orchestrator 时列表非空）+ projectId/sessionId/workspaceId
 * 过滤 + checkpoint-only 条目 source 标记。隔离 LIRI_HOME（临时目录）。
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import type http from 'http';

process.env.LIRI_HOME = mkdtempSync(join(tmpdir(), 'pdca-list-http-'));

const { writePdcaCheckpoint } =
  await import('../../src/tasks/PdcaWorkItemBridge');
const { handlePdcaList } =
  await import('../../src/infrastructure/http/handlers/pdca-handlers');

function createRes(): {
  res: http.ServerResponse;
  body: string;
  status: number;
} {
  const out = { body: '', status: 0 };
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
    get body() {
      return out.body;
    },
    get status() {
      return out.status;
    },
  };
}

function makeReq(body?: object): http.IncomingMessage {
  const text = body === undefined ? '' : JSON.stringify(body);
  const req = new Readable({ read() {} }) as unknown as http.IncomingMessage & {
    headers: Record<string, string>;
  };
  req.headers = {
    'content-length': String(Buffer.byteLength(text)),
    host: 'localhost',
  };
  if (text) req.push(Buffer.from(text));
  req.push(null);
  return req;
}

async function call(body?: object) {
  const created = createRes();
  await handlePdcaList(makeReq(body), created.res);
  return { status: created.status, body: JSON.parse(created.body) as any[] };
}

// 预写 checkpoint（模拟跨重启遗留任务，无内存 orchestrator）
writePdcaCheckpoint('pdca_ck_a', {
  taskId: 'pdca_ck_a',
  workItemId: 'wi_a',
  status: 'running',
  description: '跨重启遗留目标',
  sessionId: 'sess_a',
  workspaceId: 'ws1',
  projectId: 'proj_x',
});
writePdcaCheckpoint('pdca_ck_b', {
  taskId: 'pdca_ck_b',
  workItemId: 'wi_b',
  status: 'completed',
  description: '已完成目标',
  sessionId: 'sess_b',
  workspaceId: 'ws2',
  projectId: 'proj_x',
});

describe('POST /v1/pdca/list 契约（1-5 P1）', () => {
  test('无 body：列出 checkpoint 回退任务（重启后非空）', async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    const a = body.find((t: any) => t.taskId === 'pdca_ck_a');
    expect(a).toBeDefined();
    expect(a.source).toBe('checkpoint');
    expect(a.status).toBe('running');
    expect(a.projectId).toBe('proj_x');
    expect(a.workspaceId).toBe('ws1');
    expect(a.sessionId).toBe('sess_a');
  });

  test('?projectId=proj_x → 2 项；proj_y → 0 项', async () => {
    const x = await call({ projectId: 'proj_x' });
    expect(x.body.length).toBe(2);
    const y = await call({ projectId: 'proj_y' });
    expect(y.body.length).toBe(0);
  });

  test('?sessionId=sess_a → 1 项', async () => {
    const { body } = await call({ sessionId: 'sess_a' });
    expect(body.length).toBe(1);
    expect(body[0].taskId).toBe('pdca_ck_a');
  });

  test('?workspaceId=ws2 → 1 项（pdca_ck_b）', async () => {
    const { body } = await call({ workspaceId: 'ws2' });
    expect(body.length).toBe(1);
    expect(body[0].taskId).toBe('pdca_ck_b');
  });
});
