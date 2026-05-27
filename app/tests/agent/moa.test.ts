/**
 * MoA (Mixture of Agents) 单元测试
 * 覆盖 MoARouter、AggregatorPrompt
 */

import { describe, it, expect, beforeEach } from 'bun:test';

import { MoARouter } from '../../src/agent/moa/MoARouter.js';
import { buildAggregatorPrompt, AGGREGATOR_PROMPT_TEMPLATE } from '../../src/agent/moa/AggregatorPrompt.js';
import type { MoAModelAdapter, MoARequest } from '../../src/agent/moa/MoARouter.js';

/**
 * 模拟模型适配器
 */
function createMockAdapter(name: string, response: string): MoAModelAdapter {
  return {
    name,
    async query() {
      return response;
    },
  };
}

/**
 * 模拟模型适配器（带延迟）
 */
function createDelayedAdapter(name: string, response: string, delayMs: number = 10): MoAModelAdapter {
  return {
    name,
    async query() {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return response;
    },
  };
}

describe('MoARouter', () => {
  let router: MoARouter;

  beforeEach(() => {
    router = new MoARouter();
  });

  it('创建路由器实例', () => {
    expect(router).toBeDefined();
  });

  it('注册适配器', () => {
    router.registerAdapter('model-a', createMockAdapter('model-a', 'response A'));
    expect(router.getRegisteredModels()).toContain('model-a');
  });

  it('移除适配器', () => {
    router.registerAdapter('model-a', createMockAdapter('model-a', 'response A'));
    expect(router.getRegisteredModels().length).toBe(1);

    router.removeAdapter('model-a');
    expect(router.getRegisteredModels().length).toBe(0);
  });

  it('获取已注册模型列表', () => {
    router.registerAdapter('model-a', createMockAdapter('model-a', 'A'));
    router.registerAdapter('model-b', createMockAdapter('model-b', 'B'));
    router.registerAdapter('model-c', createMockAdapter('model-c', 'C'));

    const models = router.getRegisteredModels();
    expect(models).toContain('model-a');
    expect(models).toContain('model-b');
    expect(models).toContain('model-c');
    expect(models.length).toBe(3);
  });

  it('并行查询多个模型并聚合', async () => {
    router.registerAdapter('model-a', createMockAdapter('model-a', 'Response from A'));
    router.registerAdapter('model-b', createMockAdapter('model-b', 'Response from B'));
    router.registerAdapter('aggregator', createMockAdapter('aggregator', 'Aggregated result'));

    const request: MoARequest = {
      query: 'What is AI?',
      models: ['model-a', 'model-b'],
      aggregatorModel: 'aggregator',
    };

    const result = await router.route(request);

    expect(result.aggregated).toBe('Aggregated result');
    expect(result.individualResponses.length).toBe(2);
    expect(result.meta.modelsUsed).toBe(2);
    expect(result.meta.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('当模型无聚合器时使用第一个结果', async () => {
    router.registerAdapter('model-a', createMockAdapter('model-a', 'Solo response'));

    const request: MoARequest = {
      query: 'test',
      models: ['model-a'],
      aggregatorModel: 'nonexistent-aggregator',
    };

    const result = await router.route(request);
    expect(result.aggregated).toBe('Solo response');
  });

  it('当无可用的模型时返回错误消息', async () => {
    const request: MoARequest = {
      query: 'test',
      models: ['nonexistent-model'],
      aggregatorModel: 'also-nonexistent',
    };

    const result = await router.route(request);
    expect(result.aggregated).toBe('No models available to process the request.');
    expect(result.meta.modelsUsed).toBe(0);
  });

  it('某模型失败时不影响其他模型', async () => {
    router.registerAdapter('model-a', createMockAdapter('model-a', 'Good response'));
    router.registerAdapter('model-b', {
      name: 'model-b',
      async query() {
        throw new Error('Model B failure');
      },
    });
    router.registerAdapter('aggregator', createMockAdapter('aggregator', 'Aggregated'));

    const request: MoARequest = {
      query: 'test',
      models: ['model-a', 'model-b'],
      aggregatorModel: 'aggregator',
    };

    const result = await router.route(request);
    expect(result.individualResponses.length).toBe(2);
    expect(result.individualResponses[1].response).toContain('Error');
    expect(result.aggregated).toBe('Aggregated');
  });

  it('并行查询比串行更快', async () => {
    router.registerAdapter('slow-a', createDelayedAdapter('slow-a', 'A', 30));
    router.registerAdapter('slow-b', createDelayedAdapter('slow-b', 'B', 30));
    router.registerAdapter('aggregator', createDelayedAdapter('aggregator', 'Aggregated', 10));

    const request: MoARequest = {
      query: 'test',
      models: ['slow-a', 'slow-b'],
      aggregatorModel: 'aggregator',
    };

    const start = Date.now();
    await router.route(request);
    const elapsed = Date.now() - start;

    // 如果串行需要 ~70ms，并行只需 ~40ms（最长单个模型 + 聚合器）
    expect(elapsed).toBeLessThan(80);
  });

  it('自定义 systemPrompt 和 maxTokens 传递给模型适配器', async () => {
    const modelCalls: Array<{ systemPrompt?: string; maxTokens?: number }> = [];
    const aggregatorCalls: Array<{ systemPrompt?: string; maxTokens?: number }> = [];

    router.registerAdapter('test-model', {
      name: 'test-model',
      async query(_query, systemPrompt, maxTokens) {
        modelCalls.push({ systemPrompt, maxTokens });
        return 'response';
      },
    });

    router.registerAdapter('aggregator', {
      name: 'aggregator',
      async query(_query, systemPrompt, maxTokens) {
        aggregatorCalls.push({ systemPrompt, maxTokens });
        return 'aggregated';
      },
    });

    const request: MoARequest = {
      query: 'test',
      models: ['test-model'],
      aggregatorModel: 'aggregator',
      systemPrompt: 'Custom system prompt',
      maxTokens: 2048,
    };

    await router.route(request);

    // 模型适配器接收到自定义 systemPrompt 和 maxTokens
    expect(modelCalls.length).toBe(1);
    expect(modelCalls[0].systemPrompt).toBe('Custom system prompt');
    expect(modelCalls[0].maxTokens).toBe(2048);

    // 聚合器适配器只传递 maxTokens，systemPrompt 为 undefined
    expect(aggregatorCalls.length).toBe(1);
    expect(aggregatorCalls[0].systemPrompt).toBeUndefined();
    expect(aggregatorCalls[0].maxTokens).toBe(2048);
  });

});

describe('AggregatorPrompt', () => {

  it('buildAggregatorPrompt 包含原始查询', () => {
    const prompt = buildAggregatorPrompt('What is TypeScript?', [
      { model: 'model-a', response: 'TypeScript is a typed superset of JavaScript.' },
    ]);

    expect(prompt).toContain('What is TypeScript?');
    expect(prompt).toContain('TypeScript is a typed superset of JavaScript.');
    expect(prompt).toContain('model-a');
  });

  it('buildAggregatorPrompt 包含所有模型响应', () => {
    const prompt = buildAggregatorPrompt('test', [
      { model: 'm1', response: 'resp1' },
      { model: 'm2', response: 'resp2' },
      { model: 'm3', response: 'resp3' },
    ]);

    expect(prompt).toContain('resp1');
    expect(prompt).toContain('resp2');
    expect(prompt).toContain('resp3');
    expect(prompt).toContain('m1');
    expect(prompt).toContain('m2');
    expect(prompt).toContain('m3');
  });

  it('AGGREGATOR_PROMPT_TEMPLATE 包含所有规则指令', () => {
    expect(AGGREGATOR_PROMPT_TEMPLATE).toContain('synthesizer');
    expect(AGGREGATOR_PROMPT_TEMPLATE).toContain('{query}');
    expect(AGGREGATOR_PROMPT_TEMPLATE).toContain('{responses}');
    expect(AGGREGATOR_PROMPT_TEMPLATE).toContain('consensus');
    expect(AGGREGATOR_PROMPT_TEMPLATE).toContain('contradictions');
  });

  it('空响应列表生成含空占位的 prompt', () => {
    const prompt = buildAggregatorPrompt('test', []);
    expect(prompt).toContain('test');
    expect(prompt).not.toContain('--- Model:');
  });

});
