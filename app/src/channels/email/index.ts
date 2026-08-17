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
 * channels/email/index.ts - Email 通道导出
 */

export {
  EmailChannel,
  emailChannel,
  createEmailChannel,
  emailChannelPlugin,
} from './EmailChannel.js';
export type { EmailConfig, EmailMessage } from './EmailChannel.js';

export { getDefaultEmailConfig, validateEmailConfig } from './config-schema.js';
export type { EmailConfig as EmailSchemaConfig } from './config-schema.js';

export {
  registerEmailAccount,
  getEmailAccount,
  resolveEmailAccount,
  listEmailAccountIds,
  removeEmailAccount,
} from './accounts.js';
export type { EmailAccount, ResolvedEmailAccount } from './accounts.js';

export { EmailMonitor } from './monitor.js';

export {
  setEmailRuntime,
  getEmailRuntime,
  clearEmailRuntime,
} from './runtime.js';
export type { EmailRuntime, EmailRuntimeStatus } from './runtime.js';
