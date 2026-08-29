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
//
// Ink库入口文件
export { default as Ink } from './ink';
export { default as App } from './components/App';
export { default as Box } from './components/Box';
export { default as Text } from './components/Text';
export { default as Button } from './components/Button';
export { default as ScrollBox } from './components/ScrollBox';
export { AlternateScreen } from './components/AlternateScreen';
export { default as Spacer } from './components/Spacer';
export { default as Newline } from './components/Newline';
export { default as Link } from './components/Link';
export { NoSelect } from './components/NoSelect';
export { RawAnsi } from './components/RawAnsi';
export { useInput } from './hooks/use-input';
export { useApp } from './hooks/use-app';
export { useTerminalSize } from '@modules/hooks';

// 导出渲染函数
export { default as render, renderSync, createRoot } from './root';
