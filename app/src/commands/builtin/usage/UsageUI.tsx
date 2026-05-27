import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface UsageUIProps {
  onDone?: () => void;
  args?: string;
}

export function UsageUI({ onDone, args = '' }: UsageUIProps) {
  return (
    <CommandUI
      commandName="usage"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'usageCommand', args)
      }
    />
  );
}
