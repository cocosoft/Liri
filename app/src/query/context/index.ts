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
 * 上下文引擎模块导出
 *
 * Phase 5 清理: 删除已废弃的压缩引擎实现（DefaultContextEngine/TruncatorEngine/
 *   SummarizerEngine/HybridEngine/SummaryGenerator/SummaryTemplate/JsonTruncator）。
 *   实际压缩由 context/compaction/CompactionOrchestrator（Tier1/2/3）完成。
 *   保留：IContextEngine 接口、ContextEngineRegistry（TAORLoop 引用）、ContextTracker（ChatManager 引用）。
 */
export { IContextEngine, DEFAULT_COMPRESSION_CONFIG } from './IContextEngine';
export type { CompressionConfig, CompressionResult } from './IContextEngine';
export { ContextEngineRegistry } from './ContextEngineRegistry';
export type { CompressionFeature } from './ContextEngineRegistry';
export { ContextTracker } from './ContextTracker';
export type { CompressionRecord } from './ContextTracker';
