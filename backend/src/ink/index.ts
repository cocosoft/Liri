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
export { default as AlternateScreen } from './ink/components/AlternateScreen';
export { default as Spacer } from './ink/components/Spacer';
export { default as Newline } from './ink/components/Newline';
export { default as Link } from './ink/components/Link';
export { default as NoSelect } from './ink/components/NoSelect';
export { default as RawAnsi } from './ink/components/RawAnsi';
export { useInput } from './ink/hooks/use-input';
export { useApp } from './ink/hooks/use-app';
export { useTerminalSize } from '../hooks/useTerminalSize';
export { default as render, renderSync, createRoot } from './ink/root';
