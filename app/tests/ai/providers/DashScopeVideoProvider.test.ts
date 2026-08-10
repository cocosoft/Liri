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
 * DashScopeVideoProvider 单元测试（bun:test + mock global fetch）
 *
 * 覆盖：submitVideoTask 请求构建（文生/图生视频分支、鉴权头、X-DashScope-Async）、
 * queryVideoTask 状态归一化、extractVideoUrl 提取、generateVideo 全流程。
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
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VideoGenerationParams } from '../../../src/ai/providers/AIProvider';
import type { VideoTaskPollState } from '../../../src/ai/providers/AsyncVideoTaskProvider';
import { DashScopeVideoProvider } from '../../../src/ai/providers/DashScopeVideoProvider.js';

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
  tmpDir = await mkdtemp(join(tmpdir(), 'dashscope-video-test-'));
  process.env.LIRI_DATA_DIR = tmpDir;
  process.env.DASHSCOPE_API_KEY = 'test-key';
});

afterAll(async () => {
  delete process.env.DASHSCOPE_API_KEY;
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
function makeProvider(): DashScopeVideoProvider {
  return new DashScopeVideoProvider(
    {},
    { baseIntervalMs: 1, maxIntervalMs: 1, maxPollMs: 5000, backoffFactor: 1.1 }
  );
}

function lastCall(): FetchCall {
  return calls[calls.length - 1];
}

describe('DashScopeVideoProvider.submitVideoTask', () => {
  it('文生视频：端点/鉴权/X-DashScope-Async 头/请求体正确，返回 taskId', async () => {
    const provider = makeProvider();
    mockFetch(() =>
      jsonResponse({ output: { task_id: 'task-1', task_status: 'PENDING' } })
    );

    const params: VideoGenerationParams = {
      model: 'wanx2.1-t2v-turbo',
      prompt: '一只小猫在月光下奔跑',
      negativePrompt: '低分辨率',
      duration: 5,
      aspectRatio: '16:9',
      resolution: '720p',
      seed: 42,
    };
    const { taskId } = await (provider as any).submitVideoTask(
      params,
      'test-key'
    );

    expect(taskId).toBe('task-1');
    expect(calls).toHaveLength(1);
    expect(lastCall().url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis'
    );
    expect(lastCall().init?.method).toBe('POST');
    const headers = lastCall().init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe('Bearer test-key');
    expect(headers['X-DashScope-Async']).toBe('enable');

    const body = JSON.parse(lastCall().init?.body as string);
    expect(body.model).toBe('wanx2.1-t2v-turbo');
    expect(body.input.prompt).toBe('一只小猫在月光下奔跑');
    expect(body.input.negative_prompt).toBe('低分辨率');
    expect(body.input.img_url).toBeUndefined();
    expect(body.parameters.size).toBe('1280*720');
    expect(body.parameters.duration).toBe(5);
    expect(body.parameters.seed).toBe(42);
  });

  it('图生视频：imageUrl 映射到 input.img_url', async () => {
    const provider = makeProvider();
    mockFetch(() => jsonResponse({ output: { task_id: 'task-2' } }));

    const { taskId } = await (provider as any).submitVideoTask(
      {
        model: 'wanx2.1-i2v-turbo',
        prompt: '让画面中的猫咪动起来',
        imageUrl: 'https://example.com/first.png',
      },
      'test-key'
    );

    expect(taskId).toBe('task-2');
    const body = JSON.parse(lastCall().init?.body as string);
    expect(body.input.img_url).toBe('https://example.com/first.png');
  });

  it('图生视频：本地 imagePath 读取后转为 base64 Data URL', async () => {
    const provider = makeProvider();
    const imgPath = join(tmpDir, 'first.png');
    await writeFile(imgPath, Buffer.from('fake-png-bytes'));
    mockFetch(() => jsonResponse({ output: { task_id: 'task-3' } }));

    const { taskId } = await (provider as any).submitVideoTask(
      { model: 'wanx2.1-i2v-turbo', prompt: 'x', imagePath: imgPath },
      'test-key'
    );

    expect(taskId).toBe('task-3');
    const body = JSON.parse(lastCall().init?.body as string);
    expect(body.input.img_url).toBe(
      `data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`
    );
  });

  it('未配置模型时抛 AppError', async () => {
    const provider = makeProvider();
    await expect(
      (provider as any).submitVideoTask({ model: '', prompt: 'x' }, 'test-key')
    ).rejects.toThrow(/未指定模型/);
    expect(calls).toHaveLength(0);
  });
});

describe('DashScopeVideoProvider.queryVideoTask', () => {
  it('各状态归一化：PENDING→pending，RUNNING→running，SUCCEEDED→completed+url，FAILED→error，CANCELED→failed，UNKNOWN→unknown', async () => {
    const provider = makeProvider();
    const cases: Array<{ body: unknown; expected: VideoTaskPollState }> = [
      {
        body: { output: { task_status: 'PENDING' } },
        expected: { state: 'pending' },
      },
      {
        body: { output: { task_status: 'RUNNING' } },
        expected: { state: 'running' },
      },
      {
        body: {
          output: {
            task_status: 'SUCCEEDED',
            video_url:
              'https://dashscope-result.oss-accelerate.aliyuncs.com/v.mp4',
          },
        },
        expected: {
          state: 'completed',
          videoUrl:
            'https://dashscope-result.oss-accelerate.aliyuncs.com/v.mp4',
        },
      },
      {
        body: {
          output: {
            task_status: 'FAILED',
            code: 'InvalidParameter',
            message: '提示词包含违规内容',
          },
        },
        expected: { state: 'failed', error: '提示词包含违规内容' },
      },
      {
        // CANCELED 为终态，归一化为 failed（无 message 时带默认错误）
        body: { output: { task_status: 'CANCELED' } },
        expected: { state: 'failed', error: '生成失败' },
      },
      {
        body: { output: { task_status: 'UNKNOWN' } },
        expected: { state: 'unknown' },
      },
      {
        body: { output: { task_status: 'weird' } },
        expected: { state: 'unknown' },
      },
    ];

    for (const c of cases) {
      mockFetch(() => jsonResponse(c.body));
      const result = await (provider as any).queryVideoTask('t', 'test-key');
      expect(result).toEqual(c.expected);
    }
  });

  it('查询端点与鉴权头正确', async () => {
    const provider = makeProvider();
    mockFetch(() => jsonResponse({ output: { task_status: 'PENDING' } }));

    await (provider as any).queryVideoTask('task-9', 'test-key');

    expect(lastCall().url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/tasks/task-9'
    );
    expect(lastCall().init?.method).toBeUndefined();
    const headers = lastCall().init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key');
  });
});

describe('DashScopeVideoProvider.extractVideoUrl', () => {
  it('覆盖 output.video_url 直接与完整响应嵌套两种结构', () => {
    const provider = makeProvider();
    const cases: Array<[unknown, string]> = [
      [{ video_url: 'https://a.mp4' }, 'https://a.mp4'],
      [{ output: { video_url: 'https://b.mp4' } }, 'https://b.mp4'],
      [{ video_url: '' }, ''],
      [{}, ''],
      [null, ''],
      ['not-an-object', ''],
    ];

    for (const [input, expected] of cases) {
      expect((provider as any).extractVideoUrl(input)).toBe(expected);
    }
  });
});

describe('DashScopeVideoProvider.generateVideo 全流程', () => {
  it('提交→轮询（PENDING→RUNNING）→完成返回视频 URL', async () => {
    const provider = makeProvider();
    let queryCount = 0;
    mockFetch((url) => {
      if (url.includes('/services/aigc/video-generation/video-synthesis')) {
        return jsonResponse({
          output: { task_id: 'task-1', task_status: 'PENDING' },
        });
      }
      if (url.includes('/api/v1/tasks/task-1')) {
        queryCount++;
        if (queryCount === 1) {
          return jsonResponse({ output: { task_status: 'PENDING' } });
        }
        if (queryCount === 2) {
          return jsonResponse({ output: { task_status: 'RUNNING' } });
        }
        return jsonResponse({
          output: {
            task_status: 'SUCCEEDED',
            video_url:
              'https://dashscope-result.oss-accelerate.aliyuncs.com/task-1.mp4',
          },
        });
      }
      return jsonResponse({});
    });

    const result = await provider.generateVideo({
      model: 'wanx2.1-t2v-turbo',
      prompt: '一只小猫在花园里奔跑',
    });

    expect(result.success).toBe(true);
    expect(result.data[0].url).toBe(
      'https://dashscope-result.oss-accelerate.aliyuncs.com/task-1.mp4'
    );
    expect(result.model).toBe('wanx2.1-t2v-turbo');
    expect(queryCount).toBe(3);
    expect(calls[0].url).toContain(
      '/services/aigc/video-generation/video-synthesis'
    );
  });

  it('任务失败返回失败结果并携带错误信息', async () => {
    const provider = makeProvider();
    mockFetch((url) => {
      if (url.includes('/services/aigc/video-generation/video-synthesis')) {
        return jsonResponse({ output: { task_id: 't-fail' } });
      }
      return jsonResponse({
        output: { task_status: 'FAILED', message: '画面内容审核未通过' },
      });
    });

    const result = await provider.generateVideo({
      model: 'wanx2.1-t2v-turbo',
      prompt: 'x',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('画面内容审核未通过');
  });

  it('未配置 API Key 时返回未配置错误，不发请求', async () => {
    const provider = makeProvider();
    const saved = process.env.DASHSCOPE_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    try {
      const result = await provider.generateVideo({
        model: 'wanx2.1-t2v-turbo',
        prompt: 'x',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('未配置');
      expect(calls).toHaveLength(0);
    } finally {
      process.env.DASHSCOPE_API_KEY = saved;
    }
  });
});
