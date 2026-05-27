/**
 * Spinner组件 - 加载动画
 */

import React, { useState, useEffect } from 'react';
import { Text, Box } from '../ink.js';

type SpinnerType = 'dots' | 'line' | 'dots12';

interface SpinnerProps {
  type?: SpinnerType;
  color?: string;
  text?: string;
}

const FRAMES: Record<SpinnerType, string[]> = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  line: ['-', '\\', '|', '/'],
  dots12: ['⢀', '⣀', '⣠', '⣰', '⢤', '⢆', '⣄', '⣆', '⣇', '⡏', '⠏', '⠋'],
};

export function Spinner({
  type = 'dots',
  color = 'yellow',
  text,
}: SpinnerProps): React.ReactNode {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((prev) => (prev + 1) % FRAMES[type].length);
    }, 80);

    return () => clearInterval(interval);
  }, [type]);

  return (
    <Box>
      <Text color={color}>{FRAMES[type][frame]}</Text>
      {text && <Text> {text}</Text>}
    </Box>
  );
}

interface LoadingSpinnerProps {
  message?: string;
  color?: string;
}

export function LoadingSpinner({
  message = 'Loading...',
  color = 'cyan',
}: LoadingSpinnerProps): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Box>
        <Spinner type="dots" color={color} />
        <Text color={color}> {message}</Text>
      </Box>
    </Box>
  );
}
