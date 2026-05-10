import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface InstallSlackAppUIProps {
  onDone?: () => void;
  args?: string;
}

export function InstallSlackAppUI({
  onDone,
  args = '',
}: InstallSlackAppUIProps) {
  return (
    <CommandUI
      commandName="install-slack-app"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('./index.js'),
          'installSlackAppCommand',
          args
        )
      }
    />
  );
}
