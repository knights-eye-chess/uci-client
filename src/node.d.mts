import type { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import type { EngineProfile, NoMoveAnalysis, PositionAnalysis, SearchRequest } from './index.mjs';

export interface NativeCpuStat {
  usageUs: number | null; userUs: number | null; systemUs: number | null;
  nrPeriods: number | null; nrThrottled: number | null; throttledUs: number | null;
}
export interface NativeSearchDiagnostics {
  schema: 'native-engine-search/1'; processReused: boolean; processInitializationMs: number;
  searchElapsedMs: number; totalElapsedMs: number; nodes: number | null; nps: number | null;
  threads: number | null; hashMb: number | null; compiler: string | null;
  binaryVariant: 'baseline' | 'avx2' | null; cpuModel: string | null;
  loadAverageBefore: [number, number, number] | null;
  loadAverageAfter: [number, number, number] | null;
  cpuQuota: { quotaUs: number | null; periodUs: number } | null;
  cpuStatBefore: NativeCpuStat | null; cpuStatAfter: NativeCpuStat | null;
  cpuStatDelta: NativeCpuStat | null;
}
export interface ProcessEngineOptions {
  profile?: EngineProfile;
  /** Compatibility with the default Stockfish profile. */
  command?: string; args?: string[]; threads?: number; hashMb?: number;
  timeoutMs?: number; handshakeTimeoutMs?: number; shutdownGraceMs?: number;
  spawnProcess?: typeof spawn; onSpawn?: (child: ChildProcessWithoutNullStreams) => void;
  reuseProcess?: boolean;
  onSearchDiagnostics?: (diagnostics: NativeSearchDiagnostics) => void;
}
export type ProcessAnalysis = (PositionAnalysis | NoMoveAnalysis) & {
  diagnostics: NativeSearchDiagnostics;
  nodes: number | null;
};
export interface ProcessEngine {
  search(request: SearchRequest): Promise<ProcessAnalysis>;
  close(): Promise<void>;
}
export declare const stockfishProfile: EngineProfile;
export declare function createProcessEngine(options?: ProcessEngineOptions): ProcessEngine;
export declare function parseCpuQuota(source: unknown): { quotaUs: number | null; periodUs: number } | null;
export declare function parseCpuStat(source: unknown): NativeCpuStat | null;
export declare function cpuStatDelta(before: NativeCpuStat | null, after: NativeCpuStat | null): NativeCpuStat | null;
export declare function readCpuSnapshot(options?: { readFile?: (path: string, encoding: string) => string;
  loadAverage?: () => number[]; platform?: string }): { cpuModel: string | null;
    loadAverage: [number, number, number] | null; cpuQuota: { quotaUs: number | null; periodUs: number } | null;
    cpuStat: NativeCpuStat | null };
