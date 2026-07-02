// Global type declarations for Ink

declare module 'bun:test' {
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function describe(name: string, fn: () => void): void;
  export function expect(value: unknown): any;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
}

declare module '*.tsx' {
  import React from 'react';
  const Component: React.FC<any>;
  export default Component;
}

declare module '*.ts' {
  const value: any;
  export default value;
}

// Add any other global type declarations here

// Missing module declarations
declare module 'bidi-js';
declare module 'stack-utils';
declare module 'semver';

// Bun global declaration
declare const Bun: {
  stringWidth:
    | ((str: string, opts?: { ambiguousIsNarrow?: boolean }) => number)
    | undefined;
  wrapAnsi:
    | ((
        input: string,
        columns: number,
        options?: { hard?: boolean; wordWrap?: boolean; trim?: boolean }
      ) => string)
    | undefined;
  file: (path: string) => {
    exists: () => Promise<boolean>;
    text: () => Promise<string>;
    json: () => Promise<unknown>;
    arrayBuffer: () => Promise<ArrayBuffer>;
  };
};

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
