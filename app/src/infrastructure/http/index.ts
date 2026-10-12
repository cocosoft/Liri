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
 * HTTP 基础设施模块导出
 */

export { LocalHTTPService } from './LocalHTTPService';
export type { LocalHTTPConfig } from './LocalHTTPService';
export {
  broadcastEvent,
  handleEvents,
  stopSSE,
  getSSEClientCount,
} from './LocalHTTPServiceSSE';
// F2（2026-10-12，预算挂起续跑 Task 3）：活跃 TAORLoop 注册表出口。
// ChatManager（app）须把它取到的实例登记进来，供 checkpoint 恢复端点按 sessionId 取用；
// 经本 barrel 出口（而非子路径直连）以守 R03-002（模块出口单一）。
export { registerTAORLoop } from './handlers/checkpoint-handlers';
