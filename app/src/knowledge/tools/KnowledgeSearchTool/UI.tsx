// MIT License
// Copyright (c) 2026 190615273@qq.com

import React from 'react';
import { Text, Box } from '../../../components/ink.js';
import { parseToolOutput } from '../parseToolOutput.js';
import type { KnowledgeSearchOutput } from '../types.js';

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
  output: unknown,
  _progressMessages: unknown[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  // 工具 result 为 unknown：实际契约是 KnowledgeRoute[]（数组），防御对象包裹形式
  const parsed = parseToolOutput(output);
  const obj = Array.isArray(parsed)
    ? undefined
    : (parsed as {
        query?: string;
        items?: KnowledgeSearchOutput;
        total?: number;
        tookMs?: number;
      });
  const items = Array.isArray(parsed)
    ? (parsed as KnowledgeSearchOutput)
    : (obj?.items ?? []);
  const total = Array.isArray(parsed)
    ? items.length
    : (obj?.total ?? items.length);
  const query = obj?.query;
  const tookMs = obj?.tookMs;

  if (items.length === 0) {
    // P2-3：搜索无结果 ≠ 知识库为空，不做空库断言（工具未提供空库标记）
    return (
      <Box flexDirection="row">
        <Text dimColor>No knowledge found</Text>
        {query && <Text dimColor> for "{query}"</Text>}
      </Box>
    );
  }

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text bold>{total}</Text>
          <Text> results</Text>
          {query && (
            <Text>
              {' '}
              for <Text italic>{query}</Text>
            </Text>
          )}
          {tookMs != null && <Text dimColor> ({tookMs}ms)</Text>}
        </Box>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {items.slice(0, 10).map((item, i) => (
            <Box key={i} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
              <Box flexDirection="row">
                <Text bold>{item.title}</Text>
                <Text color={scoreColor(item.score)}>
                  {' '}
                  [{Number.isFinite(item.score) ? item.score.toFixed(2) : '0'}]
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
        {query && (
          <Text>
            {' '}
            for <Text italic>{query}</Text>
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
                [{Number.isFinite(item.score) ? item.score.toFixed(2) : '0'}]
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
