// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 知识库质量面板 — KnowledgeQualityPanel
 *
 * 展示 Lint 结果、编译状态、健康度指标。
 */

import React from 'react';
import { Text, Box } from '../../components/ink.js';
import { ProgressBar } from '../../components/ui/ProgressBar.js';

export interface LintIssue {
  severity: 'error' | 'warning' | 'info';
  file: string;
  message: string;
  category?: string;
}

interface LintPanelProps {
  issues: LintIssue[];
  totalDocs?: number;
}

export function KnowledgeLintPanel({
  issues,
  totalDocs,
}: LintPanelProps): React.ReactNode {
  if (issues.length === 0) {
    return (
      <Box flexDirection="row">
        <Text color="green">All checks passed</Text>
        {totalDocs != null && <Text dimColor> ({totalDocs} docs)</Text>}
      </Box>
    );
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" marginBottom={1}>
        <Text bold>知识库健康检查</Text>
        {totalDocs != null && <Text dimColor> ({totalDocs} documents)</Text>}
      </Box>

      {errors.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color="red">Errors ({errors.length})</Text>
          {errors.slice(0, 5).map((e, i) => (
            <Box key={i} flexDirection="column" marginTop={1} marginLeft={2}>
              <Text dimColor>{e.file}</Text>
              <Text>{e.message}</Text>
            </Box>
          ))}
          {errors.length > 5 && (
            <Text dimColor>... {errors.length - 5} more errors</Text>
          )}
        </Box>
      )}

      {warnings.length > 0 && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Text color="yellow">Warnings ({warnings.length})</Text>
          {warnings.slice(0, 3).map((w, i) => (
            <Box key={i} flexDirection="row" marginLeft={2}>
              <Text dimColor>{w.file}: </Text>
              <Text>{w.message}</Text>
            </Box>
          ))}
          {warnings.length > 3 && (
            <Text dimColor>... {warnings.length - 3} more warnings</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

/** 编译状态组件 */
export function KnowledgeCompileBadge({
  status,
  lastCompile,
  compiled,
  total,
  errors,
}: {
  status: 'idle' | 'compiling' | 'done' | 'error';
  lastCompile?: string;
  compiled?: number;
  total?: number;
  errors?: number;
}): React.ReactNode {
  const statusColors: Record<string, string> = {
    idle: 'grey',
    compiling: 'yellow',
    done: 'green',
    error: 'red',
  };

  const statusText: Record<string, string> = {
    idle: 'Idle',
    compiling: 'Compiling...',
    // P3-3：compiled/total 缺失时避免显示 "Compiled 0/0"
    done:
      compiled != null && total != null
        ? `Compiled ${compiled}/${total}`
        : 'Compiled',
    error: `Failed (${errors ?? 0} errors)`,
  };

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color={statusColors[status]}> {statusText[status]}</Text>
        {lastCompile && <Text dimColor> · Last: {lastCompile}</Text>}
      </Box>
      {status === 'compiling' && compiled != null && total != null && (
        <Box marginTop={1}>
          <ProgressBar
            percent={compiled && total ? (compiled / total) * 100 : 0}
            width={30}
          />
        </Box>
      )}
    </Box>
  );
}
