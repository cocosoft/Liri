import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface MobileUIProps {
  onDone?: () => void;
  args?: string;
}

export function MobileUI({ onDone, args = '' }: MobileUIProps) {
  return (
    <CommandUI
      commandName="mobile"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'mobileCommand',
          args
        )
      }
    />
  );
}
