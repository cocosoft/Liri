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
import { warnDeprecatedCoreModule } from '../deprecationNotice.js';

/**
 * 自动回复的**分片 / 信封 / 分发 / 心跳**原语（chunk / envelope / dispatch / heartbeat）。
 *
 * @deprecated（2026-10-23，C′ 观察期）本目录**零代码消费者**：
 * ① 无 `@modules/core/auto-reply` 别名引用；② 无相对路径 import；③ `core/index.ts` **不**再导出它
 * （历史文档「经 `@modules/core` 可达」已过期）；④ 10 个导出符号在全仓只命中**同名不同物**
 * （`bridge/managers/HeartbeatManager`、`knowledge/semantic/chunker#chunkText`、多处 `hasContent` 字段）。
 * **注意**：它与顶层模块 `app/src/auto-reply/`（`AutoReplyEngine`）**同名不同物**，后者才是 HTTP 规则接口在用的实现。
 * 取证见 `dev_docs/20261023/auto-reply-消费者清单.md`（C′ 档归属见 `dev_docs/20261023/core-减重盘点清单.md` §4）；
 * 如确为在役依赖请移除标记并补测试。
 */
warnDeprecatedCoreModule(
  'auto-reply',
  '零代码消费者（三重零；与 app/src/auto-reply 同名不同物）'
);

export { chunkText, resolveChunkLimit } from './chunk.js';
export { createEnvelope, hasContent, mergeEnvelopes } from './envelope.js';
export { HeartbeatManager } from './heartbeat.js';
export { ReplyDispatcher } from './dispatch.js';
export type * from './types.js';
