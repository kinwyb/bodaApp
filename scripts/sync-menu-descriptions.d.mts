export function syncMenuDescriptions(options?: {
  root?: string;
  check?: boolean;
}): {
  bridges: number;
  written: number;
  unchanged: number;
  removed: number;
};
