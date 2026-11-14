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
export {
  BasePlatformAdapter,
  type PlatformAdapter,
  type PlatformMessageEvent,
  type PlatformProcessingOutcome,
  type PlatformMessageType,
} from './PlatformAdapter.js';
export { PlatformAdapterBridge } from './PlatformAdapterBridge.js';
// 2026-10-20（P2）：**不再从桶里再导出 `SlackAdapter`** —— 它静态 import `channels/slack`，
// 会绕过 `DROP_CHANNELS_ALL` 把整个 Slack 通道（含 `@slack/*` 依赖）拉进 core 产物。
// 实测（core bundle）残留 `src/channels/slack/*` 5 个模块；本仓库内 `SlackAdapter` **零消费者**
// （仅定义 + 桶导出）。需要时请直接从 `./SlackAdapter.js` 显式引入。
