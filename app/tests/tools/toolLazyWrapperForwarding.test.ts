/**
 * U-03（2026-10-19）：懒加载包装器字段透传。
 *
 * 锁定两点（修复前必失败）：
 * - `sandboxLevel`：注册时快照即可读（未解包也能判定"执行类"）；
 * - `outputSchema`：已加载 ⇒ 委托真实实例；未加载 ⇒ `undefined`（不解包，保持懒加载语义）。
 */
import { describe, expect, it } from 'bun:test';
import type { LazyModuleLoader } from '@modules/core';
import type { Tool, ToolInfo } from '../../src/tools/types/Tool';
import { ToolLazyWrapper } from '../../src/tools/utils/ToolLazyWrapper';

function makeMetadata(overrides: Partial<ToolInfo> = {}): ToolInfo {
  return {
    name: 'demo_tool',
    description: 'demo',
    params: [],
    enabled: true,
    readOnly: false,
    destructive: false,
    concurrencySafe: true,
    deferred: true,
    alwaysLoad: false,
    interruptBehavior: 'block',
    ...overrides,
  };
}

function makeWrapper(options: {
  metadata?: ToolInfo;
  loaded?: boolean;
  outputSchema?: Tool['outputSchema'];
  outputJsonSchema?: Tool['outputJsonSchema'];
}): { wrapper: ToolLazyWrapper; isLoaded: () => boolean } {
  let loaded = options.loaded === true;
  const real = {
    name: 'demo_tool',
    description: 'demo',
    params: [],
    outputSchema: options.outputSchema,
    outputJsonSchema: options.outputJsonSchema,
  } as unknown as Tool;
  const loader = {
    isLoaded: () => loaded,
    getSync: () => real,
    get: async () => real,
    loadSync: () => {
      loaded = true;
      return real;
    },
    reset: () => {
      loaded = false;
    },
  } as unknown as LazyModuleLoader<Tool>;
  return {
    wrapper: new ToolLazyWrapper(options.metadata ?? makeMetadata(), loader),
    isLoaded: () => loaded,
  };
}

describe('ToolLazyWrapper 字段透传（U-03）', () => {
  it('sandboxLevel 来自注册快照（未解包可读，且不触发加载）', () => {
    const { wrapper, isLoaded } = makeWrapper({
      metadata: makeMetadata({ sandboxLevel: 'execution' }),
    });

    expect(wrapper.sandboxLevel).toBe('execution');
    expect(wrapper.getInfo().sandboxLevel).toBe('execution');
    expect(isLoaded()).toBe(false);
  });

  it('未加载 ⇒ outputSchema 为 undefined 且不触发加载', () => {
    const { wrapper, isLoaded } = makeWrapper({
      outputSchema: { safeParse: () => ({ success: true }) },
    });

    expect(wrapper.outputSchema).toBeUndefined();
    expect(isLoaded()).toBe(false);
  });

  it('已加载 ⇒ outputSchema 委托真实实例', () => {
    const schema = { safeParse: () => ({ success: true }) };
    const { wrapper } = makeWrapper({ loaded: true, outputSchema: schema });

    expect(wrapper.outputSchema).toBe(schema);
  });

  it('outputJsonSchema：未加载 ⇒ undefined 且不触发加载；已加载 ⇒ 委托', () => {
    const declared = {
      type: 'object',
      properties: { content: { type: 'string' } },
    };
    const notLoaded = makeWrapper({ outputJsonSchema: declared });
    expect(notLoaded.wrapper.outputJsonSchema).toBeUndefined();
    expect(notLoaded.isLoaded()).toBe(false);

    const loaded = makeWrapper({ loaded: true, outputJsonSchema: declared });
    expect(loaded.wrapper.outputJsonSchema).toEqual(declared);
  });
});
