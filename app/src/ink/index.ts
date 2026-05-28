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
 * Ink UI 引擎入口
 * 重新导出 ink/ink 子目录中的自定义 Ink 实现
 */
import React from 'react';
import CC_Text from './ink/components/Text';

/**
 * 包装 Text 组件，支持 dimColor 作为 dim 的别名
 * （兼容 npm ink 包的 API）
 */
const Text = (props: any) => {
  const { dimColor, dim, ...rest } = props;
  const dimValue = dimColor !== undefined ? dimColor : dim;
  return React.createElement(CC_Text, { dim: dimValue, ...rest });
};

export { default as Ink } from './ink/ink';
export { default as App } from './ink/components/App';
export { default as Box, type Props as BoxProps } from './ink/components/Box';
export { Text };
export { default as Button } from './ink/components/Button';
export { default as ScrollBox } from './ink/components/ScrollBox';
export { AlternateScreen } from './ink/components/AlternateScreen';
export { default as Spacer } from './ink/components/Spacer';
export { default as Newline } from './ink/components/Newline';
export { default as Link } from './ink/components/Link';
export { NoSelect } from './ink/components/NoSelect';
export { RawAnsi } from './ink/components/RawAnsi';
export { useInput } from './ink/hooks/use-input';
export { useApp } from './ink/hooks/use-app';
export { useTerminalSize } from '../hooks/useTerminalSize';
export { default as render, renderSync, createRoot } from './ink/root';
