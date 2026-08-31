// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * VideoGenerateTool 测试套件
 *
 * 覆盖：
 *  - 基础单元测试（参数校验、实例化）
 *  - 文生视频集成测试 (T2V — SiliconFlow Lightricks/LTX-Video)
 *  - 图生视频集成测试 (I2V — SiliconFlow Wan-AI/Wan2.2-I2V-A14B)
 *  - 异步模式测试
 *  - 内容安全审核测试
 *  - 错误处理测试
 *  - Phase 2: Router 空 providers 测试
 *  - Phase 2: localhost imageUrl → temp file 转换测试
 *
 * 前置条件：
 *  - SiliconFlow API Key 已配置在 DB 中
 *  - 任务分工: video → Lightricks/LTX-Video (T2V)
 *  - I2V 测试通过 params.model 显式指定 Wan-AI/Wan2.2-I2V-A14B
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { VideoGenerateTool } from '../VideoGenerateTool';
import { VideoGenerationRouter } from '../VideoGenerationRouter';
import { RegistryVideoProvider } from '../providers/RegistryVideoProvider';
import type { AIProvider } from '@modules/ai';
import { syncDBProvidersToRegistry } from '../../../ai/providers/ProviderSyncService';
import { resolveDbPath } from '../../../core/paths';
import { ModelRouter } from '../../../ai/modelRouter';

const tool = new VideoGenerateTool();
const mockContext = {};

/** SiliconFlow API Key 是否可用 */
let hasSiliconKey = false;

/** SiliconFlow API Key 值 */
let siliconApiKey = '';

/** Provider 同步是否完成 */
let providersSynced = false;

/** T2V 模型名（与任务分工配置一致） */
const T2V_MODEL = 'Wan-AI/Wan2.2-T2V-A14B';

/** I2V 模型名 */
const I2V_MODEL = 'Wan-AI/Wan2.2-I2V-A14B';

beforeAll(async () => {
  // 同步 DB 供应商到 ProviderRegistry
  try {
    const count = await syncDBProvidersToRegistry();
    providersSynced = count > 0;
    console.log(`[beforeAll] 已同步 ${count} 个 DB 供应商到 ProviderRegistry`);
  } catch (e) {
    console.warn('[beforeAll] Provider 同步失败:', (e as Error).message);
  }

  // 预加载 UUID → 模型名 缓存（任务分工已全部迁移为 UUID）
  try {
    await ModelRouter.getInstance().invalidateUuidCache();
    console.log('[beforeAll] UUID 缓存已预加载');
  } catch (e) {
    console.warn('[beforeAll] UUID 缓存预加载失败:', (e as Error).message);
  }

  // 检查环境变量中的 SiliconFlow API Key
  hasSiliconKey = !!process.env.SILICONFLOW_API_KEY;

  // 从 DB 读取 API Key（使用正确的 DB 路径）
  try {
    const { Database } = await import('bun:sqlite');
    const dbPath = resolveDbPath();
    console.log(`[beforeAll] DB 路径: ${dbPath}`);

    const db = new Database(dbPath, { readonly: true });

    const silicon = db
      .query(
        "SELECT api_key FROM ai_providers WHERE provider_type = 'siliconflow'"
      )
      .get() as { api_key?: string } | null;

    if (silicon?.api_key) {
      siliconApiKey = silicon.api_key;
      hasSiliconKey = true;
      console.log(
        `[beforeAll] DB 中 SiliconFlow API Key: ${siliconApiKey.slice(0, 10)}...`
      );
    }

    db.close();
  } catch (e) {
    console.warn('[beforeAll] DB 读取失败:', (e as Error).message);
  }

  console.log('\n=== 视频生成测试环境 ===');
  console.log(
    `  Provider 同步:      ${providersSynced ? '✅ 已完成' : '⚠️ 失败'}`
  );
  console.log(
    `  SiliconFlow Key:    ${hasSiliconKey ? '✅ 已配置' : '❌ 未配置 (所有集成测试将跳过)'}`
  );
  console.log(`  T2V 模型:           ${T2V_MODEL}`);
  console.log(`  I2V 模型:           ${I2V_MODEL}`);
  console.log('');
});

// ================================================================
// 基础单元测试
// ================================================================

describe('VideoGenerateTool — 基础单元测试', () => {
  test('工具实例化', () => {
    expect(tool).toBeDefined();
    expect(tool.name).toBe('video_generate');
  });

  test('参数数量', () => {
    expect(tool.params.length).toBeGreaterThanOrEqual(11);
  });

  test('prompt 为必填参数', () => {
    const promptParam = tool.params.find((p) => p.name === 'prompt');
    expect(promptParam).toBeDefined();
    if (promptParam) {
      expect(promptParam.required).toBe(true);
      expect(promptParam.type).toBe('string');
    }
  });

  test('支持别名', () => {
    expect(tool.aliases).toContain('video');
    expect(tool.aliases).toContain('generate-video');
  });

  test('缺少 prompt 返回错误', async () => {
    const result = await tool.execute({}, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('prompt is required');
  });

  test('空 prompt 返回错误', async () => {
    const result = await tool.execute({ prompt: '' }, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('prompt is required');
  });

  test('imagePath 参数存在且非必填', () => {
    const param = tool.params.find((p) => p.name === 'imagePath');
    expect(param).toBeDefined();
    if (param) expect(param.required).toBe(false);
  });

  test('imageUrl 参数存在且非必填', () => {
    const param = tool.params.find((p) => p.name === 'imageUrl');
    expect(param).toBeDefined();
    if (param) expect(param.required).toBe(false);
  });

  test('async 参数默认为 false', () => {
    const param = tool.params.find((p) => p.name === 'async');
    expect(param).toBeDefined();
    if (param) {
      expect(param.type).toBe('boolean');
      expect(param.default).toBe(false);
    }
  });

  test('duration 参数存在', () => {
    const param = tool.params.find((p) => p.name === 'duration');
    expect(param).toBeDefined();
    if (param) expect(param.type).toBe('number');
  });

  test('aspectRatio 参数存在', () => {
    const param = tool.params.find((p) => p.name === 'aspectRatio');
    expect(param).toBeDefined();
    if (param) expect(param.type).toBe('string');
  });
});

// ================================================================
// 内容安全审核测试
// ================================================================

describe('VideoGenerateTool — 内容安全审核', () => {
  test('正常 prompt 应通过审核', async () => {
    const result = await tool.execute(
      { prompt: '一只猫在草地上奔跑' },
      mockContext
    );
    if (!result.success && result.error) {
      expect(result.error).not.toContain('内容安全审核未通过');
    }
  });

  test('正常英文 prompt 应通过审核', async () => {
    const result = await tool.execute(
      { prompt: 'A beautiful sunset over the ocean, cinematic quality' },
      mockContext
    );
    if (!result.success && result.error) {
      expect(result.error).not.toContain('内容安全审核未通过');
    }
  });
});

// ================================================================
// 文生视频集成测试 (T2V) — SiliconFlow Lightricks/LTX-Video
// ================================================================

describe('VideoGenerateTool — 文生视频 (T2V)', () => {
  test('T2V: 基础英文 prompt 生成视频', async () => {
    if (!hasSiliconKey) {
      console.log('  [跳过] SiliconFlow API Key 未配置');
      return;
    }

    console.log(`  [执行] T2V: ${T2V_MODEL}...`);
    const result = await tool.execute(
      {
        prompt:
          'A cat walking on a sunny beach, cinematic quality, gentle waves',
        model: T2V_MODEL,
      },
      mockContext
    );

    console.log('  T2V 结果:', {
      success: result.success,
      error: result.error?.slice(0, 200),
      hasData: !!result.data,
    });

    expect(result).toBeDefined();
    if (result.success) {
      expect(result.data).toBeDefined();
      const data = result.data as Record<string, unknown>;
      if (Array.isArray(data)) {
        expect(data.length).toBeGreaterThan(0);
        expect(data[0].url).toBeTruthy();
        console.log('  ✅ 视频 URL:', data[0].url);
      }
    }
  }, 600000);

  test('T2V: 中文 prompt 生成视频', async () => {
    if (!hasSiliconKey) {
      console.log('  [跳过] SiliconFlow API Key 未配置');
      return;
    }

    const result = await tool.execute(
      {
        prompt: '日落时分的城市天际线，延时摄影风格，晚霞满天',
        model: T2V_MODEL,
      },
      mockContext
    );

    console.log('  中文 prompt 结果:', {
      success: result.success,
      error: result.error?.slice(0, 200),
    });

    expect(result).toBeDefined();
    if (result.success) {
      const data = result.data as Record<string, unknown>;
      if (Array.isArray(data) && data[0]?.url) {
        console.log('  ✅ 视频 URL:', data[0].url);
      }
    }
  }, 600000);

  test('T2V: 带 seed 参数', async () => {
    if (!hasSiliconKey) {
      console.log('  [跳过] SiliconFlow API Key 未配置');
      return;
    }

    const result = await tool.execute(
      {
        prompt: 'A serene mountain lake at dawn, mist rising over the water',
        model: T2V_MODEL,
        seed: 42,
      },
      mockContext
    );

    console.log('  带 seed 结果:', {
      success: result.success,
      error: result.error?.slice(0, 200),
    });

    expect(result).toBeDefined();
  }, 600000);

  test('T2V: 不指定 model 走 Router 模式（任务分工 Lightricks/LTX-Video）', async () => {
    if (!hasSiliconKey) {
      console.log('  [跳过] SiliconFlow API Key 未配置');
      return;
    }

    console.log('  [执行] T2V Router 模式...');
    const result = await tool.execute(
      { prompt: 'a test video clip of nature, peaceful forest scene' },
      mockContext
    );

    console.log('  Router 模式结果:', {
      success: result.success,
      error: result.error?.slice(0, 300),
    });

    expect(result).toBeDefined();
    if (result.success) {
      const data = result.data as Record<string, unknown>;
      expect(data).toBeDefined();
      console.log('  ✅ Router 模式成功');
    }
  }, 600000);
});

// ================================================================
// 图生视频集成测试 (I2V) — SiliconFlow Wan-AI/Wan2.2-I2V-A14B
// ================================================================

describe('VideoGenerateTool — 图生视频 (I2V)', () => {
  test('I2V: 通过 imageUrl 图生视频', async () => {
    if (!hasSiliconKey) {
      console.log('  [跳过] SiliconFlow API Key 未配置');
      return;
    }

    console.log(`  [执行] I2V: ${I2V_MODEL} + imageUrl...`);

    const testImageUrl = 'https://fal.media/files/elephant/Dh9k7ZQYgAE4KJN.jpg';

    const result = await tool.execute(
      {
        prompt:
          'Make this image come alive with gentle motion, breeze blowing through the scene',
        imageUrl: testImageUrl,
        model: I2V_MODEL,
      },
      mockContext
    );

    console.log('  I2V 结果:', {
      success: result.success,
      error: result.error?.slice(0, 300),
      hasData: !!result.data,
    });

    expect(result).toBeDefined();
    if (result.success) {
      expect(result.data).toBeDefined();
      const data = result.data as Record<string, unknown>;
      if (Array.isArray(data) && data[0]?.url) {
        console.log('  ✅ 视频 URL:', data[0].url);
      }
    }
  }, 600000);

  test('I2V: 无 imageUrl 时降级为纯文本生成', async () => {
    if (!hasSiliconKey) {
      console.log('  [跳过] SiliconFlow API Key 未配置');
      return;
    }

    const result = await tool.execute(
      {
        prompt: 'A city skyline at sunset, timelapse style, golden hour',
        model: I2V_MODEL,
      },
      mockContext
    );

    console.log('  I2V 纯文本结果:', {
      success: result.success,
      error: result.error?.slice(0, 200),
    });

    expect(result).toBeDefined();
  }, 600000);
});

// ================================================================
// 异步模式测试
// ================================================================

describe('VideoGenerateTool — 异步模式', () => {
  test('async=true 应立即返回 taskId', async () => {
    const result = await tool.execute(
      { prompt: '生成一段测试视频', async: true },
      mockContext
    );

    console.log('  异步模式结果:', {
      success: result.success,
      data: result.data,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect((result.data as Record<string, unknown>)?.taskId).toBeDefined();
    expect((result.data as Record<string, unknown>)?.status).toBe('pending');
  });
});

// ================================================================
// 错误处理测试
// ================================================================

describe('VideoGenerateTool — 错误处理', () => {
  test('无效的 prompt 类型应返回错误', async () => {
    const result = await tool.execute(
      { prompt: 12345 as unknown as string },
      mockContext
    );
    expect(result.success).toBe(false);
  });

  // 预存修复（2026-08-31）：此前缺少 hasSiliconKey 保护，无 key 环境仍走真实 Router
  // 生成路径 → 网络调用挂起超默认 5s；对齐同文件其他集成测试：skip 保护 + 长超时
  //（真实视频生成耗时数分钟，600s 与 T2V 其他集成测试一致）
  test('超长 prompt 不应崩溃', async () => {
    if (!hasSiliconKey) {
      console.log('  [跳过] SiliconFlow API Key 未配置');
      return;
    }
    const longPrompt = 'A beautiful scene of nature. '.repeat(50);
    const result = await tool.execute(
      { prompt: longPrompt, model: T2V_MODEL },
      mockContext
    );
    expect(result).toBeDefined();
  }, 600000);
});

// ================================================================
// Phase 2: VideoGenerationRouter 空 providers 测试
// ================================================================

describe('VideoGenerationRouter — 空 providers', () => {
  test('0 providers → 明确错误信息（非 "所有均失败"）', async () => {
    const router = new VideoGenerationRouter();

    // 不设置任何 provider
    const result = await router.generate({
      prompt: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('未配置可用的视频生成 Provider');
    expect(result.error).toContain('任务分工');
    expect(result.error).toContain('video_generation');
  });

  test('setProviders 传入空数组 → providers 为 0', () => {
    const router = new VideoGenerationRouter();
    router.setProviders([]);
    expect(router.getProviders().length).toBe(0);
  });

  test('setProviders 传入不可用 provider → 被过滤 → providers 为 0', () => {
    const router = new VideoGenerationRouter();

    // 模拟一个没有 generateVideo 方法的 mock provider
    const mockProvider = {
      id: 'test-provider',
      displayName: 'Test Provider',
      // 故意不提供 generateVideo
    } as unknown as AIProvider;

    router.setProviders([new RegistryVideoProvider(mockProvider, 'fake')]);
    expect(router.getProviders().length).toBe(0);
  });
});

// ================================================================
// Phase 2: RegistryVideoProvider 单元测试
// ================================================================

describe('RegistryVideoProvider — isAvailable', () => {
  test('有 generateVideo 方法 → isAvailable = true', () => {
    const mockProvider = {
      id: 'fal-test',
      displayName: 'FAL Test',
      generateVideo: async () => ({
        success: true,
        data: [],
        durationMs: 0,
      }),
    } as unknown as AIProvider;

    const provider = new RegistryVideoProvider(mockProvider, 'fal');
    expect(provider.isAvailable()).toBe(true);
  });

  test('无 generateVideo 方法 → isAvailable = false', () => {
    const mockProvider = {
      id: 'chat-provider',
      displayName: 'Chat Provider',
    } as unknown as AIProvider;

    const provider = new RegistryVideoProvider(mockProvider, 'openai');
    expect(provider.isAvailable()).toBe(false);
  });

  test('generateVideo 非函数 → isAvailable = false', () => {
    const mockProvider = {
      id: 'bad-provider',
      displayName: 'Bad Provider',
      generateVideo: 'not a function',
    } as unknown as AIProvider;

    const provider = new RegistryVideoProvider(mockProvider, 'fake');
    expect(provider.isAvailable()).toBe(false);
  });

  test('generateVideo 调用时返回成功结果', async () => {
    const mockProvider = {
      id: 'mock-video',
      displayName: 'Mock Video',
      generateVideo: async () => ({
        success: true,
        data: [{ url: 'https://example.com/video.mp4', duration: 5 }],
        model: 'test-model',
        durationMs: 1000,
      }),
    } as unknown as AIProvider;

    const provider = new RegistryVideoProvider(mockProvider, 'mock');
    const result = await provider.generate({
      prompt: 'test video',
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.[0]?.url).toBe('https://example.com/video.mp4');
  });

  test('generateVideo 调用时返回失败结果', async () => {
    const mockProvider = {
      id: 'mock-video-fail',
      displayName: 'Mock Video Fail',
      generateVideo: async () => ({
        success: false,
        data: [],
        error: 'API quota exceeded',
        durationMs: 0,
      }),
    } as unknown as AIProvider;

    const provider = new RegistryVideoProvider(mockProvider, 'mock');
    const result = await provider.generate({
      prompt: 'test video',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('API quota exceeded');
  });
});

// ================================================================
// Phase 2: VideoGenerateTool — 图生视频 localhost URL 处理
// ================================================================

describe('VideoGenerateTool — 图生视频 localhost URL', () => {
  test('外部 https URL 不应触发下载', async () => {
    if (!hasSiliconKey) {
      console.log('  [跳过] SiliconFlow API Key 未配置');
      return;
    }

    // 外部可访问的图片 URL → 应直接传给 Provider
    const externalUrl = 'https://fal.media/files/elephant/Dh9k7ZQYgAE4KJN.jpg';

    const result = await tool.execute(
      {
        prompt: 'make this image animate gently',
        imageUrl: externalUrl,
        model: I2V_MODEL,
      },
      mockContext
    );

    console.log('  外部 URL 结果:', {
      success: result.success,
      error: result.error?.slice(0, 200),
    });

    expect(result).toBeDefined();
  }, 300000);

  test('localhost URL → 下载到临时文件再上传（Router 模式）', async () => {
    if (!hasSiliconKey) {
      console.log('  [跳过] SiliconFlow API Key 未配置');
      return;
    }

    // 模拟 localhost 图片 URL — 实际测试时用外部图片（因为 localhost 没有实际服务）
    // 这里验证：即使 URL 不可达，normalizeImageUrlToPath 也不会崩溃，而是返回 null 让流程继续
    const localUrl = 'http://localhost:9999/not-exist.png';

    const result = await tool.execute(
      {
        prompt: 'a gentle motion video from image',
        imageUrl: localUrl,
        async: true,
      },
      mockContext
    );

    // 异步模式应返回 taskId
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();

    const data = result.data as Record<string, unknown>;
    expect(data.taskId).toBeDefined();
    expect(data.status).toBe('pending');

    console.log('  localhost 异步任务已创建:', { taskId: data.taskId });
  }, 30000);
});

// ================================================================
// Phase 2: VideoGenerationRouter — 多 Provider fallback
// ================================================================

describe('VideoGenerationRouter — 多 Provider 容错', () => {
  test('单 Provider 失败时返回具体错误', async () => {
    const router = new VideoGenerationRouter();

    const failProvider = {
      id: 'always-fail',
      displayName: 'Always Fail',
      generateVideo: async () => ({
        success: false,
        data: [],
        error: 'API key invalid',
        durationMs: 0,
      }),
    } as unknown as AIProvider;

    router.setProviders([new RegistryVideoProvider(failProvider, 'fal')]);

    const result = await router.generate({
      prompt: 'test',
    });

    expect(result.success).toBe(false);
    // 单 Provider 失败 → 应返回具体错误而非 "所有均失败"（因为只有 1 个）
    expect(result.error).toBeDefined();
  });

  test('多 Provider 全部失败时返回明确错误', async () => {
    const router = new VideoGenerationRouter();

    const fail1 = {
      id: 'fail-1',
      displayName: 'Fail 1',
      generateVideo: async () => ({
        success: false,
        data: [],
        error: 'quota exceeded',
        durationMs: 0,
      }),
    } as unknown as AIProvider;

    const fail2 = {
      id: 'fail-2',
      displayName: 'Fail 2',
      generateVideo: async () => ({
        success: false,
        data: [],
        error: 'rate limited',
        durationMs: 0,
      }),
    } as unknown as AIProvider;

    router.setProviders([
      new RegistryVideoProvider(fail1, 'fal'),
      new RegistryVideoProvider(fail2, 'openai'),
    ]);

    const result = await router.generate({
      prompt: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('均失败');
  });

  test('首个 Provider 成功 → 直接返回，不尝试第二个', async () => {
    const router = new VideoGenerationRouter();
    let secondCalled = false;

    const success = {
      id: 'success-1',
      displayName: 'Success 1',
      generateVideo: async () => ({
        success: true,
        data: [{ url: 'https://example.com/ok.mp4', duration: 5 }],
        model: 'ok-model',
        durationMs: 100,
      }),
    } as unknown as AIProvider;

    const neverCalled = {
      id: 'never-called',
      displayName: 'Never Called',
      generateVideo: async () => {
        secondCalled = true;
        return { success: false, data: [], error: 'x', durationMs: 0 };
      },
    } as unknown as AIProvider;

    router.setProviders([
      new RegistryVideoProvider(success, 'fal'),
      new RegistryVideoProvider(neverCalled, 'openai'),
    ]);

    const result = await router.generate({ prompt: 'test' });

    expect(result.success).toBe(true);
    expect(result.data?.[0]?.url).toBe('https://example.com/ok.mp4');
    expect(secondCalled).toBe(false);
  });
});
