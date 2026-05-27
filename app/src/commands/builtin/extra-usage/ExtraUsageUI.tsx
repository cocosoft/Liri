import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ExtraUsageUIProps {
  onDone?: () => void;
  args?: string;
}

export function ExtraUsageUI({ onDone, args = '' }: ExtraUsageUIProps) {
  return (
    <CommandUI
      commandName="extra-usage"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'extraUsageCommand', args)
      }
    />
  );
}
