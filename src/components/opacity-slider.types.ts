export type OpacitySliderProps = {
  value: number;
  minimumValue?: number;
  disabled?: boolean;
  label: string;
  testID?: string;
  onValueChange: (value: number) => void;
  onSlidingComplete: (value: number) => void;
};

export function clampOpacity(value: number, minimum = 0): number {
  const floor = Number.isFinite(minimum) ? Math.min(1, Math.max(0, minimum)) : 1;
  return Number.isFinite(value) ? Math.min(1, Math.max(floor, value)) : floor;
}
