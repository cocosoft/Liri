import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface PluginsUIProps {
  onDone?: () => void;
  args?: string;
}

export function PluginsUI({ onDone, args = '' }: PluginsUIProps) {
  return (
    <CommandUI
      commandName="plugins"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'pluginsCommand',
          args
        )
      }
    />
  );
}
