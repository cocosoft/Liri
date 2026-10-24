/**
 * DI 容器回归（2026-10-24 架构评审 P0/P1 七条的机检落点）。
 *
 * 每条用例对应评审里的一个编号，**不是**泛泛的 smoke：
 *   #1 环注册被拒后不残留脏状态；#2 报出的环是闭环而非"根→环入口"前缀；
 *   #3 request 作用域在并发请求间隔离；#4 transient 的 onDispose 注册期即拒；
 *   #5 增量检测与全图检测等价；#7 disposeAll 单个失败不中断其它；#8 eager 才跑 onLoad。
 * 另含 #6 自动装配的可失败自证。
 *
 * 位置说明：放在 `packages/kernel/tests/`（**不在** `src/core/` 下）——
 * K08 体量棘轮的观测面是内核源码，测试不该占用内核体量预算（棘轮只允许下调）。
 */

import { describe, expect, it } from 'bun:test';

import { AppError } from '../src/core/errors.js';
import { AutoWiringEngine } from '../src/core/di/AutoWiringEngine';
import { DIContainer } from '../src/core/di/DIContainer';

/** 建一个"可被 resolve"的简单描述符 */
const svc = (
  id: string,
  extra: Partial<{
    dependencies: string[];
    onLoad: () => Promise<void>;
    onDispose: () => Promise<void>;
    eager: boolean;
  }> = {}
) => ({
  id,
  factory: () => ({ id }),
  scope: 'singleton' as const,
  ...extra,
});

describe('DI #1：环注册被拒后不残留脏状态', () => {
  it('抛 DI_CYCLE_DETECTED 后，该描述符已移除、图回到无环', () => {
    const container = new DIContainer();
    container.registerDescriptor(svc('a', { dependencies: ['b'] }));

    expect(() =>
      container.registerDescriptor(svc('b', { dependencies: ['a'] }))
    ).toThrow('Cyclic dependency');

    // 关键：不是"只读检查"，而是真的移除了
    expect(container.has('b')).toBe(false);
    expect(container.detectCycles().hasCycle).toBe(false);
    expect(container.detectCycles().cycle).toBeUndefined();
  });
});

describe('DI #2：报出的环是闭环，不是「根 → 环入口」前缀', () => {
  it('x → y → z → y 时报 [z, y, z]（不含不相干的 x）', () => {
    const container = new DIContainer();
    container.registerDescriptor(svc('x', { dependencies: ['y'] }));
    container.registerDescriptor(svc('y', { dependencies: ['z'] }));

    let caught: unknown;
    try {
      container.registerDescriptor(svc('z', { dependencies: ['y'] }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    const err = caught as AppError;
    expect(err.code).toBe('DI_CYCLE_DETECTED');
    expect(err.context?.['cycle']).toEqual(['z', 'y', 'z']);
  });
});

describe('DI #3：request 作用域在并发请求间隔离', () => {
  it('两个重叠的请求各自一份实例，同一请求内复用', async () => {
    const container = new DIContainer();
    let created = 0;
    container.registerDescriptor({
      id: 'req',
      scope: 'request',
      factory: () => ({ seq: ++created }),
    });

    const runOne = async (): Promise<{ first: number; sameWithin: boolean }> => {
      container.beginRequest();
      const first = container.resolve<{ seq: number }>('req');
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = container.resolve<{ seq: number }>('req');
      return { first: first.seq, sameWithin: second === first };
    };

    const [a, b] = await Promise.all([runOne(), runOne()]);

    expect(a.sameWithin).toBe(true);
    expect(b.sameWithin).toBe(true);
    // 并发请求不共享：两个不同的 seq（原实现是同一份 Map，会被 clear 掉/串用）
    expect(a.first).not.toBe(b.first);
    expect(created).toBe(2);
  });
});

describe('DI #4：onDispose 的作用域契约是显式的', () => {
  it('transient 声明 onDispose ⇒ 注册期抛 DI_ONDISPOSE_REQUIRES_SINGLETON', () => {
    const container = new DIContainer();
    // 错误码在 AppError 的第 4 个参数上（不在 message 里）⇒ 断言 `code` 字段
    let caught: unknown;
    try {
      container.registerDescriptor({
        id: 't',
        scope: 'transient',
        factory: () => ({}),
        onDispose: async () => undefined,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('DI_ONDISPOSE_REQUIRES_SINGLETON');
  });

  it('singleton 的 onDispose 在 disposeAll 时被调用（逆序）', async () => {
    const container = new DIContainer();
    const disposed: string[] = [];
    container.registerDescriptor(
      svc('a', {
        onDispose: async () => {
          disposed.push('a');
        },
      })
    );
    container.registerDescriptor(
      svc('b', {
        onDispose: async () => {
          disposed.push('b');
        },
      })
    );
    container.resolve('a');
    container.resolve('b');

    await container.disposeAll();
    expect(disposed).toEqual(['b', 'a']);
  });
});

describe('DI #5：增量检测与全图检测等价', () => {
  it('无环时从新节点检测不误报（含未注册依赖）', () => {
    const container = new DIContainer();
    container.registerDescriptor(svc('a', { dependencies: ['not-registered'] }));
    container.registerDescriptor(svc('b', { dependencies: ['a'] }));
    expect(container.detectCycles().hasCycle).toBe(false);
  });

  it('新节点闭合环时必被增量检测抓住', () => {
    const container = new DIContainer();
    container.registerDescriptor(svc('a', { dependencies: ['b'] }));
    expect(() =>
      container.registerDescriptor(svc('b', { dependencies: ['a'] }))
    ).toThrow('Cyclic dependency');
  });
});

describe('DI #7：disposeAll 单个失败不中断其它', () => {
  it('a 抛错时 b 仍被释放；单个错误原样抛（保持既有 catch 语义）', async () => {
    const container = new DIContainer();
    const disposed: string[] = [];
    container.registerDescriptor(
      svc('a', {
        onDispose: async () => {
          disposed.push('a');
          throw new Error('boom');
        },
      })
    );
    container.registerDescriptor(
      svc('b', {
        onDispose: async () => {
          disposed.push('b');
        },
      })
    );
    container.resolve('a');
    container.resolve('b');

    await expect(container.disposeAll()).rejects.toThrow('boom');
    // 逆序：b 先释放；a 抛错前也已记录 ⇒ 两个都被处理过（原实现会在 b 之前中断）
    expect(disposed).toEqual(['b', 'a']);
  });
});

describe('DI #8：生命周期钩子依赖显式 eager 声明', () => {
  it('eager:true ⇒ 未 resolve 也会先实例化并跑 onLoad；非 eager 跳过', async () => {
    const container = new DIContainer();
    const loaded: string[] = [];
    container.registerDescriptor(
      svc('eagerSvc', {
        eager: true,
        onLoad: async () => {
          loaded.push('eager');
        },
      })
    );
    container.registerDescriptor(
      svc('lazySvc', {
        onLoad: async () => {
          loaded.push('lazy');
        },
      })
    );

    await container.loadAll();
    expect(loaded).toEqual(['eager']);
  });
});

describe('DI #6：按参数名自动装配的可失败自证', () => {
  it('纯标识符参数 ⇒ 正常解析', () => {
    class NeedsDep {
      constructor(public dep: unknown) {}
    }
    const container = new DIContainer();
    container.registerInstance('dep', { ok: true });
    const instance = new AutoWiringEngine().resolveConstructor(
      NeedsDep,
      container
    );
    expect(instance.dep).toEqual({ ok: true });
  });

  it('解构参数 ⇒ DI_AUTOWIRE_UNRELIABLE（不再静默把 `{ a }` 当服务名）', () => {
    // 构造一个"形参不是纯标识符"的形态（TS 类型在运行期已擦除，故直接给函数源码）
    const camel = (0, function ({ a }: { a: unknown }) {
      return a;
    });
    const engine = new AutoWiringEngine();
    let caught: unknown;
    try {
      engine.getParameterNames(camel as unknown as new () => unknown);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('DI_AUTOWIRE_UNRELIABLE');
  });
});
