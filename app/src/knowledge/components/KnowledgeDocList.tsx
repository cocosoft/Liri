// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 知识库文档列表组件 — KnowledgeDocList
 *
 * 使用 Table 组件渲染知识库文档列表，支持按分类/域查看。
 */

import React from 'react';
import { Text, Box } from '../../components/ink.js';
import {
  Table,
  TableColumn,
  truncateToWidth,
} from '../../components/ui/Table.js';

export interface KnowledgeDocSummary {
  title: string;
  category: string;
  wordCount: number;
  lastModified: string;
  tags: string[];
  path: string;
}

interface Props {
  docs: KnowledgeDocSummary[];
  total: number;
  title?: string;
}

export function KnowledgeDocList({
  docs,
  total,
  title,
}: Props): React.ReactNode {
  if (docs.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text dimColor>知识库为空。使用 knowledge_write 添加文档。</Text>
      </Box>
    );
  }

  const columns: TableColumn[] = [
    { header: 'Title', key: 'title', width: 30 },
    { header: 'Category', key: 'category', width: 15 },
    { header: 'Words', key: 'wordCount', width: 8 },
    { header: 'Updated', key: 'lastModified', width: 12 },
    { header: 'Tags', key: 'tagsStr', width: 20 },
  ];

  const rows = docs.slice(0, 20).map((d) => ({
    // P3-1：按显示宽度截断，中文标题不撑破列宽
    title: truncateToWidth(d.title, 28),
    category: d.category,
    wordCount: String(d.wordCount),
    lastModified: d.lastModified?.slice(0, 10) || '',
    tagsStr: d.tags?.slice(0, 3).join(', ') || '',
  }));

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" marginBottom={1}>
        <Text bold>{title || '知识库文档'}</Text>
        <Text dimColor> ({total} total)</Text>
      </Box>
      <Table columns={columns} data={rows} />
      {total > 20 && (
        <Box marginTop={1}>
          <Text dimColor>... 还有 {total - 20} 篇文档</Text>
        </Box>
      )}
    </Box>
  );
}

/** 按分类统计 */
export function KnowledgeStatsPanel({
  total,
  categories,
}: {
  total: number;
  categories: Array<{ name: string; count: number }>;
}): React.ReactNode {
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box flexDirection="row" marginBottom={1}>
        <Text bold>知识库统计</Text>
        <Text dimColor> · {total} 篇文档</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {categories.map((c, i) => (
          <Box key={i} flexDirection="row">
            <Text>{c.name}</Text>
            <Text dimColor>: {c.count}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
