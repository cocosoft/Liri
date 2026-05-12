/**
 * ui/vim/ — Vim 模式 UI 模块
 *
 * 过渡期 re-export，实际代码位于 vim/
 */

export {
  handleVimKey,
  createVimState,
  useVimInput,
  VimRegisters,
  createVimRegisters,
  vimRegisters,
  MacroManager,
  createMacroManager,
  macroManager,
  TextObjectManager,
  createTextObjectManager,
  textObjectManager,
  SearchManager,
  createSearchManager,
  searchManager,
  MarkManager,
  createMarkManager,
  markManager,
  VisualModeManager,
  createVisualModeManager,
  visualModeManager,
} from '../../vim';

export type {
  VimState,
  VimMode,
  VimOperator,
  VimContext,
  UseVimInputOptions,
  VimInputResult,
  RegisterName,
  MacroRecord,
  TextObject,
  TextObjectType,
  SearchResult,
  ReplaceResult,
  Mark,
  VisualModeType,
  VisualSelection,
} from '../../vim';

export { FoldManager, createFoldManager, foldManager } from '../../vim/folding';
export type { FoldRange } from '../../vim/folding';

export { MultiCursorManager, createMultiCursorManager, multiCursorManager } from '../../vim/multiCursor';
export type { CursorPosition } from '../../vim/multiCursor';