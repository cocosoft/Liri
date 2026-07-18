/**
 * 终端版 InlineCodeLink — 兜底组件
 *
 * 终端 Ink 环境不支持可点击链接，反引号内容渲染为 dim 样式文本。
 * Web 端的真实 FileLink 功能实现在 client/src/components/ChatArea/ 中。
 */
import React from 'react';
import { Text } from '../ink.js';

interface InlineCodeLinkProps {
  codeContent: string;
  knownFilePaths?: string[];
  onPreviewFile?: (path: string) => void;
}

/**
 * 终端版：仅渲染为 dim 样式的纯文本，不检测文件路径
 */
export default function InlineCodeLink({ codeContent }: InlineCodeLinkProps) {
  return React.createElement(Text, { dimColor: true }, codeContent);
}
