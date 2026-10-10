// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * ① P2 —— A2A **只读发现面**纯响应单测（2026-10-10）。
 *
 * 依据：`dev_docs/20261010/A2A-MCP网关进程级侧车隔离-设计方案-20261010.md` §8.1（P2）。
 */
import { describe, expect, it } from 'bun:test';
import {
  handleDiscoveryRequest,
  DISCOVERY_AGENT_CARD_PATH,
  DISCOVERY_HEALTH_PATH,
  type A2ADiscoverySnapshot,
} from '../../../../src/infrastructure/http/a2a/discoverySurface';
import type { A2AAgentCard } from '../../../../src/types/a2a';

const CARD = { name: 'Liri Agent' } as unknown as A2AAgentCard;
const SNAP: A2ADiscoverySnapshot = {
  card: CARD,
  etag: 'W/"v1-abc"',
  delegatorReady: true,
};

describe('① P2 发现面：路径匹配', () => {
  it('非发现面路径 ⇒ handled=false（调用方 404）', () => {
    const r = handleDiscoveryRequest({
      method: 'GET',
      url: '/v1/a2a/tasks',
      snapshot: SNAP,
    });
    expect(r.handled).toBe(false);
    expect(r.status).toBe(404);
  });
});

describe('① P2 发现面：卡片与 ETag', () => {
  it('GET 卡片 ⇒ 200 + ETag + 卡片', () => {
    const r = handleDiscoveryRequest({
      method: 'GET',
      url: DISCOVERY_AGENT_CARD_PATH,
      snapshot: SNAP,
    });
    expect(r.status).toBe(200);
    expect(r.headers?.ETag).toBe(SNAP.etag);
    expect(r.body).toBe(CARD);
  });

  it('If-None-Match 命中 ⇒ 304（无 body）', () => {
    const r = handleDiscoveryRequest({
      method: 'GET',
      url: DISCOVERY_AGENT_CARD_PATH,
      ifNoneMatch: SNAP.etag,
      snapshot: SNAP,
    });
    expect(r.status).toBe(304);
    expect(r.body).toBeUndefined();
  });

  it('非 GET ⇒ 405', () => {
    const r = handleDiscoveryRequest({
      method: 'POST',
      url: DISCOVERY_AGENT_CARD_PATH,
      snapshot: SNAP,
    });
    expect(r.status).toBe(405);
  });
});

describe('① P2 发现面：健康与未就绪', () => {
  it('GET 健康 ⇒ 200 + delegatorReady（不泄露密钥/版本）', () => {
    const r = handleDiscoveryRequest({
      method: 'GET',
      url: DISCOVERY_HEALTH_PATH,
      snapshot: SNAP,
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok', delegatorReady: true });
  });

  it('快照未就绪（null）⇒ 503（不伪造卡片）', () => {
    const card = handleDiscoveryRequest({
      method: 'GET',
      url: DISCOVERY_AGENT_CARD_PATH,
      snapshot: null,
    });
    const health = handleDiscoveryRequest({
      method: 'GET',
      url: DISCOVERY_HEALTH_PATH,
      snapshot: null,
    });
    expect(card.status).toBe(503);
    expect(health.status).toBe(503);
  });
});
