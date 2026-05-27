import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface WorkspaceUIProps {
  onDone?: () => void;
  args?: string;
}

export function WorkspaceUI({ onDone, args = '' }: WorkspaceUIProps) {
  return (
    <CommandUI
      commandName="workspace"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'workspaceCommand', args)
      }
    />
  );
}
