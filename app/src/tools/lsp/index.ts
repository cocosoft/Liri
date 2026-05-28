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
 * LSP工具模块导出
 */

export * from './types/index.js';
export { LSPClient } from './LSPClient.js';
export { LSPServer } from './LSPServer.js';
export { LSPToolImpl } from './LSPToolImpl.js';
export { SymbolSearch } from './SymbolSearch.js';
export type {
  SymbolKind,
  SymbolInfo,
  SymbolLocation,
  SymbolSearchResult,
} from './SymbolSearch.js';
export { ReferenceFinder } from './ReferenceFinder.js';
export type { ReferenceLocation, ReferenceResult } from './ReferenceFinder.js';
export { HoverProvider } from './HoverProvider.js';
export type { HoverContent, HoverResult } from './HoverProvider.js';
export { CallHierarchy } from './CallHierarchy.js';
export type { CallHierarchyItem, CallHierarchyNode } from './CallHierarchy.js';
export { SymbolContext } from './SymbolContext.js';
export type { SymbolContextResult } from './SymbolContext.js';
export {
  LSPToolIntegration,
  createLSPToolIntegration,
} from './LSPToolIntegration.js';
export {
  getCompletions,
  getDefinition,
  getReferences,
  getDiagnostics,
  formatDocument,
} from './LSPToolIntegration.js';
