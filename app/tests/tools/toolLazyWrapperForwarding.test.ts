/**
 * U-03（2026-10-19）：懒加载包装器字段透传。
 *
 * 锁定两点（修复前必失败）：
 * - `sandboxLevel`：注册时快照即可读（未解包也能判定"执行类"）；
 * - `outputSchema`：已加载 ⇒ 委托真实实例；未加载 ⇒ `undefined`（不解包，保持懒加载语义）。
 *
 * PR-0 补充（2026-10-23）：**风险声明与落点根透传**。注册表里存的就是本包装器，
 * 权限层拿到的也是它 ⇒ 若不转发 `getRiskClass()` / `resolveFileIoRoot()`，
 * 所有写/执行/外部类工具在运行期都被判 `undeclared`，且 S4b 拿不到 `targetRoot`。
 */
import { describe, expect, it } from 'bun:test';
import type { LazyModuleLoader } from '@openliri/kernel';
import type { Tool, ToolInfo } from '../../src/tools/types/Tool';
import { ToolLazyWrapper } from '../../src/tools/utils/ToolLazyWrapper';
import {
  RiskClass,
  resolveRiskClass,
} from '../../src/permission/types/RiskClass';

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
  /** 真实实例上额外提供的字段（如 `riskClass` / `riskClassFor` / `getRiskClass` / `resolveFileIoRoot`） */
  real?: Partial<Tool>;
  /** 模拟加载失败（factory 抛错 / 异步工厂） */
  failLoad?: boolean;
}): { wrapper: ToolLazyWrapper; isLoaded: () => boolean } {
  let loaded = options.loaded === true;
  const real = {
    name: 'demo_tool',
    description: 'demo',
    params: [],
    outputSchema: options.outputSchema,
    outputJsonSchema: options.outputJsonSchema,
    ...options.real,
  } as unknown as Tool;
  const loader = {
    isLoaded: () => loaded,
    getSync: () => real,
    get: async () => real,
    loadSync: () => {
      if (options.failLoad) throw new Error('factory failed');
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

  it('sandboxLevel 快照缺失 ⇒ 委托真实实例（对象字面量工具的 getInfo 未枚举该位）', () => {
    const { wrapper } = makeWrapper({ real: { sandboxLevel: 'file-io' } });

    expect(wrapper.sandboxLevel).toBe('file-io');
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

describe('ToolLazyWrapper 风险/落点根透传（PR-0 补充）', () => {
  it('静态声明 riskClass 的工具经包装器仍判 write（修复前为 undeclared）', () => {
    const { wrapper } = makeWrapper({ real: { riskClass: 'write' } });

    expect(resolveRiskClass(wrapper, {})).toBe(RiskClass.WRITE_LOCAL);
  });

  it('动态声明 riskClassFor 的工具经包装器按本次入参分档', () => {
    const { wrapper } = makeWrapper({
      real: {
        riskClassFor: (input) => (input.action === 'hover' ? 'read' : 'write'),
      },
    });

    expect(resolveRiskClass(wrapper, { action: 'hover' })).toBe(RiskClass.READ);
    expect(resolveRiskClass(wrapper, { action: 'rename' })).toBe(
      RiskClass.WRITE_LOCAL
    );
  });

  it('仅靠 TOOL_EFFECTS 派生的对象字面量工具也透传（无需自声明 getRiskClass）', () => {
    // P1（2026-10-30）：`cron_create` 并入 `cron`（TOOL_EFFECTS 中 sideEffect=local ⇒ write）
    const { wrapper } = makeWrapper({
      metadata: makeMetadata({ name: 'cron' }),
      real: { name: 'cron' },
    });

    expect(resolveRiskClass(wrapper, {})).toBe(RiskClass.WRITE_LOCAL);
  });

  it('取不到真身 ⇒ undeclared（保守询问，不静默放行）', () => {
    const { wrapper } = makeWrapper({
      failLoad: true,
      real: { riskClass: 'write' },
    });

    expect(wrapper.getRiskClass({})).toBe('undeclared');
    expect(resolveRiskClass(wrapper, {})).toBe(RiskClass.UNDECLARED);
  });

  it('resolveFileIoRoot 透传真实实现的落点根；无声明 ⇒ undefined', () => {
    const declared = makeWrapper({
      real: {
        resolveFileIoRoot: (input) => `/projects/${String(input.projectId)}`,
      },
    });
    expect(declared.wrapper.resolveFileIoRoot({ projectId: 'p1' })).toBe(
      '/projects/p1'
    );

    const undeclared = makeWrapper({});
    expect(undeclared.wrapper.resolveFileIoRoot({})).toBeUndefined();
  });
});
