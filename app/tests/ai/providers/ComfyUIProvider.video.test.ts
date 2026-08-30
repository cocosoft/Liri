/**
 * ComfyUIProvider.generateVideo 单元测试
 *
 * mock global fetch，覆盖：
 * - 文生视频全流程（服务可用 → 加载 text2video 工作流 → 参数化 → 提交 → 轮询提取 videos）
 * - 服务不可用
 * - 无视频输出时 images 帧兜底
 * - 参数化（prompt/seed/duration→帧数/尺寸）
 * - 图生视频（imagePath 上传 → image2video 工作流）
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { ComfyUIProvider } from '../../../src/ai/providers/ComfyUIProvider.js';

const BASE = 'http://127.0.0.1:8188';

function jsonRes(data: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status: ok ? status : status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface HistoryOut {
  completed: boolean;
  gifs?: unknown[];
  images?: unknown[];
}

type FetchCall = { url: string; init?: RequestInit };

let originalCwd = '';

function setupFetch(historySeq: HistoryOut[]): FetchCall[] {
  let historyIdx = 0;
  const calls: FetchCall[] = [];
  globalThis.fetch = mock((url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes('/system_stats')) {
      return Promise.resolve(jsonRes({}));
    }
    if (u.includes('/upload/image')) {
      return Promise.resolve(jsonRes({ name: 'uploaded.png' }));
    }
    if (u.endsWith('/prompt')) {
      return Promise.resolve(jsonRes({ prompt_id: 'test-prompt-1' }));
    }
    if (u.includes('/history/')) {
      const h = historySeq[Math.min(historyIdx, historySeq.length - 1)];
      historyIdx++;
      const outputs: Record<string, unknown> = {};
      if (h.completed) {
        const nodeOut: Record<string, unknown> = {};
        if (h.gifs) nodeOut.gifs = h.gifs;
        if (h.images) nodeOut.images = h.images;
        outputs['9'] = nodeOut;
      }
      return Promise.resolve(
        jsonRes({
          'test-prompt-1': { status: { completed: h.completed }, outputs },
        })
      );
    }
    return Promise.resolve(jsonRes({}, false, 404));
  }) as typeof fetch;
  return calls;
}

function provider(): ComfyUIProvider {
  return new ComfyUIProvider({
    providerId: 'comfy',
    displayName: 'ComfyUI',
    defaultBaseUrl: BASE,
  });
}

/** 从 /prompt 提交体中解析工作流 JSON */
function submittedWorkflow(calls: FetchCall[]): Record<string, unknown> {
  const promptCall = calls.find((c) => c.url.endsWith('/prompt'));
  const body = promptCall?.init?.body;
  const parsed = JSON.parse(String(body)) as {
    prompt: Record<string, unknown>;
  };
  return parsed.prompt;
}

beforeEach(() => {
  originalCwd = process.cwd();
  // loadWorkflow 用相对路径 ./comfy-workflows/，chdir 到 providers 目录使模板可加载
  process.chdir(join(originalCwd, 'src', 'ai', 'providers'));
});

afterEach(() => {
  process.chdir(originalCwd);
  delete (globalThis as { fetch?: unknown }).fetch;
});

describe('ComfyUIProvider.generateVideo（文生视频）', () => {
  it('全流程成功：提交 → 轮询 → 提取 mp4 视频 URL', async () => {
    const calls = setupFetch([
      { completed: false },
      {
        completed: true,
        gifs: [{ filename: 'out.mp4', subfolder: '', type: 'output' }],
      },
    ]);

    const result = await provider().generateVideo({
      model: 'comfyui-local',
      prompt: '一只猫在草地上奔跑',
    });

    expect(result.success).toBe(true);
    expect(result.data[0].url).toContain('/view?filename=out.mp4');
    // 参数化：prompt 已替换进工作流
    const wf = submittedWorkflow(calls);
    const textNodes = Object.values(wf)
      .map((n) => (n as { inputs?: { text?: string } }).inputs?.text)
      .filter((t): t is string => !!t);
    expect(textNodes).toContain('一只猫在草地上奔跑');
  });

  it('服务不可用时返回错误', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonRes({}, false, 500))
    ) as typeof fetch;

    const result = await provider().generateVideo({
      model: 'comfyui-local',
      prompt: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('服务不可用');
  });

  it('无视频输出时回退到图片帧', async () => {
    const calls = setupFetch([
      {
        completed: true,
        images: [{ filename: 'frame.png', subfolder: '', type: 'output' }],
      },
    ]);

    const result = await provider().generateVideo({
      model: 'comfyui-local',
      prompt: 'test',
    });

    expect(result.success).toBe(true);
    expect(result.data[0].url).toContain('/view?filename=frame.png');
    // videos 轮询与 images 轮询各发生一次
    const historyCalls = calls.filter((c) => c.url.includes('/history/'));
    expect(historyCalls.length).toBeGreaterThanOrEqual(2);
  }, 15000);

  it('参数化：seed/duration→帧数/尺寸 生效', async () => {
    const calls = setupFetch([
      {
        completed: true,
        gifs: [{ filename: 'out.mp4', subfolder: '', type: 'output' }],
      },
    ]);

    await provider().generateVideo({
      model: 'comfyui-local',
      prompt: 'test',
      seed: 12345,
      duration: 5,
      resolution: '720p',
      aspectRatio: '16:9',
    });

    const wf = submittedWorkflow(calls);
    const nodes = Object.values(wf) as Array<{
      class_type?: string;
      inputs?: Record<string, unknown>;
    }>;
    const sampler = nodes.find((n) => n.class_type === 'KSampler');
    expect(sampler?.inputs?.seed).toBe(12345);
    const latent = nodes.find((n) => n.class_type === 'EmptyLatentVideo');
    expect(latent?.inputs?.length).toBe(5 * 16); // duration × fps
    expect(latent?.inputs?.height).toBe(720);
  }, 10000);
});

describe('ComfyUIProvider.generateVideo（图生视频）', () => {
  it('imagePath 上传首帧并走 image2video 工作流', async () => {
    // 创建真实临时图片文件（uploadImage 用 Bun.file.exists 校验）
    const tmpFile = join(
      originalCwd,
      'tests',
      'ai',
      'providers',
      '.tmp-frame.png'
    );
    await (Bun as unknown as { write: (path: string, data: string) => Promise<number> }).write(tmpFile, 'fake-png-bytes');
    try {
      const calls = setupFetch([
        {
          completed: true,
          gifs: [{ filename: 'i2v.mp4', subfolder: '', type: 'output' }],
        },
      ]);

      const result = await provider().generateVideo({
        model: 'comfyui-local',
        prompt: '让图片中的花盛开',
        imagePath: tmpFile,
      });

      expect(result.success).toBe(true);
      // 触发 /upload/image 上传
      expect(calls.some((c) => c.url.includes('/upload/image'))).toBe(true);
      // 使用 image2video 工作流（含 LoadImage 节点）
      const wf = submittedWorkflow(calls);
      const hasLoadImage = Object.values(wf).some(
        (n) => (n as { class_type?: string }).class_type === 'LoadImage'
      );
      expect(hasLoadImage).toBe(true);
    } finally {
      await (Bun.file(tmpFile) as unknown as { delete: () => Promise<void> })
        .delete()
        .catch(() => {});
    }
  }, 15000);
});
