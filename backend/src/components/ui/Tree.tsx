/**
 * Tree组件 - 树形结构显示
 */

import React from 'react';
import { Text, Box } from '../ink.js';

export interface TreeNode {
  label: string;
  children?: TreeNode[];
  expanded?: boolean;
  icon?: string;
  color?: string;
}

export interface TreeProps {
  nodes: TreeNode[];
  showLines?: boolean;
  indentSize?: number;
}

interface RenderNodeProps {
  node: TreeNode;
  depth: number;
  showLines: boolean;
  isLast: boolean;
  parentPrefixes: boolean[];
}

function RenderNode({ node, depth, showLines, isLast, parentPrefixes }: RenderNodeProps): React.ReactNode {
  const [expanded, setExpanded] = React.useState(node.expanded !== false);

  const prefix = parentPrefixes
    .map((hasSibling, idx) => {
      if (idx === 0) return '';
      return hasSibling ? '│  ' : '   ';
    })
    .join('');

  const connector = isLast ? '└─ ' : '├─ ';
  const expandIcon = node.children && node.children.length > 0
    ? (expanded ? '▼ ' : '▶ ')
    : '  ';

  const nodeColor = node.color || 'white';

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{prefix}</Text>
        <Text dimColor>{showLines ? connector : '  '}</Text>
        <Text
          color={nodeColor}
          bold
        >
          {expandIcon}
          {node.icon && <Text>{node.icon} </Text>}
          {node.label}
        </Text>
      </Box>
      {expanded && node.children && node.children.length > 0 && (
        <Box flexDirection="column">
          {node.children.map((child, idx) => (
            <RenderNode
              key={child.label + idx}
              node={child}
              depth={depth + 1}
              showLines={showLines}
              isLast={idx === node.children!.length - 1}
              parentPrefixes={[...parentPrefixes, !isLast]}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

export function Tree({ nodes, showLines = true, indentSize = 2 }: TreeProps): React.ReactNode {
  return (
    <Box flexDirection="column">
      {nodes.map((node, idx) => (
        <RenderNode
          key={node.label + idx}
          node={node}
          depth={0}
          showLines={showLines}
          isLast={idx === nodes.length - 1}
          parentPrefixes={[]}
        />
      ))}
    </Box>
  );
}
