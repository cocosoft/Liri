import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface UpgradeUIProps {
  onDone?: () => void;
  args?: string;
}

export function UpgradeUI({ onDone, args = '' }: UpgradeUIProps) {
  return (
    <CommandUI
      commandName="upgrade"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'upgradeCommand', args)
      }
    />
  );
}
