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
 * @deprecated 请使用 channels/ 目录下的 IChannelPlugin 体系替代。
 *
 *   核心功能已完全迁移至 channels/ 体系。
 *   HealthMonitor 已移至 monitoring/HealthMonitor.ts。
 *   当前仅保留 ChannelPlugin + ChannelPluginRegistry + types（桥接层）。
 *
 *   此模块将在桥接层解耦后整体移除。
 */

export {
  ChannelType,
  ChannelStatus,
  MessageDirection,
  ChannelEvent,
} from './types';

export type {
  InboundMessage,
  OutboundMessage,
  ChannelConfig,
  ChannelEventCallbacks,
  ChannelStats,
  GatewayChannel,
} from './types';

export { ChannelPluginRegistry, RegistryEvent } from './ChannelPluginRegistry';

export type { RegistryCallbacks } from './ChannelPluginRegistry';

export type {
  ChannelPlugin,
  ChannelCapabilities,
  PluginValidationResult,
} from './ChannelPlugin';
export { isChannelPlugin } from './ChannelPlugin';
