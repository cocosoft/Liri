import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface CostUIProps {
  onDone?: () => void;
  args?: string;
}

export function CostUI({ onDone, args = '' }: CostUIProps) {
  return (
    <CommandUI
      commandName="cost"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'costCommand',
          args
        )
      }
    />
  );
}
