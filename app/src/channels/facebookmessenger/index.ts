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
 * channels/facebookmessenger/index.ts - Facebook Messenger 通道导出
 */

export {
  FacebookMessengerChannel,
  facebookMessengerChannel,
  createFacebookMessengerChannel,
  facebookMessengerChannelPlugin,
} from './FacebookMessengerChannel.js';
export type {
  FacebookMessengerConfig as FacebookMessengerChannelConfig,
  FacebookMessengerMessage as FacebookMessengerChannelMessage,
} from './FacebookMessengerChannel.js';

export {
  getDefaultFacebookMessengerConfig,
  validateFacebookMessengerConfig,
} from './config-schema.js';
export type { FacebookMessengerConfig } from './config-schema.js';

export {
  registerFacebookMessengerAccount,
  getFacebookMessengerAccount,
  resolveFacebookMessengerAccount,
  listFacebookMessengerAccountIds,
  removeFacebookMessengerAccount,
} from './accounts.js';
export type {
  FacebookMessengerAccount,
  ResolvedFacebookMessengerAccount,
} from './accounts.js';

export { FacebookMessengerMonitor } from './monitor.js';
export type {
  MonitorEvent as FacebookMessengerMonitorEvent,
  MonitorStats as FacebookMessengerMonitorStats,
} from './monitor.js';

export {
  setFacebookMessengerRuntime,
  getFacebookMessengerRuntime,
  clearFacebookMessengerRuntime,
} from './runtime.js';
export type {
  FacebookMessengerRuntime,
  FacebookMessengerRuntimeStatus,
} from './runtime.js';
