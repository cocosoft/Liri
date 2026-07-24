// MIT License
// Copyright (c) 2026 190615273@qq.com

import React from 'react';
import { Text, Box } from '../../../components/ink.js';

interface KnowledgeSearchItem {
  docPath: string;
  title: string;
  score: number;
  category: string;
  snippet: string;
  matchType?: string;
}

interface KnowledgeSearchOutput {
  query?: string;
  items?: KnowledgeSearchItem[];
  total?: number;
  tookMs?: number;
}

function parseOutput(output: any): KnowledgeSearchOutput {
  if (typeof output === 'string') {
    try {
      return JSON.parse(output);
    } catch {
      return { items: [] };
    }
  }
  if (Array.isArray(output)) {
    return { items: output };
  }
  return output || { items: [] };
}

function scoreColor(score: number): string {
  if (score >= 0.7) return 'green';
  if (score >= 0.4) return 'yellow';
  return 'grey';
}

export function renderToolUseMessage(
  input: Partial<{ query: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { query } = input;
  if (!query) return null;

  if (verbose) {
    return (
      <Box flexDirection="row">
        <Text dimColor>Searching knowledge base for </Text>
        <Text bold>{query}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text dimColor>Knowledge search: </Text>
      <Text bold>{query.slice(0, 60)}</Text>
    </Box>
  );
}

export function renderToolResultMessage(
  output: any,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const parsed = parseOutput(output);
  const items = parsed.items ?? [];
  const total = parsed.total ?? items.length;

  if (items.length === 0) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>No knowledge found</Text>
          {parsed.query && <Text dimColor> for "{parsed.query}"</Text>}
        </Box>
        {(!parsed.total || parsed.total === 0) && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>知识库当前为空。添加知识的方法：</Text>
            <Box marginLeft={2}>
              <Text dimColor> 1. 使用 knowledge_write 工具写入</Text>
              <Text dimColor> 2. 将 .md 文件放入 ~/.pyapp/knowledge/ 目录</Text>
              <Text dimColor> 3. 使用 knowledge_import 批量导入</Text>
            </Box>
          </Box>
        )}
      </Box>
    );
  }

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text bold>{total}</Text>
          <Text> results</Text>
          {parsed.query && (
            <Text>
              {' '}
              for <Text italic>{parsed.query}</Text>
            </Text>
          )}
          {parsed.tookMs != null && <Text dimColor> ({parsed.tookMs}ms)</Text>}
        </Box>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {items.slice(0, 10).map((item, i) => (
            <Box key={i} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
              <Box flexDirection="row">
                <Text bold>{item.title}</Text>
                <Text color={scoreColor(item.score)}>
                  {' '}
                  [{item.score.toFixed(2)}]
                </Text>
                {item.category && <Text dimColor> {item.category}</Text>}
              </Box>
              <Text dimColor>{item.snippet?.slice(0, 200)}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text bold>{total}</Text>
        <Text> knowledge results</Text>
        {parsed.query && (
          <Text>
            {' '}
            for <Text italic>{parsed.query}</Text>
          </Text>
        )}
      </Box>
      <Box marginTop={1} marginLeft={2} flexDirection="column">
        {items.slice(0, 5).map((item, i) => (
          <Box key={i} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
            <Box flexDirection="row">
              <Text bold>{item.title}</Text>
              <Text color={scoreColor(item.score)}>
                {' '}
                [{item.score.toFixed(2)}]
              </Text>
            </Box>
            <Text dimColor>{item.snippet?.slice(0, 120)}</Text>
          </Box>
        ))}
        {total > 5 && <Text dimColor>... {total - 5} more results</Text>}
      </Box>
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  if (!verbose) {
    return <Text color="red">Knowledge search failed</Text>;
  }
  return <Text color="red">Knowledge search failed: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ query: string }> | undefined
): string | null {
  if (!input?.query) return null;
  return `Knowledge search: ${input.query.slice(0, 60)}`;
}
