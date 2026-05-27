import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface PermissionsUIProps {
  onDone?: () => void;
  args?: string;
}

export function PermissionsUI({ onDone, args = '' }: PermissionsUIProps) {
  return (
    <CommandUI
      commandName="permissions"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'permissionsCommand', args)
      }
    />
  );
}
