/**
 * FileLink 组件 — 文件路径链接
 *
 * 在终端中渲染文件路径为可识别的样式（蓝色下划线），
 * 并通过系统默认方式打开文件（当前进程内执行 shell 命令）。
 */
import React, { useState } from 'react';
import { Text, Box } from '../ink.js';
import { spawn } from 'child_process';

interface FileLinkProps {
  filePath: string;
  onPreview?: (path: string) => void;
}

function FileLink({ filePath, onPreview }: FileLinkProps): React.ReactNode {
  const [opening, setOpening] = useState(false);

  const handleOpen = async () => {
    if (opening) return;
    setOpening(true);

    try {
      if (onPreview) {
        onPreview(filePath);
      } else {
        // 跨平台打开文件
        const cmd =
          process.platform === 'win32'
            ? 'start'
            : process.platform === 'darwin'
              ? 'open'
              : 'xdg-open';
        spawn(cmd, [filePath], { detached: true, stdio: 'ignore' }).unref();
      }
    } catch (err) {
      console.error('打开文件失败:', err);
    } finally {
      setOpening(false);
    }
  };

  return (
    <Box>
      <Text color="cyan" underline>
        {filePath}
      </Text>
      <Text color="gray"> </Text>
    </Box>
  );
}

export default FileLink;
