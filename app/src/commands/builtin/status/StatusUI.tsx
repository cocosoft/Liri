//
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

interface StatusInfo {
  commands: number;
  uptime: number;
  memory: { rss: number; heapTotal: number; heapUsed: number };
  nodeVersion: string;
  platform: string;
  arch: string;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

interface StatusUIProps {
  onDone?: () => void;
}

export function StatusUI({ onDone }: StatusUIProps) {
  const [statusInfo, setStatusInfo] = useState<StatusInfo | null>(null);

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const { getCommandManager } =
          await import('../../manager/CommandManager.js');
        const commandManager = getCommandManager();
        setStatusInfo({
          commands: commandManager.getCommandCount(),
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
        });
      } catch {
        setStatusInfo({
          commands: 0,
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
        });
      }
    };
    loadStatus();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      onDone?.();
    }, 3000);
    return () => clearTimeout(timer);
  }, [onDone]);

  if (!statusInfo) {
    return (
      <Box>
        <Text>Loading status...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold underline>
          Liri System Status
        </Text>
      </Box>
      <Box flexDirection="column">
        <Box>
          <Text bold>Commands: </Text>
          <Text>{statusInfo.commands} loaded</Text>
        </Box>
        <Box>
          <Text bold>Uptime: </Text>
          <Text>{formatUptime(statusInfo.uptime)}</Text>
        </Box>
        <Box>
          <Text bold>Memory: </Text>
          <Text>
            RSS: {formatBytes(statusInfo.memory.rss)} | Heap:{' '}
            {formatBytes(statusInfo.memory.heapUsed)} /{' '}
            {formatBytes(statusInfo.memory.heapTotal)}
          </Text>
        </Box>
        <Box>
          <Text bold>Platform: </Text>
          <Text>
            {statusInfo.platform} ({statusInfo.arch})
          </Text>
        </Box>
        <Box>
          <Text bold>Node.js: </Text>
          <Text>v{statusInfo.nodeVersion}</Text>
        </Box>
      </Box>
    </Box>
  );
}
