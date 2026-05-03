export interface Cursor {
  x: number;
  y: number;
  save(): void;
  restore(): void;
  moveTo(x: number, y: number): void;
  reset(): void;
}
