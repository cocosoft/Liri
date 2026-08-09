import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface LogoutUIProps {
  onDone?: () => void;
  args?: string;
}

export function LogoutUI({ onDone, args = '' }: LogoutUIProps) {
  return (
    <CommandUI
      commandName="logout"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'logoutCommand',
          args
        )
      }
    />
  );
}
