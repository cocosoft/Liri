/**
 * Accordion组件 - 可折叠面板
 */

import React from 'react';
import { Text, Box } from '../ink.js';

export interface AccordionItem {
  title: string;
  content: React.ReactNode;
  defaultOpen?: boolean;
}

export interface AccordionProps {
  items: AccordionItem[];
  borderColor?: string;
  titleColor?: string;
}

export function Accordion({
  items,
  borderColor = 'gray',
  titleColor = 'cyan',
}: AccordionProps): React.ReactNode {
  return (
    <Box flexDirection="column">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const connector = isLast ? '└' : '├';

        return (
          <Box key={index} flexDirection="column">
            <Box alignItems="center">
              <Text color={borderColor}>{connector}─ </Text>
              <Text color={titleColor} bold>
                {item.title}
              </Text>
            </Box>
            {item.content && (
              <Box marginLeft={4} marginTop={1} marginBottom={1}>
                {item.content}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
