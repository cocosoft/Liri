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
 * 流式输出模块导出
 */

export { Stream, type MetricsConfig } from './Stream';
export {
  SSEParser,
  parseOpenAIStreamChunk,
  StreamAccumulator,
} from './SSEParser';
export { ApiStream } from './apiStream';
export {
  StreamingCircuitBreaker,
  retryWithBackoff,
  shouldRetryStreaming,
} from './retry';
export type { RetryConfig } from './retry';

export {
  IncrementalRetryHandler,
  DefaultResumeBuilder,
} from './IncrementalRetry';
export type {
  StreamBreakpoint,
  IncrementalRetryConfig,
  RetryResult,
  ResumeRequestBuilder,
} from './IncrementalRetry';

export {
  ToolCallStatus,
  StreamControlIndicator,
  MetricsDisplay,
  ProgressBar,
  StreamStatusPanel,
  EventLog,
} from './StreamEventInk';

export {
  BackpressureController,
  RateLimiter,
  readWithBackpressure,
} from './backpressure';
export type {
  BackpressureState,
  BackpressureEvent,
  BackpressureHandler,
} from './backpressure';
export type {
  StreamEvent,
  StreamEventType,
  StreamChunk,
  StreamCallback,
  StreamEventCallback,
  StreamStartEvent,
  StreamTokenEvent,
  StreamProgressEvent,
  StreamDoneEvent,
  StreamYieldEvent,
  StreamPauseEvent,
  StreamResumeEvent,
  StreamCancelEvent,
  StreamMetricsEvent,
  StreamToolStartEvent,
  StreamToolEndEvent,
  StreamToolProgressEvent,
  StreamStateTransition,
} from './types';
export {
  StreamState,
  isStreamStartEvent,
  isStreamTokenEvent,
  isStreamProgressEvent,
  isStreamDoneEvent,
  isStreamYieldEvent,
  isStreamPauseEvent,
  isStreamResumeEvent,
  isStreamCancelEvent,
  isStreamMetricsEvent,
  isStreamToolStartEvent,
  isStreamToolEndEvent,
  isStreamToolProgressEvent,
} from './types';
export { StreamStateMachine } from './StreamStateMachine';
export * from './scrubbers';
