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
 * 插件注册系统导出
 */

export {
  CommandRegistration,
  commandRegistration,
} from './CommandRegistration.js';
export type {
  PluginCommand,
  CommandResult,
  CommandRegistrationEntry,
} from './CommandRegistration.js';

export {
  InteractionRegistry,
  interactionRegistry,
} from './InteractionRegistry.js';
export type {
  InteractionType,
  InteractionHandler,
  InteractionResponse,
  InteractionEntry,
} from './InteractionRegistry.js';

export { HttpRegistry, httpRegistry } from './HttpRegistry.js';
export type {
  HttpMethod,
  HttpRequestContext,
  HttpResponse,
  HttpRouteHandler,
  HttpRouteEntry,
} from './HttpRegistry.js';
