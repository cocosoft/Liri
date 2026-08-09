import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ReloadPluginsUIProps {
  onDone?: () => void;
  args?: string;
}

export function ReloadPluginsUI({ onDone, args = '' }: ReloadPluginsUIProps) {
  return (
    <CommandUI
      commandName="reload-plugins"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'reloadPluginsCommand',
          args
        )
      }
    />
  );
}
