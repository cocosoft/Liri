// Global type declarations for Ink

declare module '*.tsx' {
  import React from 'react';
  const Component: React.FC<any>;
  export default Component;
}

declare module '*.ts' {
  const value: any;
  export default value;
}

declare module './components/AlternateScreen' {
  export default function AlternateScreen(props: Record<string, unknown>): JSX.Element;
}

declare module './components/NoSelect' {
  export default function NoSelect(props: Record<string, unknown>): JSX.Element;
}

declare module './components/RawAnsi' {
  export default function RawAnsi(props: Record<string, unknown>): JSX.Element;
}

// Add any other global type declarations here

declare module 'lodash-es/noop.js' {
  const noop: (...args: any[]) => any;
  export default noop;
}

declare module 'lodash-es/throttle.js' {
  import throttle from 'lodash-es';
  export default throttle;
}

declare module 'react-reconciler' {
  export interface FiberRoot {
    [key: string]: any;
  }
  const createReconciler: (config: any) => any;
  export default createReconciler;
}

declare module 'react-reconciler/constants.js' {
  export const ConcurrentRoot: number;
  export const LegacyRoot: number;
  export const ContinuousEventPriority: number;
  export const DefaultEventPriority: number;
  export const DiscreteEventPriority: number;
  export const NoEventPriority: number;
}

declare module 'react/compiler-runtime' {
  export function c(size: number): any[];
}
