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
export { ChannelHealthMonitor } from './ChannelHealthMonitor';
export type {
  HealthAlert,
  ChannelHealthReport,
  ChannelHealthMonitorConfig,
} from './ChannelHealthMonitor';

// 2026-08-30 R03-002 收敛：MessageTraceBuffer 统一出口
export { messageTraceBuffer } from './MessageTraceBuffer';
export type {
  TraceStageStatus,
  MessageTraceStage,
  MessageTraceStatus,
  MessageTrace,
  MessageTraceEventKind,
  MessageTraceEvent,
  FinishedMessageTrace,
} from './messageTraceTypes';
// 入站监视 G2（2026-11-21）：终态链路持久化 + 历史查询
export {
  MessageTraceStore,
  MESSAGE_TRACES_TABLE,
  TRACE_RETENTION_MS,
  TRACE_MAX_ROWS,
  getMessageTraceStore,
  resetMessageTraceStoreForTest,
  persistFinishedMessageTrace,
} from './MessageTraceStore';
export type {
  MessageTraceHistoryQuery,
  MessageTraceHistoryPage,
} from './MessageTraceStore';
// 入站监视 G3/P4（2026-11-21）：阈值告警 + 静默期状态
export {
  InboundAlertEvaluator,
  readChannelCounters,
  REJECTION_WINDOW_MS,
  REJECTION_MIN_COUNT,
  REJECTION_MIN_RATIO,
  INFLIGHT_STUCK_MS,
  CHANNEL_SILENCE_MS,
  EVALUATION_TICK_MS,
  ALERT_SILENCE_MS,
} from './InboundAlertEvaluator';
export type {
  InboundAlert,
  InboundAlertRuleId,
  InboundChannelStatus,
  ChannelCounters,
  InboundAlertEvaluatorOptions,
} from './InboundAlertEvaluator';
export {
  ChannelAlertStateStore,
  CHANNEL_ALERT_STATE_TABLE,
  getChannelAlertStateStore,
  resetChannelAlertStateStoreForTest,
} from './ChannelAlertStateStore';
