import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface InstallGithubAppUIProps {
  onDone?: () => void;
  args?: string;
}

export function InstallGithubAppUI({
  onDone,
  args = '',
}: InstallGithubAppUIProps) {
  return (
    <CommandUI
      commandName="install-github-app"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('./index.js'),
          'installGithubAppCommand',
          args
        )
      }
    />
  );
}
