/**
 * Vim 模式 React Hook
 *
 * 提供 Vim 风格编辑功能的 React Hook 封装。
 * 在终端文本输入中切换 Normal/Insert 模式。
 */

import { useState, useCallback, useRef } from 'react'
import {
  handleVimKey,
  createVimState,
  type VimState,
  type VimMode,
  type VimContext,
} from './vimInput'

export interface UseVimInputOptions {
  initialText?: string
  initialMode?: VimMode
  onModeChange?: (mode: VimMode) => void
}

export interface VimInputResult {
  text: string
  cursorOffset: number
  mode: VimMode
  handleKey: (key: string) => void
  setText: (text: string) => void
  setCursorOffset: (offset: number) => void
  toggleMode: () => void
}

export function useVimInput(options: UseVimInputOptions = {}): VimInputResult {
  const [text, setText] = useState(options.initialText || '')
  const [cursorOffset, setCursorOffset] = useState(0)
  const stateRef = useRef<VimState>(createVimState())
  const modeRef = useRef<VimMode>(options.initialMode || 'INSERT')

  if (options.initialMode) {
    modeRef.current = options.initialMode
  }

  const [mode, setMode] = useState<VimMode>(modeRef.current)

  const ctx: VimContext = {
    get text() {
      return text
    },
    get cursorOffset() {
      return cursorOffset
    },
    setText: (newText: string) => setText(newText),
    setCursorOffset: (newOffset: number) => setCursorOffset(newOffset),
  }

  const handleKey = useCallback(
    (key: string) => {
      const state = stateRef.current
      state.mode = modeRef.current

      const result = handleVimKey(key, state, ctx)
      setText(result.text)
      setCursorOffset(result.cursorOffset)

      if (result.mode !== modeRef.current) {
        modeRef.current = result.mode
        state.mode = result.mode
        setMode(result.mode)
        options.onModeChange?.(result.mode)
      }
    },
    [text, cursorOffset, options.onModeChange],
  )

  const toggleMode = useCallback(() => {
    const newMode: VimMode = modeRef.current === 'INSERT' ? 'NORMAL' : 'INSERT'
    modeRef.current = newMode
    stateRef.current.mode = newMode
    setMode(newMode)
    options.onModeChange?.(newMode)
  }, [options.onModeChange])

  return {
    text,
    cursorOffset,
    mode,
    handleKey,
    setText: (t: string) => setText(t),
    setCursorOffset: (o: number) => setCursorOffset(o),
    toggleMode,
  }
}

export { type VimState, type VimMode, type VimContext }
