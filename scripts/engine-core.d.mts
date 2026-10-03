// Types for the parts of the engine the app calls directly.
export const METRICS: string[];
export const FLAGS: string[];
export interface EngineSymbol {
  s: string;
  idx: string | null;
  sector: string | null;
  fo: boolean;
  etf: boolean;
  n: number;
  date: Int32Array;
  o: Float32Array;
  h: Float32Array;
  l: Float32Array;
  c: Float32Array;
  m: Record<string, Float32Array>;
  f: Record<string, Uint8Array>;
}
export interface Universe { dates: number[]; symbols: EngineSymbol[]; base: Map<number, Map<number, number>> }
export function run(
  universe: Universe,
  opts: { filters: unknown; hold?: number; stop?: number | null; target?: number | null; cost?: number; from?: number; to?: number },
): unknown;
