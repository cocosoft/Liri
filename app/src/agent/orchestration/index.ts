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
 * 协作编排适配器（app 层）—— 把 core 端口 `ICollaborationPort` 的契约**形状搬运**到三路既有引擎。
 *
 * 规格：`.trae/specs/collaboration-orchestration-port.md` §3。
 *
 * ⚠️ **预留端口**：生产中暂无消费者（消费入口待定，见 spec §5）。适配器的引擎实例与 executor
 * 均为**构造实参**，由装配侧（`entrypoints/spiWiring.ts`）注入。
 */

export { SwarmChannelAdapter } from './SwarmChannelAdapter';
export type { SwarmChannelDeps } from './SwarmChannelAdapter';
export { SchedulerChannelAdapter } from './SchedulerChannelAdapter';
export type { SchedulerChannelDeps } from './SchedulerChannelAdapter';
export { RemoteChannelAdapter } from './RemoteChannelAdapter';
export type { RemoteChannelDeps } from './RemoteChannelAdapter';
