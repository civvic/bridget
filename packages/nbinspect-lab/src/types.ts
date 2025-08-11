/**
 * @fileoverview Shared types for the nbinspect-lab extension.
 * Based on the types from the VSCode extension.
 */

/**
 * Represents the content and metadata of a single notebook cell.
 */
export interface StateCell {
  cell_type: 'raw' | 'markdown' | 'code';
  source: string;
  metadata: any;
  outputs?: any[];
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
  cells: { idx: number; cell: StateCell }[];
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
  cells: { idx: number; cell: StateCell }[];
  nbData?: NBData;
  reqId?: string;
  message?: string;
}

/**
 * Global API interface for external components to interact with the notebook state.
 * Available as window.$Ren in both VSCode and Lab extensions.
 */
export interface NBStateAPI {
  /** Add a callback to be called when the notebook state changes */
  addStateObserver(callback: (state: DiffsMessage | StateMessage) => void): () => void;
  /** Get current notebook state */
  getNBState(): DiffsMessage | StateMessage | null;
  /** Update method for compatibility (VSCode-specific) */
  update?(message: any): void;
  /** Async update method for compatibility (VSCode-specific) */
  aupdate?(message: any): Promise<void>;
}

// Extend the global Window interface to include our API
declare global {
  interface Window {
    $Ren?: NBStateAPI;
    $NotebookState?: any;
  }
} 