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
 * KlingProvider 单测 — 可灵 AI（快手）视频生成 Provider
 *
 * 覆盖：
 * - submitVideoTask：文生/图生 URL 与 body 映射、鉴权头（AK:SK → JWT 验签 / 纯 token）
 * - queryVideoTask：succeed/failed/processing/submitted 状态归一化 + 视频 URL 提取
 * - generateVideo：提交 → 轮询 → 取 URL 全流程（mock fetch 分阶段返回）
 *
 * 隔离策略：LIRI_DATA_DIR 指向临时目录（不写真实 DB），
 * API Key 通过 process.env.KLING_API_KEY 注入（resolveApiKey 的 DB 层回退到 env）。
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { KlingProvider } from '../../../src/ai/providers/KlingProvider.js';

const BASE_URL = 'https://api.klingai.com';
const ACCESS_KEY = 'test-access-key';
const SECRET_KEY = 'test-secret-key';
const API_KEY = `${ACCESS_KEY}:${SECRET_KEY}`;

/** 构造 mock Response（只暴露实现用到的字段） */
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** 分阶段 mock fetch：按调用顺序依次返回 stages（超出后重复最后一个） */
function stagedFetch(stages: unknown[]): ReturnType<typeof mock> {
  let index = 0;
  return mock((url: string | URL, init?: RequestInit) => {
    const stage = stages[Math.min(index, stages.length - 1)];
    index++;
    return Promise.resolve(jsonResponse(stage));
  }) as ReturnType<typeof mock>;
}

/** 提取某次调用的 Authorization 头 */
function authOf(init?: RequestInit): string {
  return (
    (init?.headers as Record<string, string> | undefined)?.['Authorization'] ||
    ''
  );
}

let tmpDir: string;
let originalFetch: typeof fetch;

beforeAll(() => {
  // 隔离数据目录：resolveApiKey/resolveBaseUrl 的 DB 层（LIRI_DATA_DIR 下无 DB）
  // 将回退到环境变量 / options.defaultBaseUrl，不触碰真实 app.db
  tmpDir = mkdtempSync(join(tmpdir(), 'kling-provider-test-'));
  process.env.LIRI_DATA_DIR = tmpDir;
  process.env.KLING_API_KEY = API_KEY;
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterAll(() => {
  delete process.env.KLING_API_KEY;
  delete process.env.LIRI_DATA_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('submitVideoTask', () => {
  it('文生视频：URL/body/鉴权头正确（AK:SK → JWT 验签）', async () => {
    const fetchMock = stagedFetch([{ code: 0, data: { task_id: 'task-123' } }]);
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new KlingProvider();
    const { taskId } = await (
      provider as unknown as {
        submitVideoTask(
          params: Record<string, unknown>,
          apiKey: string
        ): Promise<{ taskId: string }>;
      }
    ).submitVideoTask(
      {
        model: 'kling-v1-6',
        prompt: '一只猫在奔跑',
        duration: 5,
        aspectRatio: '16:9',
        seed: 42,
        negativePrompt: '模糊',
      },
      API_KEY
    );

    expect(taskId).toBe('task-123');
    expect(fetchMock.mock.calls).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${BASE_URL}/v1/videos/text2video`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      prompt: '一只猫在奔跑',
      model_name: 'kling-v1-6',
      negative_prompt: '模糊',
      duration: '5',
      aspect_ratio: '16:9',
      seed: 42,
    });

    // JWT 鉴权：Bearer 携带可验签 token，payload.iss = accessKey
    const auth = authOf(init);
    expect(auth.startsWith('Bearer ')).toBe(true);
    const token = auth.slice('Bearer '.length);
    const payload = jwt.verify(token, SECRET_KEY, {
      algorithms: ['HS256'],
    }) as { iss?: string };
    expect(payload.iss).toBe(ACCESS_KEY);
  });

  it('图生视频（imageUrl）：URL 为 image2video，body.image 传 URL', async () => {
    const fetchMock = stagedFetch([{ code: 0, data: { task_id: 'task-img' } }]);
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new KlingProvider();
    await (
      provider as unknown as {
        submitVideoTask(
          params: Record<string, unknown>,
          apiKey: string
        ): Promise<{ taskId: string }>;
      }
    ).submitVideoTask(
      {
        model: 'kling-v1-6',
        prompt: '让图片动起来',
        imageUrl: 'https://example.com/input.png',
      },
      API_KEY
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${BASE_URL}/v1/videos/image2video`);
    expect(JSON.parse(init?.body as string)).toEqual({
      prompt: '让图片动起来',
      model_name: 'kling-v1-6',
      image: 'https://example.com/input.png',
    });
  });

  it('纯 token 格式：直接作为 Bearer token', async () => {
    const fetchMock = stagedFetch([{ code: 0, data: { task_id: 'task-1' } }]);
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new KlingProvider();
    await (
      provider as unknown as {
        submitVideoTask(
          params: Record<string, unknown>,
          apiKey: string
        ): Promise<{ taskId: string }>;
      }
    ).submitVideoTask({ model: 'kling-v1-6', prompt: 'x' }, 'raw-token-abc');

    const [, init] = fetchMock.mock.calls[0];
    expect(authOf(init)).toBe('Bearer raw-token-abc');
  });

  it('官方业务错误码非 0 时抛 AppError', async () => {
    const fetchMock = stagedFetch([{ code: 4003, message: '参数错误' }]);
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new KlingProvider();
    await expect(
      (
        provider as unknown as {
          submitVideoTask(
            params: Record<string, unknown>,
            apiKey: string
          ): Promise<{ taskId: string }>;
        }
      ).submitVideoTask({ model: 'kling-v1-6', prompt: 'x' }, API_KEY)
    ).rejects.toThrow(/4003|参数错误/);
  });
});

describe('queryVideoTask', () => {
  it('succeed：提取 task_result.videos[0].url，查询路径带接口类型', async () => {
    const fetchMock = stagedFetch([
      { code: 0, data: { task_id: 'task-1' } },
      {
        code: 0,
        data: {
          task_id: 'task-1',
          task_status: 'succeed',
          task_result: {
            videos: [
              { id: 'v1', url: 'https://v.klingai.com/a.mp4', duration: '5' },
            ],
          },
        },
      },
    ]);
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new KlingProvider();
    // 先提交以确定 endpoint（text2video）
    await (
      provider as unknown as {
        submitVideoTask(
          params: Record<string, unknown>,
          apiKey: string
        ): Promise<{ taskId: string }>;
      }
    ).submitVideoTask({ model: 'kling-v1-6', prompt: 'x' }, API_KEY);
    const state = await (
      provider as unknown as {
        queryVideoTask(
          taskId: string,
          apiKey: string
        ): Promise<{ state: string; videoUrl?: string; error?: string }>;
      }
    ).queryVideoTask('task-1', API_KEY);

    expect(state).toEqual({
      state: 'completed',
      videoUrl: 'https://v.klingai.com/a.mp4',
    });
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      `${BASE_URL}/v1/videos/text2video/task-1`
    );
  });

  it('failed：返回失败状态与 task_status_msg', async () => {
    const fetchMock = stagedFetch([
      { code: 0, data: { task_id: 'task-1' } },
      {
        code: 0,
        data: {
          task_id: 'task-1',
          task_status: 'failed',
          task_status_msg: '触发内容风控',
        },
      },
    ]);
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new KlingProvider();
    await (
      provider as unknown as {
        submitVideoTask(
          params: Record<string, unknown>,
          apiKey: string
        ): Promise<{ taskId: string }>;
      }
    ).submitVideoTask({ model: 'kling-v1-6', prompt: 'x' }, API_KEY);
    const state = await (
      provider as unknown as {
        queryVideoTask(
          taskId: string,
          apiKey: string
        ): Promise<{ state: string; videoUrl?: string; error?: string }>;
      }
    ).queryVideoTask('task-1', API_KEY);

    expect(state).toEqual({ state: 'failed', error: '触发内容风控' });
  });

  it('processing → running，submitted → pending，未知状态 → unknown', async () => {
    const fetchMock = stagedFetch([
      { code: 0, data: { task_id: 'task-1' } },
      { code: 0, data: { task_id: 'task-1', task_status: 'processing' } },
      { code: 0, data: { task_id: 'task-1', task_status: 'submitted' } },
      { code: 0, data: { task_id: 'task-1', task_status: 'weird' } },
    ]);
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new KlingProvider();
    await (
      provider as unknown as {
        submitVideoTask(
          params: Record<string, unknown>,
          apiKey: string
        ): Promise<{ taskId: string }>;
      }
    ).submitVideoTask({ model: 'kling-v1-6', prompt: 'x' }, API_KEY);
    const query = (
      provider as unknown as {
        queryVideoTask(
          taskId: string,
          apiKey: string
        ): Promise<{ state: string; videoUrl?: string; error?: string }>;
      }
    ).queryVideoTask.bind(provider);

    expect((await query('task-1', API_KEY)).state).toBe('running');
    expect((await query('task-1', API_KEY)).state).toBe('pending');
    expect((await query('task-1', API_KEY)).state).toBe('unknown');
  });
});

describe('generateVideo', () => {
  it('全流程：提交 → 轮询（processing）→ 完成（succeed）取 URL', async () => {
    const fetchMock = stagedFetch([
      { code: 0, data: { task_id: 'task-123' } },
      { code: 0, data: { task_id: 'task-123', task_status: 'processing' } },
      {
        code: 0,
        data: {
          task_id: 'task-123',
          task_status: 'succeed',
          task_result: {
            videos: [
              {
                id: 'v1',
                url: 'https://v.klingai.com/video.mp4',
                duration: '10',
              },
            ],
          },
        },
      },
    ]);
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new KlingProvider(
      {},
      {
        baseIntervalMs: 5,
        maxIntervalMs: 10,
        maxPollMs: 5000,
        backoffFactor: 1,
      }
    );
    const result = await provider.generateVideo({
      model: 'kling-v1-6',
      prompt: '海边日出',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ url: 'https://v.klingai.com/video.mp4' }]);
    expect(result.model).toBe('kling-v1-6');
    expect(fetchMock.mock.calls).toHaveLength(3);
  });

  it('任务失败：返回失败结果与错误信息', async () => {
    const fetchMock = stagedFetch([
      { code: 0, data: { task_id: 'task-123' } },
      {
        code: 0,
        data: {
          task_id: 'task-123',
          task_status: 'failed',
          task_status_msg: '触发内容风控',
        },
      },
    ]);
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new KlingProvider(
      {},
      {
        baseIntervalMs: 5,
        maxIntervalMs: 10,
        maxPollMs: 5000,
        backoffFactor: 1,
      }
    );
    const result = await provider.generateVideo({
      model: 'kling-v1-6',
      prompt: 'x',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('触发内容风控');
  });

  it('未配置 API Key 时返回配置错误', async () => {
    const provider = new KlingProvider();
    const prev = process.env.KLING_API_KEY;
    delete process.env.KLING_API_KEY;
    try {
      const result = await provider.generateVideo({
        model: 'kling-v1-6',
        prompt: 'x',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('API Key 未配置');
    } finally {
      process.env.KLING_API_KEY = prev;
    }
  });
});
