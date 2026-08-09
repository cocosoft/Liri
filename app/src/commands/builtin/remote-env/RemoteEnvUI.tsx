import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface RemoteEnvUIProps {
  onDone?: () => void;
  args?: string;
}

export function RemoteEnvUI({ onDone, args = '' }: RemoteEnvUIProps) {
  return (
    <CommandUI
      commandName="remote-env"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'remoteEnvCommand',
          args
        )
      }
    />
  );
}
