import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface PlanUIProps {
  onDone?: () => void;
  args?: string;
}

export function PlanUI({ onDone, args = '' }: PlanUIProps) {
  return (
    <CommandUI
      commandName="plan"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'planCommand',
          args
        )
      }
    />
  );
}
