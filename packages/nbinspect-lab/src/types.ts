/**
 * @fileoverview Shared types for the nbinspect-lab extension.
 * Based on the types from the VSCode extension.
 */

/**
 * Represents the content and metadata of a single notebook cell.
 */
export interface StateCell {
  idx: number;
  id: string;
  cell_type: 'raw' | 'markdown' | 'code';
  source: string;
  metadata: any;
  outputs?: any[];
  execution_count?: number;
}

/**
 * Notebook-level metadata.
 */
export interface NBData {
  cellCount: number;
  metadata?: any;
  notebookType?: string;
  notebookUri?: string;
}

/**
 * Represents a set of changes in the notebook structure or content.
 */
export interface StateChange {
  /** State cells for cells that were added or changed. */
  cells: StateCell[];
  /** Indices of added cells. */
  added?: number[];
  /** Indices of removed cells. */
  removed?: number[];
  /** Total number of cells after the change. */
  cellCount: number;
}

/**
 * A message containing a series of notebook changes (diffs).
 */
export interface DiffsMessage {
  type: 'diffs';
  origin: string;
  timestamp: number;
  changes: StateChange[];
  nbData?: NBData;
  reqId?: string;
  message?: string;
}

/**
 * A message containing the full state of the notebook.
 */
export interface StateMessage {
  type: 'state';
  origin: string;
  timestamp: number;
  cells: StateCell[];
  nbData?: NBData;
  reqId?: string;
  message?: string;
}

/** 
 * A message containing the options for the MIME renderer.
 */
export interface MIMEMessage {
  id: string;
  update: 'full' | 'diff' | 'opts' | null;
  feedback?: boolean;
  hide?: boolean;
  debug?: boolean;
}

/**
 * Global API interface for external components to interact with the notebook state.
 * Available as window.$Nb in both VSCode and Lab extensions.
 */
export interface NBStateAPI {
  _sessionId: string;
  /** Add a callback to be called when the notebook state changes */
  addStateObserver(callback: (state: DiffsMessage | StateMessage) => void): () => void;
  /** Get current notebook state */
  getNBState(): DiffsMessage | StateMessage | null;
  /** Request update of the notebook state*/
  update?(message: MIMEMessage): void;
  /** Async request update of the notebook state */
  aupdate?(message: MIMEMessage): Promise<DiffsMessage | StateMessage>;
}

/**
 * Change summary for tracking individual cell changes
 */
export interface ChangeSummary {
  documentChanged?: boolean;
  metadataChanged?: boolean;
  outputsChanged?: boolean;
  executionChanged?: boolean;
  metadataExecutionCount?: number | null;
  executionStatus?: 'running' | 'finished';
  update(changeType: string): void;
  updateExecution(executionStatus: 'running' | 'finished'): void;
  updateMetadata(execution_count: number | null): void;
}

/**
 * A cell indexes added at starting index
 */
export interface Added {
  start: number;
  cellIdxs: number[];
}

/**
 * A cell indexes removed at starting index
 */
export interface Removed {
  start: number;
  end: number;
}

/**
 * A diff between two notebook states
 */
export interface Diff {
  cellIdxs: number[];
  added: Added[];
  removed: Removed[];
  cellCount: number;
}

/**
 * Represents the persistent state for a notebook session.
 * Managed by NotebookMonitor, stored by SessionManager.
 */
export interface SessionState {
  /** Current notebook state (diffs or full state) */
  currentState: DiffsMessage | StateMessage | null;
  /** List of observer callbacks that persist across monitor recreation */
  stateObservers: Array<(state: DiffsMessage | StateMessage) => void>;
  /** Bridge object for Bridget functionality */
  bridge: any;
  /** BrdImport object for Bridget functionality */
  brdimport: any;
  /** The kernel ID this session was created for */
  kernelId: string | null;
  /** Session creation timestamp */
  createdAt: number;
  /** Last access timestamp */
  lastAccessedAt: number;
}

// Extend the global Window interface to include our API
declare global {
  interface Window {
    $Nb?: NBStateAPI;
    bridge?: any;
    brdimport?: any;
  }
}
