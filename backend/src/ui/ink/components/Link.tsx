/**
 * Ink Link组件
 * 用于显示可点击链接
 */

import React from 'react';
import { Link as InkLink } from 'ink';

export interface LinkProps {
  url: string;
  children?: React.ReactNode;
  underline?: boolean;
  color?: string;
}

export const Link: React.FC<LinkProps> = ({
  url,
  children,
  underline = true,
  color = 'blue',
}) => {
  return (
    <InkLink url={url} underline={underline} color={color}>
      {children}
    </InkLink>
  );
};