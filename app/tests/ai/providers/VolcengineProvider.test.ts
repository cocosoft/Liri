/**
 * VolcengineProvider 单元测试
 *
 * 覆盖：
 *  - submitVideoTask：请求 URL / 方法 / 鉴权头 / Body 结构
 *  - queryVideoTask：succeeded / failed / queued+running 状态归一化
 *  - generateVideo：提交 → 轮询 → 取视频 URL 全流程（mock global fetch）
 *
 * 路径隔离：通过 LIRI_DATA_DIR 指向临时目录，不污染真实数据目录。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { VolcengineProvider } from '../../../src/ai/providers/VolcengineProvider.js';
import type { VideoGenerationParams } from '../../../src/ai/providers/AIProvider.js';
import type { VideoTaskPollState } from '../../../src/ai/providers/AsyncVideoTaskProvider.js';

const BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const API_KEY = 'test-ark-key';

const PARAMS: VideoGenerationParams = {
  model: 'doubao-seedance-1-0-pro-250528',
  prompt: '一只柯基在草地上奔跑，慢镜头',
};

/** 构造最小可用的 mock Response */
function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

/** 暴露 protected 方法供测试调用（避免 any） */
function testable(provider: VolcengineProvider) {
  return provider as unknown as {
    submitVideoTask(
      params: VideoGenerationParams,
      apiKey: string
    ): Promise<{ taskId: string }>;
    queryVideoTask(taskId: string, apiKey: string): Promise<VideoTaskPollState>;
  };
}

describe('VolcengineProvider', () => {
  let tmpDir: string;
  let provider: VolcengineProvider;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'volcengine-test-'));
    process.env.LIRI_DATA_DIR = tmpDir;
    process.env.VOLCENGINE_API_KEY = API_KEY;
    // 轮询间隔覆盖为极小值，加速测试
    provider = new VolcengineProvider({
      baseIntervalMs: 5,
      maxIntervalMs: 5,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.LIRI_DATA_DIR;
    delete process.env.VOLCENGINE_API_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── submitVideoTask ──

  it('submitVideoTask 请求 URL/方法/鉴权头/Body 正确', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      calls.push([String(url), init]);
      return jsonResponse({ id: 'cgt-2025-0001' });
    }) as typeof fetch;

    const { taskId } = await testable(provider).submitVideoTask(
      PARAMS,
      API_KEY
    );

    expect(taskId).toBe('cgt-2025-0001');
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe(`${BASE_URL}/contents/generations/tasks`);
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.model).toBe(PARAMS.model);
    expect(body.content).toEqual([{ type: 'text', text: PARAMS.prompt }]);
  });

  it('submitVideoTask 携带图生视频 image_url 与可选参数', async () => {
    let captured = '';
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      captured = String(init?.body);
      return jsonResponse({ id: 'cgt-2025-0002' });
    }) as typeof fetch;

    await testable(provider).submitVideoTask(
      {
        ...PARAMS,
        imageUrl: 'https://example.com/first-frame.png',
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720p',
        seed: 42,
      },
      API_KEY
    );

    const body = JSON.parse(captured) as Record<string, unknown>;
    expect(body.content).toEqual([
      { type: 'text', text: PARAMS.prompt },
      {
        type: 'image_url',
        image_url: { url: 'https://example.com/first-frame.png' },
      },
    ]);
    expect(body.duration).toBe(5);
    expect(body.ratio).toBe('16:9');
    expect(body.resolution).toBe('720p');
    expect(body.seed).toBe(42);
  });

  // ── queryVideoTask ──

  it('queryVideoTask 归一化 succeeded → completed + videoUrl', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        id: 'cgt-2025-0001',
        status: 'succeeded',
        content: { video_url: 'https://tos-cn-beijing.volces.com/out.mp4' },
      })) as typeof fetch;

    const state = await testable(provider).queryVideoTask(
      'cgt-2025-0001',
      API_KEY
    );
    expect(state.state).toBe('completed');
    expect(state.videoUrl).toBe('https://tos-cn-beijing.volces.com/out.mp4');
  });

  it('queryVideoTask 归一化 failed → failed + error message', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        id: 'cgt-2025-0001',
        status: 'failed',
        error: { code: 'InvalidParameter', message: '提示词不符合要求' },
      })) as typeof fetch;

    const state = await testable(provider).queryVideoTask(
      'cgt-2025-0001',
      API_KEY
    );
    expect(state.state).toBe('failed');
    expect(state.error).toBe('提示词不符合要求');
  });

  it('queryVideoTask 归一化 queued/running → running', async () => {
    let call = 0;
    globalThis.fetch = (async () => {
      call++;
      return jsonResponse({
        id: 'cgt-2025-0001',
        status: call === 1 ? 'queued' : 'running',
      });
    }) as typeof fetch;

    const first = await testable(provider).queryVideoTask(
      'cgt-2025-0001',
      API_KEY
    );
    const second = await testable(provider).queryVideoTask(
      'cgt-2025-0001',
      API_KEY
    );
    expect(first.state).toBe('running');
    expect(second.state).toBe('running');
  });

  // ── generateVideo ──

  it('generateVideo 全流程：提交 → 轮询 running → succeeded 取 URL', async () => {
    let queryCount = 0;
    globalThis.fetch = (async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/contents/generations/tasks')) {
        return jsonResponse({ id: 'cgt-2025-0001' });
      }
      queryCount++;
      if (queryCount === 1) {
        return jsonResponse({ id: 'cgt-2025-0001', status: 'running' });
      }
      return jsonResponse({
        id: 'cgt-2025-0001',
        status: 'succeeded',
        content: { video_url: 'https://tos-cn-beijing.volces.com/out.mp4' },
      });
    }) as typeof fetch;

    const result = await provider.generateVideo(PARAMS);
    expect(result.success).toBe(true);
    expect(result.data[0].url).toBe(
      'https://tos-cn-beijing.volces.com/out.mp4'
    );
    expect(queryCount).toBeGreaterThanOrEqual(2);
  });

  it('generateVideo 任务失败时返回失败结果', async () => {
    globalThis.fetch = (async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/contents/generations/tasks')) {
        return jsonResponse({ id: 'cgt-2025-0001' });
      }
      return jsonResponse({
        id: 'cgt-2025-0001',
        status: 'failed',
        error: { code: 'ContentFilter', message: '视频生成被安全策略拒绝' },
      });
    }) as typeof fetch;

    const result = await provider.generateVideo(PARAMS);
    expect(result.success).toBe(false);
    expect(result.error).toContain('视频生成被安全策略拒绝');
  });

  it('generateVideo 未配置 API Key 时返回未配置错误', async () => {
    delete process.env.VOLCENGINE_API_KEY;
    const result = await provider.generateVideo(PARAMS);
    expect(result.success).toBe(false);
    expect(result.error).toContain('API Key');
  });
});
