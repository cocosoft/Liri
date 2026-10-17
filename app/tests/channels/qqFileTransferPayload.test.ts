// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// QQ 文件上传 / 媒体发送的**请求体口径**单测（2026-10-17 取证订正，Spec `.trae/specs/qq-file-transfer.md`）。
//
// 为什么必须有它：真机事故（`QQ 媒体上传失败 {status:400,apiMessage:"请求参数错误"}`）的根因正是
// **请求体与官方文档不符**（旧实现用 multipart/form-data + 字段 `file` + 文档里没有的 `srv_send_msg`），
// 而发送阶段又误用 `media.file_uuid`（文档要求 `media.file_info`）。这两处都是**线上真金白银踩出来的**，
// 故用「捕获真实请求体」的方式把它们钉死 —— 单测**不触网**（stub `globalThis.fetch`，用完还原）。
//
// 依据（外部权威）：QQ 官方「富媒体消息」
// `bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/rich-media.html`
//   · 请求参数：`file_type`（必填）/ `url`（必填，公网）/ `file_data`（可选，base64）
//   · 返回：`file_uuid` / **`file_info`**（「用于发消息接口的 media 字段」）/ `ttl`
// 与「发送单聊消息」示例（`media.file_info`）。

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createQQChannel } from '../../src/channels/qq/QQChannel';

const realFetch = globalThis.fetch;

const TARGET = 'c2c:OPENID_TEST';
const UPLOAD_URL = 'https://api.sgroup.qq.com/v2/users/OPENID_TEST/files';
const SEND_URL = 'https://api.sgroup.qq.com/v2/users/OPENID_TEST/messages';

/** 本仓一个稳定存在的小文件（**只读**，仅用于取 base64 对照） */
const LOCAL_FILE = join(import.meta.dir, '..', '..', 'package.json');

interface Captured {
  url: string;
  contentType: string | null;
  body: Record<string, unknown>;
}

let captured: Captured[] = [];
/** 可注入的上传/发送响应（默认成功） */
let uploadReply = {
  status: 200,
  json: { file_uuid: 'uuid-1', file_info: 'info-1', ttl: 0 } as Record<
    string,
    unknown
  >,
};
let sendReply = {
  status: 200,
  json: { id: 'msg-1' } as Record<string, unknown>,
};

/** 造一个「已连接」的通道实例：只填私有字段（**不**走 connect ⇒ 不会起 WebSocket） */
function makeConnectedChannel(): ReturnType<typeof createQQChannel> {
  const plugin = createQQChannel();
  const priv = plugin as unknown as Record<string, unknown>;
  priv['appId'] = 'app-test';
  priv['accessToken'] = 'token-test';
  priv['accessTokenExpiresAt'] = Date.now() + 3_600_000; // 命中缓存 ⇒ 不换 token（也就不会被 stub 拦截）
  return plugin;
}

beforeEach(() => {
  captured = [];
  uploadReply = {
    status: 200,
    json: { file_uuid: 'uuid-1', file_info: 'info-1', ttl: 0 },
  };
  sendReply = { status: 200, json: { id: 'msg-1' } };

  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const raw = typeof init?.body === 'string' ? init.body : '';
    const reply = url === UPLOAD_URL ? uploadReply : sendReply;
    if (url !== UPLOAD_URL && url !== SEND_URL) {
      throw new Error(`本用例不应发起此请求：${url}`);
    }
    captured.push({
      url,
      contentType: headers['Content-Type'] ?? null,
      body: JSON.parse(raw || '{}') as Record<string, unknown>,
    });
    return new Response(JSON.stringify(reply.json), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch; // 守台账 `L-23-test-global-pollution`：污染必须还原
});

describe('QQ 文件上传：请求体必须是**文档口径的 JSON**', () => {
  it('本地文件 ⇒ `{file_type:4, file_data:<base64>}`；**无** `file`、**无** `srv_send_msg`', async () => {
    const plugin = makeConnectedChannel();
    const res = await plugin.outbound.sendFile(TARGET, LOCAL_FILE);

    expect(res.success).toBe(true);
    const [up] = captured;
    expect(up!.url).toBe(UPLOAD_URL);
    // ★ 旧实现是 multipart（无 Content-Type: application/json）⇒ 真机回 400「请求参数错误」
    expect(up!.contentType).toBe('application/json');
    expect(up!.body['file_type']).toBe(4);
    expect(up!.body['file_data']).toBe(
      readFileSync(LOCAL_FILE).toString('base64')
    );
    expect(up!.body['file']).toBeUndefined(); // ★ multipart 的 `file` 字段
    expect(up!.body['srv_send_msg']).toBeUndefined(); // ★ 文档里没有的字段
    expect(up!.body['url']).toBeUndefined(); // 本地文件不走 url
  });

  it('公网 URL ⇒ `{file_type:4, url}`（不带 base64）', async () => {
    const plugin = makeConnectedChannel();
    const remote = 'https://example.com/a.pdf';
    const res = await plugin.outbound.sendFile(TARGET, remote);

    expect(res.success).toBe(true);
    const [up] = captured;
    expect(up!.body).toEqual({ file_type: 4, url: remote });
  });
});

describe('QQ 媒体发送：`media` 必须用 `file_info`（文档口径）', () => {
  it('发送体 = `{msg_type:7, media:{file_info}}`，**不含** `file_uuid`', async () => {
    const plugin = makeConnectedChannel();
    await plugin.outbound.sendFile(TARGET, LOCAL_FILE);

    expect(captured).toHaveLength(2);
    const send = captured[1]!;
    expect(send.url).toBe(SEND_URL);
    expect(send.body['msg_type']).toBe(7);
    expect(send.body['media']).toEqual({ file_info: 'info-1' });
    expect(
      (send.body['media'] as Record<string, unknown>)['file_uuid']
    ).toBeUndefined();
  });
});

describe('失败面：不静默、不臆造', () => {
  it('上传 400 ⇒ 如实回 API 的 message，且**不**发消息', async () => {
    uploadReply = { status: 400, json: { message: '请求参数错误' } };
    const plugin = makeConnectedChannel();
    const res = await plugin.outbound.sendFile(TARGET, LOCAL_FILE);

    expect(res.success).toBe(false);
    expect(res.error).toContain('请求参数错误');
    expect(captured).toHaveLength(1); // 只发了上传，没有发消息
  });

  it('上传成功但**缺 `file_info`** ⇒ 报错且**不**发消息（不拿 `file_uuid` 硬发）', async () => {
    uploadReply = { status: 200, json: { file_uuid: 'uuid-only', ttl: 0 } };
    const plugin = makeConnectedChannel();
    const res = await plugin.outbound.sendFile(TARGET, LOCAL_FILE);

    expect(res.success).toBe(false);
    expect(res.error).toContain('file_info');
    expect(captured).toHaveLength(1);
  });
});
