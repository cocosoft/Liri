import 'react';

// Augment React's JSX namespace for custom ink elements
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': any;
      'ink-text': any;
      'ink-link': any;
      'ink-raw-ansi': any;
    }
  }
}

// Augment ink's Text component to accept dimColor prop
declare module 'ink' {
  interface TextProps {
    dimColor?: boolean;
  }
}
