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
 * 秘密扫描模块
 *
 * 聚合分散的**记忆侧**秘密扫描能力：
 * - MemorySecretScanner（记忆秘密扫描）
 *
 * 2026-10-01（台账 D-154）：原还转出 TeamMemSecretScanner / TeamMemSecretGuard（`services`）
 * 与 PluginSecurityScanner（`plugins`）—— 三者**全仓零消费者**（含 tests），却把 app/service
 * 反向拉进 infra ⇒ 已删除；需要者请直接从各自来源模块导入。
 */

export {
  scanForSecrets as scanMemoryForSecrets,
  containsSecrets,
  sanitizeSecrets,
  scanMemoryContent,
  validateMemoryContent,
} from '@modules/memory';
export type {
  SecretMatch as MemorySecretMatch,
  SecretScanResult,
} from '@modules/memory';
