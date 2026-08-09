import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface DoctorUIProps {
  onDone?: () => void;
  args?: string;
}

export function DoctorUI({ onDone, args = '' }: DoctorUIProps) {
  return (
    <CommandUI
      commandName="doctor"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'doctorCommand',
          args
        )
      }
    />
  );
}
