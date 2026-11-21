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
 * 入站监视 G1：渠道级入站指标（`.trae/specs/inbound-message-monitoring-gaps.md` §4）
 *
 * 断言要点：
 * - 入站/拒绝**按渠道分维**，互不影响；
 * - **不再存在无 channel 的总量序列**（否则前端按名求和会与分渠道序列重复计数）；
 * - 缺省渠道记 `unknown`，保证「总量 = 各渠道之和」；
 * - 计数口径以 `MetricsService.getMetric(name, labels)` 读回（与 toolMetrics 同法）。
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { getMetricsService } from '@openliri/infra/monitoring';
import {
  recordInboundMessage,
  recordMessageRejected,
  resetChannelMetricsForTest,
} from '@modules/channels/monitoring/ChannelMetrics';

const svc = getMetricsService();
const MODULE = 'channels:routing';

beforeEach(() => {
  resetChannelMetricsForTest();
});

describe('G1 渠道级入站指标', () => {
  it('按渠道分维计数：各渠道互不影响', () => {
    recordInboundMessage('feishu');
    recordInboundMessage('feishu');
    recordInboundMessage('qq');

    expect(
      svc
        .getMetric('channels.message.inbound_total', {
          module: MODULE,
          channel: 'feishu',
        })
        ?.get()
    ).toBe(2);
    expect(
      svc
        .getMetric('channels.message.inbound_total', {
          module: MODULE,
          channel: 'qq',
        })
        ?.get()
    ).toBe(1);
  });

  it('不再存在「无 channel」的总量序列（防前端求和翻倍）', () => {
    recordInboundMessage('feishu');
    recordInboundMessage('qq');

    expect(
      svc.getMetric('channels.message.inbound_total', { module: MODULE })?.get()
    ).toBeUndefined();
  });

  it('入口归一的 unknown 渠道独立成一条序列（总量 = 各渠道之和）', () => {
    // 渠道缺省归一发生在 messageRouter 入口（`channelName = 'unknown'`），
    // 指标层不再自带第二份缺省值 —— 这里直接按归一后的名字计数。
    recordInboundMessage('unknown');
    recordInboundMessage('qq');

    expect(
      svc
        .getMetric('channels.message.inbound_total', {
          module: MODULE,
          channel: 'unknown',
        })
        ?.get()
    ).toBe(1);
    expect(
      svc
        .getMetric('channels.message.inbound_total', {
          module: MODULE,
          channel: 'qq',
        })
        ?.get()
    ).toBe(1);
  });

  it('拒绝计数按「渠道 + 原因」分维', () => {
    recordMessageRejected('duplicate', 'qq');
    recordMessageRejected('duplicate', 'qq');
    recordMessageRejected('RATE_LIMITED', 'qq');
    recordMessageRejected('duplicate', 'feishu');

    expect(
      svc
        .getMetric('channels.message.rejected_total', {
          module: MODULE,
          channel: 'qq',
          reason: 'duplicate',
        })
        ?.get()
    ).toBe(2);
    expect(
      svc
        .getMetric('channels.message.rejected_total', {
          module: MODULE,
          channel: 'qq',
          reason: 'RATE_LIMITED',
        })
        ?.get()
    ).toBe(1);
    expect(
      svc
        .getMetric('channels.message.rejected_total', {
          module: MODULE,
          channel: 'feishu',
          reason: 'duplicate',
        })
        ?.get()
    ).toBe(1);
  });

  it('拒绝计数同样按渠道分维（含入口归一的 unknown）', () => {
    recordMessageRejected('INBOX_UNAVAILABLE', 'unknown');

    expect(
      svc
        .getMetric('channels.message.rejected_total', {
          module: MODULE,
          channel: 'unknown',
          reason: 'INBOX_UNAVAILABLE',
        })
        ?.get()
    ).toBe(1);
  });
});
