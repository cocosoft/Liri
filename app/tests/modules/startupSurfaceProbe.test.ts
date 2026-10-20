/**
 * 启动面取证件（内核瘦身 P0）—— 纯函数口径守卫
 *
 * 钉四件事：
 *  ① **分段只认既有打点**（`launch_start` / `T0_preroll_*` …），缺失即不出现（不臆造 0）；
 *  ② **分级来自 `LAZY_MODULE_STRATEGY`**（critical / batch / on-demand），不另写清单；
 *  ③ **首次使用只对 ON_DEMAND 可观测**，批次模块必须 `null` + `usageObservable=false`
 *     —— 报告不得把"不可观测"写成"未使用"；
 *  ④ 汇总口径：`initialized` 是 D1 主指标；`initializedAtStartup` 按就绪时刻切分。
 */
import { describe, expect, it } from 'bun:test';

import {
  buildDeferredWindow,
  buildModuleSurface,
  buildStartupSegments,
  buildStartupSurfaceReport,
  classifyModuleTiers,
  isStartupSurfaceReportEnabled,
  REPORT_NOTES,
  summarizeSurface,
  type MarkLike,
  type ModuleStateLike,
} from '../../src/modules/startupSurfaceProbe';

const marks: MarkLike[] = [
  { name: 'launch_start', startTime: 100 },
  { name: 'T0_preroll_end', startTime: 400 },
  { name: 'module_init_start', startTime: 400 },
  { name: 'module_init_end', startTime: 2400 },
  { name: 'T1_await_prefetch_start', startTime: 2400 },
  { name: 'T1_await_prefetch_end', startTime: 2500 },
  { name: 'T2_dispatch_start', startTime: 2500 },
  { name: 'T2_dispatch_end', startTime: 2600 },
  { name: 'deferred:session_start', startTime: 2700 },
  { name: 'deferred:session_end', startTime: 2900 },
  { name: 'deferred:tasks_start', startTime: 2800 },
  { name: 'deferred:tasks_end', startTime: 3300 },
  { name: 'on_demand:memory_start', startTime: 9000 },
];

describe('开关（LIRI_STARTUP_REPORT）', () => {
  it('仅 1 / true（大小写不敏感）开启；默认与非法值关闭', () => {
    expect(isStartupSurfaceReportEnabled({ LIRI_STARTUP_REPORT: '1' })).toBe(
      true
    );
    expect(isStartupSurfaceReportEnabled({ LIRI_STARTUP_REPORT: 'TRUE' })).toBe(
      true
    );
    expect(isStartupSurfaceReportEnabled({})).toBe(false);
    expect(isStartupSurfaceReportEnabled({ LIRI_STARTUP_REPORT: '0' })).toBe(
      false
    );
    expect(isStartupSurfaceReportEnabled({ LIRI_STARTUP_REPORT: 'yes' })).toBe(
      false
    );
  });
});

describe('分段（复用既有打点）', () => {
  it('四段按定义顺序产出，耗时 = to - from', () => {
    expect(buildStartupSegments(marks)).toEqual([
      { label: 'T0 预读取', startOffsetMs: 100, durationMs: 300 },
      { label: 'T1 必需模块初始化', startOffsetMs: 400, durationMs: 2000 },
      { label: 'T1 预取等待', startOffsetMs: 2400, durationMs: 100 },
      { label: 'T2 模式分发', startOffsetMs: 2500, durationMs: 100 },
    ]);
  });

  it('缺任一端 / 时间倒挂 ⇒ 该段不出现（不臆造 0）', () => {
    expect(buildStartupSegments([])).toEqual([]);
    expect(
      buildStartupSegments([
        { name: 'launch_start', startTime: 500 },
        { name: 'T0_preroll_end', startTime: 400 },
      ])
    ).toEqual([]);
  });

  it('T3 批次窗口 = 全部 deferred:* 的最早 start → 最晚 end', () => {
    expect(buildDeferredWindow(marks)).toEqual({
      startOffsetMs: 2700,
      endOffsetMs: 3300,
      durationMs: 600,
    });
    expect(buildDeferredWindow([])).toEqual({
      startOffsetMs: null,
      endOffsetMs: null,
      durationMs: null,
    });
  });
});

describe('分级（同源于 LAZY_MODULE_STRATEGY）', () => {
  it('critical / deferred-batch / deferred-on-demand 三类各自落位', () => {
    const tiers = classifyModuleTiers(['monitoring', 'session', 'memory']);
    expect(tiers.get('monitoring')).toBe('critical');
    expect(tiers.get('session')).toBe('deferred-batch');
    expect(tiers.get('memory')).toBe('deferred-on-demand');
  });
});

describe('模块清单', () => {
  const order = ['monitoring', 'session', 'memory'];
  const tiers = classifyModuleTiers(order);
  const base = 1_000;

  it('偏移/耗时按 originWall 换算；状态原样映射', () => {
    const states: Record<string, ModuleStateLike> = {
      monitoring: { status: 'initialized', startTime: 1_100, endTime: 1_300 },
      session: { status: 'initialized', startTime: 1_900, endTime: 2_000 },
      memory: { status: 'pending' },
    };
    const entries = buildModuleSurface({
      order,
      tiers,
      states,
      marks,
      originWall: base,
    });

    expect(entries.map((e) => [e.moduleId, e.tier, e.status])).toEqual([
      ['monitoring', 'critical', 'initialized'],
      ['session', 'deferred-batch', 'initialized'],
      ['memory', 'deferred-on-demand', 'pending'],
    ]);
    expect(entries[0]).toMatchObject({
      initStartOffsetMs: 100,
      initDurationMs: 200,
    });
    expect(entries[2]).toMatchObject({
      initStartOffsetMs: null,
      initDurationMs: null,
    });
  });

  it('首次使用：ON_DEMAND 取 on_demand:* 打点；其余一律 null 且标记不可观测', () => {
    const entries = buildModuleSurface({
      order,
      tiers,
      states: {},
      marks,
      originWall: base,
    });

    expect(entries[2]).toMatchObject({
      moduleId: 'memory',
      usageObservable: true,
      firstUseOffsetMs: 9000,
    });
    expect(entries[1]).toMatchObject({
      moduleId: 'session',
      usageObservable: false,
      firstUseOffsetMs: null,
    });
    // 未请求的 ON_DEMAND ⇒ null（"未使用"只在 usageObservable=true 时成立）
    const noUse = buildModuleSurface({
      order,
      tiers,
      states: {},
      marks: [],
      originWall: base,
    });
    expect(noUse[2]).toMatchObject({
      usageObservable: true,
      firstUseOffsetMs: null,
    });
  });

  it('error 状态带出失败信息', () => {
    const [entry] = buildModuleSurface({
      order: ['session'],
      tiers,
      states: {
        session: {
          status: 'error',
          startTime: 1_200,
          error: new Error('boom'),
        },
      },
      marks: [],
      originWall: base,
    });
    expect(entry).toMatchObject({ status: 'error', error: 'boom' });
  });
});

describe('汇总与完整报告', () => {
  const order = ['monitoring', 'session', 'memory'];
  const tiers = classifyModuleTiers(order);
  const states: Record<string, ModuleStateLike> = {
    monitoring: { status: 'initialized', startTime: 1_100, endTime: 1_300 },
    session: { status: 'initialized', startTime: 1_900, endTime: 2_000 },
    memory: { status: 'pending' },
  };

  it('initialized 按分级分列（critical / batch / on-demand，D1 主指标）', () => {
    const entries = buildModuleSurface({
      order,
      tiers,
      states,
      marks,
      originWall: 1_000,
    });
    const counts = summarizeSurface(entries);

    expect(counts).toMatchObject({
      total: 3,
      critical: 1,
      deferredBatch: 1,
      deferredOnDemand: 1,
      initialized: 2,
      initializedCritical: 1,
      initializedBatch: 1,
      initializedOnDemand: 0,
      notStarted: 1,
      error: 0,
    });
    // memory 在 marks 里有 `on_demand:memory_start` ⇒ 计为"已请求"（即便状态仍是 pending：
    // 该打点发生在请求开始时，不代表初始化已完成）
    expect(counts.requestedOnDemand).toBe(1);
  });

  it('requestedOnDemand 只统计有首次请求打点的 ON_DEMAND 模块', () => {
    const entries = buildModuleSurface({
      order,
      tiers,
      states: { memory: { status: 'initialized' } },
      marks,
      originWall: 1_000,
    });
    expect(summarizeSurface(entries).requestedOnDemand).toBe(1);
  });

  it('完整报告：带版本、分段、批次窗口与"不可臆造"边界说明', () => {
    const report = buildStartupSurfaceReport({
      order,
      states,
      marks,
      originWall: 1_000,
      readyAtOffsetMs: 2_600,
      memory: { rss: 200 * 1024 * 1024, heapUsed: 50 * 1024 * 1024 },
      uptimeSeconds: 3.2,
    });

    expect(report.v).toBe(1);
    expect(report.segments).toHaveLength(4);
    expect(report.deferredWindow.durationMs).toBe(600);
    expect(report.counts.initialized).toBe(2);
    expect(report.readyAtOffsetMs).toBe(2600);
    expect(report.memory.rssMb).toBe(200);
    expect(report.notes).toEqual(REPORT_NOTES);
    expect(report.notes.join('')).toContain('无法由本探针观测');
  });

  it('未观测到 HTTP 就绪 ⇒ readyAtOffsetMs 保持 null（不臆造就绪时刻）', () => {
    const report = buildStartupSurfaceReport({
      order,
      states,
      marks,
      originWall: 1_000,
      readyAtOffsetMs: null,
      memory: { rss: 0, heapUsed: 0 },
      uptimeSeconds: 1,
    });
    expect(report.readyAtOffsetMs).toBeNull();
    // 分级计数不依赖时钟 ⇒ 与就绪时刻无关
    expect(report.counts.initialized).toBe(2);
  });

  it('preLaunchOffsetMs = launch_start 偏移（静态模块求值），无打点则 null', () => {
    const report = buildStartupSurfaceReport({
      order,
      states,
      marks,
      originWall: 1_000,
      readyAtOffsetMs: null,
      memory: { rss: 0, heapUsed: 0 },
      uptimeSeconds: 1,
    });
    expect(report.preLaunchOffsetMs).toBe(100);

    const noMarks = buildStartupSurfaceReport({
      order,
      states,
      marks: [],
      originWall: 1_000,
      readyAtOffsetMs: null,
      memory: { rss: 0, heapUsed: 0 },
      uptimeSeconds: 1,
    });
    expect(noMarks.preLaunchOffsetMs).toBeNull();
  });
});
