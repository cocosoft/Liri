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
export { handleVimKey, createVimState } from './vimInput';
export type { VimState, VimMode, VimOperator, VimContext } from './vimInput';
export { useVimInput } from './useVimInput';
export type { UseVimInputOptions, VimInputResult } from './useVimInput';
export {
  Register as VimRegisters,
  createVimRegisters,
  registerManager as vimRegisters,
} from './registers';
export type { RegisterType as RegisterName } from './registers';

// 新增模块导出
export { MacroManager, createMacroManager, macroManager } from './macros';
export type { MacroRecord } from './macros';
export {
  TextObjectManager,
  createTextObjectManager,
  textObjectManager,
} from './textObjects';
export type { TextObject, TextObjectType } from './textObjects';
export { SearchManager, createSearchManager, searchManager } from './search';
export type { SearchResult, ReplaceResult } from './search';
export { MarkManager, createMarkManager, markManager } from './marks';
export type { Mark } from './marks';
export {
  VisualModeManager,
  createVisualModeManager,
  visualModeManager,
} from './visualMode';
export type { VisualModeType, VisualSelection } from './visualMode';
