/**
 * Ink Tree 组件
 * 用于在 CLI 中展示可展开/折叠的树形结构
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';

export interface TreeNode {
  id: string;
  label: string;
  icon?: string;
  children?: TreeNode[];
  isExpanded?: boolean;
  isSelected?: boolean;
  metadata?: Record<string, string>;
}

export interface TreeProps {
  nodes: TreeNode[];
  defaultExpanded?: boolean;
  onNodeSelect?: (node: TreeNode) => void;
  indentSize?: number;
  showIcons?: boolean;
}

const renderTreeNode = (
  node: TreeNode,
  depth: number,
  expandedIds: Set<string>,
  toggleExpand: (id: string) => void,
  onNodeSelect?: (node: TreeNode) => void,
  indentSize: number = 2,
  showIcons: boolean = true,
  isLast: boolean = false
): React.ReactElement[] => {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const indent = ' '.repeat(depth * indentSize);
  const elements: React.ReactElement[] = [];

  const prefix = depth === 0 ? '' : isLast ? '└─' : '├─';
  const connector = hasChildren ? (isExpanded ? '▼' : '▶') : ' ';
  const icon =
    showIcons && node.icon
      ? node.icon
      : hasChildren
        ? isExpanded
          ? '📂'
          : '📁'
        : '📄';

  elements.push(
    <Box key={node.id} flexDirection="row">
      <Text dimColor>
        {indent}
        {prefix}
      </Text>
      <Text
        color={node.isSelected ? 'cyan' : undefined}
        inverse={node.isSelected}
        bold={hasChildren || !!node.isSelected}
      >
        {' '}
        {connector} {icon} {node.label}
      </Text>
      {node.metadata
        ? Object.entries(node.metadata).map(([key, value]) => (
            <Text key={key} color="gray" dimColor>
              {' '}
              [{key}: {value}]
            </Text>
          ))
        : null}
    </Box>
  );

  if (hasChildren && isExpanded && node.children) {
    node.children.forEach((child, index) => {
      const childIsLast = index === node.children!.length - 1;
      elements.push(
        ...renderTreeNode(
          child,
          depth + 1,
          expandedIds,
          toggleExpand,
          onNodeSelect,
          indentSize,
          showIcons,
          childIsLast
        )
      );
    });
  }

  return elements;
};

export const Tree: React.FC<TreeProps> = ({
  nodes,
  defaultExpanded = false,
  onNodeSelect,
  indentSize = 2,
  showIcons = true,
}) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (defaultExpanded) {
      const collectIds = (items: TreeNode[]) => {
        for (const item of items) {
          initial.add(item.id);
          if (item.children) collectIds(item.children);
        }
      };
      collectIds(nodes);
    }
    return initial;
  });

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleNodeSelect = (node: TreeNode) => {
    if (node.children && node.children.length > 0) {
      toggleExpand(node.id);
    }
    onNodeSelect?.(node);
  };

  return (
    <Box flexDirection="column">
      <Box borderStyle="single" borderColor="gray" paddingX={1} paddingY={0}>
        <Text bold color="green">
          📂 Tree View
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={0}>
        {nodes.map((node, index) => {
          const isLast = index === nodes.length - 1;
          return renderTreeNode(
            node,
            0,
            expandedIds,
            toggleExpand,
            onNodeSelect,
            indentSize,
            showIcons,
            isLast
          );
        })}
      </Box>
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="gray">▶ Expand ▼ Collapse {nodes.length} root nodes</Text>
      </Box>
    </Box>
  );
};
