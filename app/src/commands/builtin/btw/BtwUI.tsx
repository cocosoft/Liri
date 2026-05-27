import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface BtwUIProps {
  onDone?: () => void;
  args?: string;
}

/**
 * 渲染 "btw" 命令的用户界面组件。
 *
 * @param onDone - 命令执行完成后的回调函数。
 * @param args - 传递给命令的参数，默认为空字符串。
 * @returns 返回一个 CommandUI 组件实例。
 */
export function BtwUI({ onDone, args = '' }: BtwUIProps) {
  return (
    <CommandUI
      commandName="btw"
      args={args}
      onDone={onDone}
      // 动态导入命令执行器并执行 btwCommand
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'btwCommand', args)
      }
    />
  );
}
