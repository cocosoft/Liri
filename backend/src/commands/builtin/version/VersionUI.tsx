import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface VersionUIProps {
  onDone?: () => void;
  args?: string;
}

export function VersionUI({ onDone, args = '' }: VersionUIProps) {
  return (
    <CommandUI
      commandName="version"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'versionCommand', args)
      }
    />
  );
}
