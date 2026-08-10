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
 * ViduProvider 单元测试（bun:test + mock global fetch）
 *
 * 覆盖：submitVideoTask 请求构建、queryVideoTask 状态归一化、
 * extractVideoUrl 多重路径提取、generateVideo 全流程。
 * 通过 LIRI_DATA_DIR 指向临时目录隔离数据路径，轮询间隔覆盖为小值。
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VideoGenerationParams } from '../../../src/ai/providers/AIProvider';
import type { VideoTaskPollState } from '../../../src/ai/providers/AsyncVideoTaskProvider';
import { ViduProvider } from '../../../src/ai/providers/ViduProvider.js';

/** 快速生成 JSON Response */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 记录一次 fetch 调用 */
interface FetchCall {
  url: string;
  init?: RequestInit;
}

let tmpDir = '';
let calls: FetchCall[] = [];

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'vidu-test-'));
  process.env.LIRI_DATA_DIR = tmpDir;
  process.env.VIDU_API_KEY = 'test-key';
});

afterAll(async () => {
  delete process.env.VIDU_API_KEY;
  delete process.env.LIRI_DATA_DIR;
  await rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = undefined as unknown as typeof fetch;
});

/** 设置 fetch mock：自动记录调用，测试通过 handler 定制响应 */
function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
}

/** 轮询间隔覆盖为小值，加速测试 */
function makeProvider(): ViduProvider {
  return new ViduProvider(
    {},
    { baseIntervalMs: 1, maxIntervalMs: 1, maxPollMs: 5000, backoffFactor: 1.1 }
  );
}

function lastCall(): FetchCall {
  return calls[calls.length - 1];
}

describe('ViduProvider.submitVideoTask', () => {
  it('文生视频：请求端点/鉴权/参数正确，返回 taskId', async () => {
    const provider = makeProvider();
    mockFetch(() => jsonResponse({ task_id: 'task-1', state: 'created' }));

    const params: VideoGenerationParams = {
      model: 'viduq3-pro',
      prompt: '一只小猫在花园里追逐蝴蝶',
      duration: 5,
      aspectRatio: '16:9',
      resolution: '720p',
      seed: 42,
      style: 'anime',
    };
    const { taskId } = await (provider as any).submitVideoTask(
      params,
      'test-key'
    );

    expect(taskId).toBe('task-1');
    expect(calls).toHaveLength(1);
    expect(lastCall().url).toBe('https://api.vidu.cn/ent/v2/text2video');
    expect(lastCall().init?.method).toBe('POST');
    expect(
      (lastCall().init?.headers as Record<string, string>)['Content-Type']
    ).toBe('application/json');
    expect(
      (lastCall().init?.headers as Record<string, string>)['Authorization']
    ).toBe('Token test-key');

    const body = JSON.parse(lastCall().init?.body as string);
    expect(body.model).toBe('viduq3-pro');
    expect(body.prompt).toBe('一只小猫在花园里追逐蝴蝶');
    expect(body.duration).toBe(5);
    expect(body.aspect_ratio).toBe('16:9');
    expect(body.resolution).toBe('720p');
    expect(body.seed).toBe(42);
    expect(body.style).toBe('anime');
    expect(body.images).toBeUndefined();
  });

  it('图生视频：imageUrl 走 img2video 且 images=[url]', async () => {
    const provider = makeProvider();
    mockFetch(() => jsonResponse({ task_id: 'task-2' }));

    const { taskId } = await (provider as any).submitVideoTask(
      {
        model: 'viduq3-pro',
        prompt: '让画面中的猫咪动起来',
        imageUrl: 'https://example.com/first.png',
      },
      'test-key'
    );

    expect(taskId).toBe('task-2');
    expect(lastCall().url).toBe('https://api.vidu.cn/ent/v2/img2video');
    const body = JSON.parse(lastCall().init?.body as string);
    expect(body.images).toEqual(['https://example.com/first.png']);
  });

  it('任务 ID 支持网关包裹结构 data.task_id', async () => {
    const provider = makeProvider();
    mockFetch(() =>
      jsonResponse({ code: 'success', data: { task_id: 'task-3' } })
    );

    const { taskId } = await (provider as any).submitVideoTask(
      { model: 'viduq3-pro', prompt: 'x' },
      'test-key'
    );
    expect(taskId).toBe('task-3');
  });

  it('未配置模型时抛 AppError', async () => {
    const provider = makeProvider();
    await expect(
      (provider as any).submitVideoTask({ model: '', prompt: 'x' }, 'test-key')
    ).rejects.toThrow(/未指定模型/);
    expect(calls).toHaveLength(0);
  });
});

describe('ViduProvider.queryVideoTask', () => {
  it('各状态归一化：created/queueing→pending，processing→running，success→completed+url，failed→error，未知→unknown', async () => {
    const provider = makeProvider();
    const cases: Array<{
      body: unknown;
      expected: VideoTaskPollState;
    }> = [
      { body: { id: 't', state: 'created' }, expected: { state: 'pending' } },
      { body: { id: 't', state: 'queueing' }, expected: { state: 'pending' } },
      {
        body: { id: 't', state: 'processing' },
        expected: { state: 'running' },
      },
      {
        body: {
          id: 't',
          state: 'success',
          creations: [{ id: 'c1', url: 'https://cdn.vidu.cn/v.mp4' }],
        },
        expected: {
          state: 'completed',
          videoUrl: 'https://cdn.vidu.cn/v.mp4',
        },
      },
      {
        body: { id: 't', state: 'failed', err_code: 'content_policy' },
        expected: { state: 'failed', error: 'content_policy' },
      },
      {
        body: { id: 't', state: 'weird' },
        expected: { state: 'unknown' },
      },
    ];

    for (const c of cases) {
      mockFetch(() => jsonResponse(c.body));
      const result = await (provider as any).queryVideoTask('t', 'test-key');
      expect(result).toEqual(c.expected);
    }
  });

  it('状态为 success 但无 URL 时返回 completed 且 videoUrl 为空', async () => {
    const provider = makeProvider();
    mockFetch(() => jsonResponse({ id: 't', state: 'success', creations: [] }));

    const result = await (provider as any).queryVideoTask('t', 'test-key');
    expect(result.state).toBe('completed');
    expect(result.videoUrl).toBe('');
  });
});

describe('ViduProvider.extractVideoUrl 多重路径提取', () => {
  it('覆盖 creations/data/数组/顶层字段等多种结构', () => {
    const provider = makeProvider();
    const cases: Array<[unknown, string]> = [
      [{ creations: [{ url: 'https://a.mp4' }] }, 'https://a.mp4'],
      [{ data: { creations: [{ url: 'https://b.mp4' }] } }, 'https://b.mp4'],
      [{ data: [{ url: 'https://c.mp4' }] }, 'https://c.mp4'],
      [{ data: { url: 'https://d.mp4' } }, 'https://d.mp4'],
      [{ url: 'https://e.mp4' }, 'https://e.mp4'],
      [{ video_url: 'https://f.mp4' }, 'https://f.mp4'],
      [{ videoUrl: 'https://g.mp4' }, 'https://g.mp4'],
      [{ creations: [{ watermarked_url: 'https://h.mp4' }] }, 'https://h.mp4'],
      [{}, ''],
      [null, ''],
      ['not-an-object', ''],
    ];

    for (const [input, expected] of cases) {
      expect((provider as any).extractVideoUrl(input)).toBe(expected);
    }
  });
});

describe('ViduProvider.generateVideo 全流程', () => {
  it('提交→轮询（processing）→完成返回视频 URL', async () => {
    const provider = makeProvider();
    let queryCount = 0;
    mockFetch((url) => {
      if (url.includes('/ent/v2/text2video')) {
        return jsonResponse({ task_id: 'task-1', state: 'created' });
      }
      if (url.includes('/ent/v2/tasks/task-1/creations')) {
        queryCount++;
        if (queryCount === 1) {
          return jsonResponse({ id: 'task-1', state: 'processing' });
        }
        return jsonResponse({
          id: 'task-1',
          state: 'success',
          creations: [
            {
              id: 'c1',
              url: 'https://cdn.vidu.cn/videos/task-1.mp4',
              cover_url: 'https://cdn.vidu.cn/covers/1.jpg',
            },
          ],
        });
      }
      return jsonResponse({});
    });

    const result = await provider.generateVideo({
      model: 'viduq3-pro',
      prompt: '一只小猫在花园里奔跑',
    });

    expect(result.success).toBe(true);
    expect(result.data[0].url).toBe('https://cdn.vidu.cn/videos/task-1.mp4');
    expect(result.model).toBe('viduq3-pro');
    expect(queryCount).toBe(2);
    expect(calls[0].url).toBe('https://api.vidu.cn/ent/v2/text2video');
  });

  it('任务失败返回失败结果并携带错误码', async () => {
    const provider = makeProvider();
    mockFetch((url) => {
      if (url.includes('/ent/v2/text2video')) {
        return jsonResponse({ task_id: 't-fail' });
      }
      return jsonResponse({
        id: 't-fail',
        state: 'failed',
        err_code: 'generation_error',
      });
    });

    const result = await provider.generateVideo({
      model: 'viduq3-pro',
      prompt: 'x',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('generation_error');
  });

  it('未配置 API Key 时返回未配置错误，不发请求', async () => {
    const provider = makeProvider();
    const saved = process.env.VIDU_API_KEY;
    delete process.env.VIDU_API_KEY;
    try {
      const result = await provider.generateVideo({
        model: 'viduq3-pro',
        prompt: 'x',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('未配置');
      expect(calls).toHaveLength(0);
    } finally {
      process.env.VIDU_API_KEY = saved;
    }
  });
});
