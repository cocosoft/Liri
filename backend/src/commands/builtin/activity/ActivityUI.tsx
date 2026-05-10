import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ActivityUIProps {
  onDone?: () => void;
  args?: string;
}

export function ActivityUI({ onDone, args = '' }: ActivityUIProps) {
  return (
    <CommandUI
      commandName="activity"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'activityCommand', args)
      }
    />
  );
}
