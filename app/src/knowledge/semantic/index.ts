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
 * 语义向量索引模块
 *
 * 提供文档分块、嵌入生成、向量存储和语义搜索的完整能力。
 *
 * 组件:
 *   - chunker: 基于行窗口的文档分块
 *   - embedding: Ollama / OpenAI-compat 嵌入客户端
 *   - store: JSONL 追加存储 + 余弦相似度搜索
 *   - builder: 索引构建编排（分块 → 嵌入 → 存储）
 *
 * 借鉴: DeepSeek-Reasonix src/index/semantic/
 */

export { chunkText, chunkDirectory } from './chunker';
export type { CodeChunk, ChunkOptions, SkipReason } from './chunker';

export { SemanticStore, readIndexMeta, wipeStoreFiles } from './store';
export type { IndexEntry, SearchHit, IndexMeta, IndexIdentity } from './store';

export { IndexBuilder, indexBuilder } from './builder';
export type { BuildConfig, BuildResult } from './builder';