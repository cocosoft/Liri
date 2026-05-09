/**
 * ProgressBar组件 - 进度条
 */

import React from 'react';
import { Text, Box } from '../ink.js';

type Color =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'gray'
  | 'redBright'
  | 'greenBright'
  | 'yellowBright'
  | 'blueBright'
  | 'magentaBright'
  | 'cyanBright'
  | 'whiteBright'
  | 'hex'
  | 'bgBlack'
  | 'bgRed'
  | 'bgGreen'
  | 'bgYellow'
  | 'bgBlue'
  | 'bgMagenta'
  | 'bgCyan'
  | 'bgWhite'
  | 'bgHex';

interface ProgressBarProps {
  percent: number;
  width?: number;
  color?: Color;
  showLabel?: boolean;
}

const BLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];

export function ProgressBar({
  percent,
  width = 40,
  color = 'green',
  showLabel = true,
}: ProgressBarProps): React.ReactNode {
  const ratio = Math.min(1, Math.max(0, percent / 100));
  const whole = Math.floor(ratio * width);

  let segments = [BLOCKS[BLOCKS.length - 1].repeat(whole)];

  if (whole < width) {
    const remainder = ratio * width - whole;
    const middle = Math.floor(remainder * BLOCKS.length);
    segments.push(BLOCKS[middle]);

    const empty = width - whole - 1;
    if (empty > 0) {
      segments.push(BLOCKS[0].repeat(empty));
    }
  }

  const bar = segments.join('');

  return (
    <Box>
      <Text color={color as Color}>{bar}</Text>
      {showLabel && <Text> {percent}%</Text>}
    </Box>
  );
}

interface ProgressBarExProps extends ProgressBarProps {
  label?: string;
  filledColor?: Color;
  emptyColor?: Color;
}

export function ProgressBarEx({
  percent,
  width = 40,
  color = 'green',
  showLabel = true,
  label,
  filledColor,
  emptyColor,
}: ProgressBarExProps): React.ReactNode {
  const ratio = Math.min(1, Math.max(0, percent / 100));
  const whole = Math.floor(ratio * width);

  let segments = [BLOCKS[BLOCKS.length - 1].repeat(whole)];

  if (whole < width) {
    const remainder = ratio * width - whole;
    const middle = Math.floor(remainder * BLOCKS.length);
    segments.push(BLOCKS[middle]);

    const empty = width - whole - 1;
    if (empty > 0) {
      segments.push(BLOCKS[0].repeat(empty));
    }
  }

  const bar = segments.join('');

  return (
    <Box flexDirection="column">
      {label && (
        <Text>
          {label}: {percent}%
        </Text>
      )}
      <Box>
        <Text
          color={filledColor as Color}
          backgroundColor={emptyColor as Color}
        >
          {bar}
        </Text>
        {showLabel && <Text> {percent}%</Text>}
      </Box>
    </Box>
  );
}
