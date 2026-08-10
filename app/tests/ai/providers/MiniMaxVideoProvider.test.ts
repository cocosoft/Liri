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
 * MiniMaxVideoProvider 单元测试（bun:test + mock global fetch）
 *
 * 覆盖：submitVideoTask 请求构建（文生/图生/业务错误码/GroupId 头）、
 * queryVideoTask 状态归一化（含 file_id → File API 换 download_url）、
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
import { MiniMaxVideoProvider } from '../../../src/ai/providers/MiniMaxVideoProvider.js';

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
  tmpDir = await mkdtemp(join(tmpdir(), 'minimax-video-test-'));
  process.env.LIRI_DATA_DIR = tmpDir;
  process.env.MINIMAX_API_KEY = 'test-key';
});

afterAll(async () => {
  delete process.env.MINIMAX_API_KEY;
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
function makeProvider(): MiniMaxVideoProvider {
  return new MiniMaxVideoProvider(
    {},
    { baseIntervalMs: 1, maxIntervalMs: 1, maxPollMs: 5000, backoffFactor: 1.1 }
  );
}

function lastCall(): FetchCall {
  return calls[calls.length - 1];
}

describe('MiniMaxVideoProvider.submitVideoTask', () => {
  it('文生视频：请求端点/鉴权/参数正确，返回 taskId', async () => {
    const provider = makeProvider();
    mockFetch(() =>
      jsonResponse({
        task_id: 'task-1',
        base_resp: { status_code: 0, status_msg: 'success' },
      })
    );

    const params: VideoGenerationParams = {
      model: 'MiniMax-Hailuo-02',
      prompt: '一只小猫在花园里追逐蝴蝶',
      duration: 6,
      resolution: '768P',
    };
    const { taskId } = await (provider as any).submitVideoTask(
      params,
      'test-key'
    );

    expect(taskId).toBe('task-1');
    expect(calls).toHaveLength(1);
    expect(lastCall().url).toBe('https://api.minimaxi.com/v1/video_generation');
    expect(lastCall().init?.method).toBe('POST');
    const headers = lastCall().init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe('Bearer test-key');
    expect(headers['GroupId']).toBeUndefined();

    const body = JSON.parse(lastCall().init?.body as string);
    expect(body.model).toBe('MiniMax-Hailuo-02');
    expect(body.prompt).toBe('一只小猫在花园里追逐蝴蝶');
    expect(body.duration).toBe(6);
    expect(body.resolution).toBe('768P');
    expect(body.first_frame_image).toBeUndefined();
  });

  it('图生视频：imageUrl 映射为 first_frame_image', async () => {
    const provider = makeProvider();
    mockFetch(() =>
      jsonResponse({
        task_id: 'task-2',
        base_resp: { status_code: 0, status_msg: 'success' },
      })
    );

    const { taskId } = await (provider as any).submitVideoTask(
      {
        model: 'I2V-01-Director',
        prompt: '让画面中的猫咪动起来',
        imageUrl: 'https://example.com/first.png',
      },
      'test-key'
    );

    expect(taskId).toBe('task-2');
    expect(lastCall().url).toBe('https://api.minimaxi.com/v1/video_generation');
    const body = JSON.parse(lastCall().init?.body as string);
    expect(body.first_frame_image).toBe('https://example.com/first.png');
  });

  it('任务 ID 支持网关包裹结构 data.task_id', async () => {
    const provider = makeProvider();
    mockFetch(() =>
      jsonResponse({ code: 'success', data: { task_id: 'task-3' } })
    );

    const { taskId } = await (provider as any).submitVideoTask(
      { model: 'MiniMax-Hailuo-02', prompt: 'x' },
      'test-key'
    );
    expect(taskId).toBe('task-3');
  });

  it('业务错误码非 0 时抛错并携带 status_msg', async () => {
    const provider = makeProvider();
    mockFetch(() =>
      jsonResponse({
        task_id: '',
        base_resp: { status_code: 1004, status_msg: '账号鉴权失败' },
      })
    );

    await expect(
      (provider as any).submitVideoTask(
        { model: 'MiniMax-Hailuo-02', prompt: 'x' },
        'test-key'
      )
    ).rejects.toThrow(/账号鉴权失败/);
  });

  it('配置 MINIMAX_GROUP_ID 时请求头附带 GroupId', async () => {
    process.env.MINIMAX_GROUP_ID = 'grp-123';
    try {
      const provider = makeProvider();
      mockFetch(() =>
        jsonResponse({
          task_id: 'task-1',
          base_resp: { status_code: 0, status_msg: 'success' },
        })
      );

      await (provider as any).submitVideoTask(
        { model: 'MiniMax-Hailuo-02', prompt: 'x' },
        'test-key'
      );
      const headers = lastCall().init?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-key');
      expect(headers['GroupId']).toBe('grp-123');
    } finally {
      delete process.env.MINIMAX_GROUP_ID;
    }
  });

  it('未配置模型时抛 AppError', async () => {
    const provider = makeProvider();
    await expect(
      (provider as any).submitVideoTask({ model: '', prompt: 'x' }, 'test-key')
    ).rejects.toThrow(/未指定模型/);
    expect(calls).toHaveLength(0);
  });
});

describe('MiniMaxVideoProvider.queryVideoTask', () => {
  it('各状态归一化：Preparing/Queueing→pending，Processing→running，Success→completed+url，Fail→failed+error，未知→unknown', async () => {
    const provider = makeProvider();
    const cases: Array<{
      body: unknown;
      expected: VideoTaskPollState;
    }> = [
      { body: { status: 'Preparing' }, expected: { state: 'pending' } },
      { body: { status: 'Queueing' }, expected: { state: 'pending' } },
      { body: { status: 'Processing' }, expected: { state: 'running' } },
      {
        body: {
          status: 'Success',
          video_url: 'https://cdn.minimaxi.com/v.mp4',
        },
        expected: {
          state: 'completed',
          videoUrl: 'https://cdn.minimaxi.com/v.mp4',
        },
      },
      {
        body: {
          status: 'Fail',
          base_resp: { status_code: 1026, status_msg: '生成视频涉及敏感内容' },
        },
        expected: { state: 'failed', error: '生成视频涉及敏感内容' },
      },
      { body: { status: 'Weird' }, expected: { state: 'unknown' } },
    ];

    for (const c of cases) {
      mockFetch(() => jsonResponse(c.body));
      const result = await (provider as any).queryVideoTask('t', 'test-key');
      expect(result).toEqual(c.expected);
    }
  });

  it('Success 且仅返回 file_id 时，调 File API 换取 download_url', async () => {
    const provider = makeProvider();
    mockFetch((url) => {
      if (url.includes('/files/retrieve')) {
        return jsonResponse({
          file: {
            file_id: 'file-1',
            download_url: 'https://cdn.minimaxi.com/file-1.mp4',
          },
        });
      }
      return jsonResponse({ status: 'Success', file_id: 'file-1' });
    });

    const result = await (provider as any).queryVideoTask('t', 'test-key');
    expect(result).toEqual({
      state: 'completed',
      videoUrl: 'https://cdn.minimaxi.com/file-1.mp4',
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('/files/retrieve?file_id=file-1');
  });

  it('Success 但既无 video_url 也无 file_id 时返回空 videoUrl', async () => {
    const provider = makeProvider();
    mockFetch(() => jsonResponse({ status: 'Success' }));

    const result = await (provider as any).queryVideoTask('t', 'test-key');
    expect(result).toEqual({ state: 'completed', videoUrl: '' });
    expect(calls).toHaveLength(1);
  });
});

describe('MiniMaxVideoProvider.extractVideoUrl 多重路径提取', () => {
  it('覆盖顶层字段/file 对象/data 嵌套/数组等多种结构', () => {
    const provider = makeProvider();
    const cases: Array<[unknown, string]> = [
      [{ video_url: 'https://a.mp4' }, 'https://a.mp4'],
      [{ videoUrl: 'https://b.mp4' }, 'https://b.mp4'],
      [{ url: 'https://c.mp4' }, 'https://c.mp4'],
      [{ file: { download_url: 'https://d.mp4' } }, 'https://d.mp4'],
      [{ data: { video_url: 'https://e.mp4' } }, 'https://e.mp4'],
      [{ data: [{ url: 'https://f.mp4' }] }, 'https://f.mp4'],
      [{ download_url: 'https://g.mp4' }, 'https://g.mp4'],
      [{ file: { file_id: 'f1' } }, ''],
      [{}, ''],
      [null, ''],
      ['not-an-object', ''],
    ];

    for (const [input, expected] of cases) {
      expect((provider as any).extractVideoUrl(input)).toBe(expected);
    }
  });
});

describe('MiniMaxVideoProvider.generateVideo 全流程', () => {
  it('提交→轮询（Processing）→查询直接返回 video_url 完成', async () => {
    const provider = makeProvider();
    let queryCount = 0;
    mockFetch((url) => {
      if (url.includes('/query/video_generation')) {
        queryCount++;
        if (queryCount === 1) {
          return jsonResponse({ status: 'Processing' });
        }
        return jsonResponse({
          status: 'Success',
          video_url: 'https://cdn.minimaxi.com/videos/task-1.mp4',
        });
      }
      if (url.endsWith('/video_generation')) {
        return jsonResponse({
          task_id: 'task-1',
          base_resp: { status_code: 0, status_msg: 'success' },
        });
      }
      return jsonResponse({});
    });

    const result = await provider.generateVideo({
      model: 'MiniMax-Hailuo-02',
      prompt: '一只小猫在花园里奔跑',
    });

    expect(result.success).toBe(true);
    expect(result.data[0].url).toBe(
      'https://cdn.minimaxi.com/videos/task-1.mp4'
    );
    expect(result.model).toBe('MiniMax-Hailuo-02');
    expect(queryCount).toBe(2);
    expect(calls[0].url).toBe('https://api.minimaxi.com/v1/video_generation');
  });

  it('提交→轮询→Success 返回 file_id→File API 换取 download_url', async () => {
    const provider = makeProvider();
    let queryCount = 0;
    mockFetch((url) => {
      if (url.includes('/query/video_generation')) {
        queryCount++;
        if (queryCount === 1) {
          return jsonResponse({ status: 'Processing' });
        }
        return jsonResponse({ status: 'Success', file_id: 'file-1' });
      }
      if (url.includes('/files/retrieve')) {
        return jsonResponse({
          file: { download_url: 'https://cdn.minimaxi.com/task-1.mp4' },
        });
      }
      if (url.endsWith('/video_generation')) {
        return jsonResponse({
          task_id: 'task-1',
          base_resp: { status_code: 0, status_msg: 'success' },
        });
      }
      return jsonResponse({});
    });

    const result = await provider.generateVideo({
      model: 'MiniMax-Hailuo-02',
      prompt: 'x',
    });

    expect(result.success).toBe(true);
    expect(result.data[0].url).toBe('https://cdn.minimaxi.com/task-1.mp4');
    expect(queryCount).toBe(2);
    expect(calls).toHaveLength(4);
    expect(calls[3].url).toContain('/files/retrieve?file_id=file-1');
  });

  it('任务失败返回失败结果并携带错误信息', async () => {
    const provider = makeProvider();
    mockFetch((url) => {
      if (url.endsWith('/video_generation')) {
        return jsonResponse({
          task_id: 't-fail',
          base_resp: { status_code: 0, status_msg: 'success' },
        });
      }
      return jsonResponse({
        status: 'Fail',
        base_resp: { status_code: 1027, status_msg: '生成视频涉及敏感内容' },
      });
    });

    const result = await provider.generateVideo({
      model: 'MiniMax-Hailuo-02',
      prompt: 'x',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('生成视频涉及敏感内容');
  });

  it('未配置 API Key 时返回未配置错误，不发请求', async () => {
    const provider = makeProvider();
    const saved = process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    try {
      const result = await provider.generateVideo({
        model: 'MiniMax-Hailuo-02',
        prompt: 'x',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('未配置');
      expect(calls).toHaveLength(0);
    } finally {
      process.env.MINIMAX_API_KEY = saved;
    }
  });
});
