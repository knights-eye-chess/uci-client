export type SearchLimit = { depth: number; nodes?: never; movetime?: never } |
  { nodes: number; depth?: never; movetime?: never } |
  { movetime: number; depth?: never; nodes?: never };
export interface EngineProfile {
  id: string;
  command: string;
  args: string[];
  setoptions?: Record<string, string | number | boolean>;
  capabilities: { depth: boolean; nodes: boolean; movetime: boolean; multiPv: boolean;
    searchmoves: boolean; wdl: boolean; moveStats: boolean };
  engineBuild?: string;
  weightsId?: string;
  /** Optional engine-specific extension. Only enabled when moveStats is declared. */
  parseMoveStats?: (line: string) => { move: string; prior: number } | null;
  /** Optional non-UCI diagnostic command, for engines which document one. */
  compilerCommand?: string;
}
export interface EnginePort { postMessage(command: string): void; terminate(): void }
export type EngineAcquire = (label: string, onData: (line: string) => void) => EnginePort;
export interface SearchRequest {
  fen: string;
  limit: SearchLimit;
  multiPv?: number;
  rootMoves?: string[];
  /** Require every named root to be scored; use for complete comparisons. */
  requireRootCoverage?: boolean;
  signal?: AbortSignal;
}
export interface ScoreProvenance {
  kind: 'root-search'; fen: string; originatingDepth: number; reportedDepth: number;
  engineBuild: string; requestedLimit: SearchLimit; weightsId?: string;
}
export interface EngineLine {
  multipv: number; depth: number; scoreCp: number | null; mate: number | null; pv: string[];
  wdl?: { win: number; draw: number; loss: number };
  scoreProvenance: ScoreProvenance;
  nodes?: number | null;
}
export interface PositionAnalysis extends EngineLine {
  noMove: false; engineBuild: string; weightsId?: string;
  bestmove: string; candidates: EngineLine[];
  moveStats?: Record<string, { prior: number }>;
  nodes?: number | null;
}
/** The engine emitted `bestmove (none)` without scored root lines. This is not
 * proof of checkmate, stalemate, or any other chess terminal condition. */
export interface NoMoveAnalysis {
  noMove: true; engineBuild: string; weightsId?: string;
  bestmove: null; candidates: []; nodes?: number | null;
}
export interface UciClient { search(request: SearchRequest): Promise<PositionAnalysis | NoMoveAnalysis> }
export declare function validProfile(profile: unknown): profile is EngineProfile;
export declare function createUciClient(acquire: EngineAcquire,
  options: { profile: EngineProfile; timeoutMs?: number }): UciClient;
