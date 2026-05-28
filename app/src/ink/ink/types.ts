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
 * Ink类型定义
 */

export interface InkInstance {
  id: string;
  rootElement?: React.ReactElement;
  container?: HTMLElement | null;
  isActive: boolean;
  cleanup?: () => void;
}

export interface InkNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children: InkNode[];
  textContent?: string;
  style?: Record<string, unknown>;
}

export interface InkStyle {
  display?: 'flex' | 'block' | 'none';
  flexDirection?: 'row' | 'column';
  justifyContent?:
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'space-between'
    | 'space-around';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch';
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: string | number;
  alignSelf?:
    | 'auto'
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'baseline'
    | 'stretch';
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  width?: number | string;
  height?: number | string;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  borderStyle?: 'none' | 'single' | 'double' | 'round';
  borderColor?: string;
  color?: string;
  backgroundColor?: string;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline' | 'line-through';
  textAlign?: 'left' | 'center' | 'right';
  whitespace?: 'normal' | 'nowrap' | 'pre';
  overflow?: 'hidden' | 'visible' | 'scroll';
}

export interface LayoutResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TerminalSize {
  rows: number;
  columns: number;
}

export interface InkEvent {
  type: string;
  target?: InkNode;
  timestamp: number;
}

export interface KeyboardEvent extends InkEvent {
  type: 'keydown' | 'keyup';
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface MouseEvent extends InkEvent {
  type: 'click' | 'mousedown' | 'mouseup' | 'mousemove';
  x: number;
  y: number;
  button?: number;
}

export interface FocusEvent extends InkEvent {
  type: 'focus' | 'blur';
  relatedTarget?: InkNode;
}
