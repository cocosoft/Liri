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
