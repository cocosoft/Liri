/**
 * handleAttachStream 线格式测试（2026-11-18，Spec `.trae/specs/stream-attach.md` §4/§9）
 *
 * 锁死 attach 端点的**外部可见行为**（不启动 HTTP 服务，用最小 fake req/res）：
 * - 失败一律 JSON（400/404），绝不返回"看似连续"的 SSE；
 * - 成功：首帧 `attach_meta` → `id:` + 与主链路同形帧 → 结束时关闭；
 * - 本轮已结束（保留期内）⇒ 回放完立即关闭，不挂起连接。
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import type http from 'http';

import { handleAttachStream } from '../chat-handlers';
import { __resetAttachHubForTest, beginRun } from '../streamAttachHub';

const SID = 'session_attach_handler_test';

interface FakeRes {
  status: number;
  headers: Record<string, string> | undefined;
  chunks: string[];
  destroyed: boolean;
  writableEnded: boolean;
  writableLength: number;
  socket: { setNoDelay: () => void };
  writeHead: (status: number, headers?: Record<string, string>) => FakeRes;
  write: (chunk: string) => boolean;
  end: (body?: string) => void;
  on: (event: string, cb: () => void) => FakeRes;
  flush: () => void;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    status: 0,
    headers: undefined,
    chunks: [],
    destroyed: false,
    writableEnded: false,
    writableLength: 0,
    socket: { setNoDelay: () => {} },
    writeHead(status, headers) {
      res.status = status;
      res.headers = headers;
      return res;
    },
    write(chunk) {
      res.chunks.push(chunk);
      return true;
    },
    end(body) {
      // 失败分支把 JSON 直接交给 end（与真实 ServerResponse 一致）
      if (body) res.chunks.push(body);
      res.writableEnded = true;
    },
    on() {
      return res;
    },
    flush: () => {},
  };
  return res;
}

function makeReq(url: string): http.IncomingMessage {
  return { url } as unknown as http.IncomingMessage;
}

async function attach(res: FakeRes, url: string): Promise<void> {
  await handleAttachStream(
    {} as never,
    makeReq(url),
    res as unknown as http.ServerResponse,
    SID
  );
}

beforeEach(() => {
  __resetAttachHubForTest();
});

describe('handleAttachStream —— 显式失败（JSON，非 SSE）', () => {
  it('无运行中的 run ⇒ 404 no_active_run', async () => {
    const res = makeRes();
    await attach(res, `/v1/sessions/${SID}/attach?from_seq=0`);
    expect(res.status).toBe(404);
    expect(res.chunks).toHaveLength(1);
    expect(JSON.parse(res.chunks[0])).toEqual({
      error: {
        code: 'no_active_run',
        message: '该会话当前没有运行中的回复（或已超出保留期）',
      },
    });
  });

  it('from_seq 非法 ⇒ 400 invalid_from_seq（不返回 SSE 头）', async () => {
    beginRun(SID, 'run-1');
    const res = makeRes();
    await attach(res, `/v1/sessions/${SID}/attach?from_seq=abc`);
    expect(res.status).toBe(400);
    expect(res.headers?.['Content-Type']).toBe('application/json');
  });

  it('run_id 不匹配 ⇒ 409 run_mismatch', async () => {
    beginRun(SID, 'run-1');
    const res = makeRes();
    await attach(res, `/v1/sessions/${SID}/attach?from_seq=0&run_id=run-old`);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.chunks[0]).error.code).toBe('run_mismatch');
  });
});

describe('handleAttachStream —— 成功（SSE）', () => {
  it('已结束的 run：meta → id 帧 → 立即关闭', async () => {
    const run = beginRun(SID, 'run-1');
    run.publish('data: {"n":1}\n\n');
    run.publish('data: [DONE]\n\n');
    run.end();

    const res = makeRes();
    await attach(res, `/v1/sessions/${SID}/attach?from_seq=0`);

    expect(res.status).toBe(200);
    expect(res.headers?.['Content-Type']).toBe(
      'text/event-stream; charset=utf-8'
    );
    expect(res.chunks[0]).toContain('"__pyapp_type":"attach_meta"');
    expect(res.chunks[1]).toBe('id: 0\ndata: {"n":1}\n\n');
    expect(res.chunks[2]).toBe('id: 1\ndata: [DONE]\n\n');
    expect(res.writableEnded).toBe(true);
  });

  it('运行中的 run：回放后保持连接，实时帧继续以 id 写出，end() 关闭', async () => {
    const run = beginRun(SID, 'run-1');
    run.publish('data: {"n":1}\n\n');

    const res = makeRes();
    await attach(res, `/v1/sessions/${SID}/attach?from_seq=1`);
    // from_seq=1 ⇒ 无回放，仅 meta
    expect(res.chunks).toHaveLength(1);
    expect(res.writableEnded).toBe(false);

    run.publish('data: {"n":2}\n\n');
    expect(res.chunks[1]).toBe('id: 1\ndata: {"n":2}\n\n');

    run.end();
    expect(res.writableEnded).toBe(true);
  });
});
