// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * A4（2026-11-05）：RSS 基线告警（**不设固定阈值**，以启动稳态为基线）。
 *
 * 背景：运行态排查发现后端 RSS 曾到 989MB（峰值 1319MB），但没有任何基线/告警，
 * 只能靠人翻日志。改为「每进程采纳一次启动稳态基线」，超过基线一定倍数与绝对增量
 * 才 warn（带冷却），避免在每台机器上钦定一个固定 MB 数。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  evaluateRssBaseline,
  type RssBaselineState,
} from '@openliri/infra/monitoring/memProfile';

const THRESHOLDS = {
  graceMs: 1000,
  multiplier: 1.5,
  minDeltaMb: 256,
  cooldownMs: 60_000,
};

/** 真实量级的时间基准（`0` 在实现里是"未开始"哨兵，测试必须用非零时间） */
const T0 = 1_700_000_000_000;

const fresh = (): RssBaselineState => ({
  baselineMb: null,
  firstSampleAt: 0,
  lastAlertAt: 0,
});

describe('evaluateRssBaseline — 暖机与基线采纳', () => {
  it('暖机窗口内不采纳基线', () => {
    const first = evaluateRssBaseline(fresh(), 400, T0, THRESHOLDS);
    expect(first.action).toBe('warmup');
    expect(first.next.baselineMb).toBeNull();

    const second = evaluateRssBaseline(first.next, 450, T0 + 500, THRESHOLDS);
    expect(second.action).toBe('warmup');
    expect(second.next.baselineMb).toBeNull();
  });

  it('暖机结束后首个采样即基线（每进程重新采纳）', () => {
    const first = evaluateRssBaseline(fresh(), 420, T0, THRESHOLDS);
    expect(first.action).toBe('warmup');
    const r = evaluateRssBaseline(first.next, 500, T0 + 1000, THRESHOLDS);
    expect(r.action).toBe('adopted');
    expect(r.next.baselineMb).toBe(500);
  });
});

describe('evaluateRssBaseline — 超基线判定（比例与绝对增量取与）', () => {
  const adopted: RssBaselineState = {
    baselineMb: 500,
    firstSampleAt: 0,
    lastAlertAt: 0,
  };

  it('比例与增量都超 ⇒ alert，并记录冷却起点', () => {
    const r = evaluateRssBaseline(adopted, 800, T0, THRESHOLDS);
    expect(r.action).toBe('alert');
    expect(r.next.lastAlertAt).toBe(T0);
    expect(r.ratio).toBeCloseTo(1.6, 5);
    expect(r.deltaMb).toBe(300);
  });

  it('冷却窗口内不重复告警', () => {
    const r = evaluateRssBaseline(
      { ...adopted, lastAlertAt: T0 },
      900,
      T0 + 30_000,
      THRESHOLDS
    );
    expect(r.action).toBe('ok');
  });

  it('冷却结束后可再次告警', () => {
    const r = evaluateRssBaseline(
      { ...adopted, lastAlertAt: T0 },
      900,
      T0 + 62_000,
      THRESHOLDS
    );
    expect(r.action).toBe('alert');
  });

  it('比例超但绝对增量不足 ⇒ 不告警（小内存进程防误报）', () => {
    const r = evaluateRssBaseline(
      { baselineMb: 100, firstSampleAt: 0, lastAlertAt: 0 },
      160,
      2000,
      THRESHOLDS
    );
    expect(r.action).toBe('ok');
  });

  it('绝对增量大但比例未超 ⇒ 不告警（避免大内存进程噪声）', () => {
    const r = evaluateRssBaseline(
      { baselineMb: 1000, firstSampleAt: 0, lastAlertAt: 0 },
      1300,
      2000,
      THRESHOLDS
    );
    expect(r.action).toBe('ok');
  });
});

describe('memProfile 接线 — 告警不依赖 MEM_PROFILE', () => {
  const src = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'packages',
      'infra',
      'src',
      'monitoring',
      'memProfile.ts'
    ),
    'utf-8'
  );

  it('基线判定在采样门控之前执行', () => {
    const checkAt = src.indexOf('evaluateRssBaseline(rssBaselineState');
    const gateAt = src.indexOf('if (!samplingActive()) return;');
    expect(checkAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(checkAt);
  });
});
