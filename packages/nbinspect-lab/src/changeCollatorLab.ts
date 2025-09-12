import { ChangeCollator } from '../../common/changeCollator.js';
import type { ChangeSummary, Diff } from './types.js';

import { debug } from '../../common/debug.js';
const DEBUG_NAMESPACE = 'nb:collator';
const log = debug(DEBUG_NAMESPACE, 'purple');
const logError = debug(`${DEBUG_NAMESPACE}:error`, 'red');

import type { INotebookModel } from '@jupyterlab/notebook';
import type { ICellModel } from '@jupyterlab/cells';
import type { IObservableList } from '@jupyterlab/observables';

/**
 * Lab-specific unified event structure (similar to VSCode's NotebookDocumentChangeEvent)
 */
export interface LabNotebookEvent {
  /** Array of individual cell changes */
  cellChanges?: LabCellChange[];
  /** Array of structural changes (add/remove/move) */
  contentChanges?: LabContentChange[];
  /** Notebook-level metadata changes */
  metadata?: any;
  /** Optional timestamp for the event */
  timestamp?: number;
}

/**
 * Lab-specific cell change (similar to VSCode's NotebookDocumentCellChange)
 */
export interface LabCellChange {
  /** The cell model that changed */
  cell: ICellModel;
  /** The Yjs change details */
  change: any; // CellChange from @jupyter/ydoc
}

/**
 * Lab-specific content change (similar to VSCode's NotebookDocumentContentChange)
 */
export interface LabContentChange {
  /** The observable list change */
  change: any; // IObservableList.IChangedArgs<ICellModel>
}

/**
 * Concrete implementation of ChangeCollator for JupyterLab Notebooks.
 * Translates JupyterLab/Yjs cell and model changes into calls
 * to the abstract ChangeCollator base class methods.
 */
export class ChangeCollatorLab extends ChangeCollator {
  /** The JupyterLab notebook model */
  private _model: INotebookModel;

  declare documentChanges: Set<number>;
  declare added: any[];
  declare removed: any[];
  declare full: Map<number, any>;

  declare getSummary: (cellIndex: number, summaryType: string) => ChangeSummary;
  declare _recordCellAddition: (args: { startIndex: number, addedCellIndexes: number[] }) => void;
  declare _recordCellRemoval: (args: { startIndex: number, endIndex: number, removedCount: number }) => void;
  declare _recordNotebookMetadataChange: (args: { metadata: any }) => void;
  declare _recordCellMetadataChange: (cellIndex: number, metadata: any) => void;
  declare _recordOutputsUpdate: (cellIndex: number, outputsChange: any) => void;
  declare _recordExecutionUpdate: (cellIndex: number, executionStatus: string) => void;
  declare setDocumentChanges: (cellIdxs: number[]) => void;
  declare _setFull: (cellIndex: number, summary: any) => void;
  declare addDiff: () => void;
  declare getDiffs: () => Diff[];

  declare readonly isEmpty: boolean;

  declare pending: Set<number>;
  declare cellCount: number;

  // Map methods (inherited from Map via ChangeCollator)
  declare keys: () => IterableIterator<number>;
  declare delete: (key: number) => boolean;
  declare get: (key: number) => any;
  
  /**
   * Creates an instance of ChangeCollatorLab.
   * @param model The notebook model to monitor.
   */
  constructor(model: INotebookModel) {
    if (!model) {
      throw new Error('ChangeCollatorLab requires a valid INotebookModel.');
    }
    const initialCellCount = model.cells.length;
    super(initialCellCount); // Pass initial cell count to base
    this._model = model;
    log('Initialized ChangeCollatorLab with cell count:', initialCellCount);
  }

  /**
   * Processes changes originating from a specific cell's shared model.
   * 
   * This method implements refined execution state mapping that handles the complete
   * range of JupyterLab kernel states, aligning with VSCode's approach of tracking
   * execution cycles as 'running' → 'finished' transitions.
   * 
   * JupyterLab Kernel States:
   * - Active: 'running', 'busy', 'starting' → mapped to 'running'
   * - Completed: 'idle' (from active) → mapped to 'finished'
   * - Interrupted: 'dead', 'terminating', restart-from-active → mapped to 'finished'
   * 
   * @param cellModel The cell model whose shared model changed.
   * @param change The details of the change from Yjs.
   */
  addCellChange(cellModel: ICellModel, change: any): void {
    const cellId = cellModel.id;
    const cellIndex = this.getCellIndexById(cellId);
    if (cellIndex === -1) {
      logError(`addCellChange: Could not find index for cell ID ${cellId}. Ignoring change.`);
      return;
    }
    const { sourceChange, attachmentsChange, outputsChange, 
      executionCountChange, executionStateChange } = change;
    
    // Note: sourceChange is now handled separately via document change deferral
    // and will be processed through setDocumentChanges() when appropriate
    if (sourceChange) {
      log(`Cell #${cellIndex}: Source change deferred (will be processed on selection change)`);
      return; // Don't process source changes immediately
    }
    
    // Log other changes for debugging
    if (attachmentsChange || outputsChange || executionCountChange || executionStateChange) {
      log(`Cell #${cellIndex}: addCellChange`, JSON.stringify(change));
    }
    
    if (executionCountChange) {
      const count = executionCountChange?.newValue ?? (cellModel as any).execution_count;
      this._recordCellMetadataChange(cellIndex, { execution_count: count });
    }
    if (outputsChange) this._recordOutputsUpdate(cellIndex, outputsChange);
    if (executionStateChange) {
      const newState = executionStateChange.newValue;
      const oldState = executionStateChange.oldValue;
      
      // execution state mapping to handle complete JupyterLab kernel state range
      // Reference: https://jupyterlab.readthedocs.io/en/latest/api/modules/services.kernel.html
      // Valid states: "unknown" | "starting" | "idle" | "busy" | "terminating" | "restarting" | "autorestarting" | "dead"
      if (newState === 'idle' && oldState === undefined) {
        // clear output probably
        this._recordExecutionUpdate(cellIndex, 'finished');
        log(`Cell #${cellIndex}: Execution idle (no previous state)`);
        // const summary = this.getSummary(cellIndex, 'execution');
        // if (summary) {
        //   this._setFull(cellIndex, summary);
        //   log(`Cell #${cellIndex}: Execution idle (no previous state)`);
        // } else {
        //   this._setFull(cellIndex, summary);
        //   log(`Cell #${cellIndex}: Unhandled execution state transition (${oldState} → ${newState})`);
        // }
      } else if (this._isExecutionActiveState(newState)) {
        // States indicating execution is active/starting
        this._recordExecutionUpdate(cellIndex, 'running');
        log(`#${cellIndex}: exe started (${oldState} → ${newState})`);
      } else if (this._isExecutionFinishedState(newState, oldState)) {
        // States indicating execution completed (successfully or with error)
        this._recordExecutionUpdate(cellIndex, 'finished');
        log(`#${cellIndex}: exe finished (${oldState} → ${newState})`);
      } else if (this._isExecutionInterruptedState(newState, oldState)) {
        // States indicating execution was interrupted/failed
        this._recordExecutionUpdate(cellIndex, 'finished');
        log(`#${cellIndex}: exe interrupted/failed (${oldState} → ${newState})`);
      } else {
        // Log unhandled state transitions for debugging
        log(`#${cellIndex}: Unhandled exe state transition (${oldState} → ${newState})`);
      }
    }
    if (attachmentsChange) {
      log(`#${cellIndex}: Attachments changed (not processed by base class)`);
    }
  }

  /**
   * Processes changes to the list of cells in the notebook model (add/remove/move).
   * @param change Change details.
   */
  addCellsListChange(change: any): void {
    const { type, oldIndex, newIndex, oldValues, newValues } = change;
    const currentCellCount = this._model.cells.length;

    switch (type) {
      case 'add': {
        const addedIndexes = newValues.map((cell: ICellModel) => this.getCellIndexById(cell.id));
        const validAddedIndexes = addedIndexes.filter((idx: number) => idx !== -1);
        if (validAddedIndexes.length !== newValues.length) {
            logError('Could not find indexes for all added cells.');
        }
        this._recordCellAddition({ startIndex: newIndex, addedCellIndexes: validAddedIndexes });
        break;
      }

      case 'remove': {
        const removedCount = oldValues.length;
        const endIndex = oldIndex + removedCount;
        this._recordCellRemoval({ startIndex: oldIndex, endIndex: endIndex, removedCount: removedCount });
        break;
      }

      case 'move':
        log(`... Cell Moved: From index ${oldIndex} to ${newIndex}. Base class handles via remove/add interpretation.`);
        break;

      case 'set':
        logError(`... Cell Set: Changed type 'set' at index ${newIndex} is unexpected. ChangeCollator base class might not handle this perfectly.`);
        break;
    }
  }

  /**
   * Helper to get the current index of a cell by its ID.
   * @param cellId The ID of the cell to find.
   * @returns The current index, or -1 if not found.
   */
  getCellIndexById(cellId: string): number {
    if (this._model) {
      const cells = this._model.cells;
      for (let i = 0; i < cells.length; i++) {
        if (cells.get(i).id === cellId) {
          return i;
        }
      }
    }
    return -1;
  }

  /**
   * Determines if a kernel state indicates active execution.
   * @param state - The kernel execution state
   * @returns True if the state indicates active execution
   */
  private _isExecutionActiveState(state: string): boolean {
    // States that indicate cell execution is actively running
    return state === 'running' || state === 'busy' || state === 'starting';
  }

  /**
   * Determines if a kernel state transition indicates completed execution.
   * @param newState - The new kernel execution state
   * @param oldState - The previous kernel execution state
   * @returns True if the transition indicates completed execution
   */
  private _isExecutionFinishedState(newState: string, oldState: string): boolean {
    // Transition to 'idle' from an active execution state indicates completion
    return newState === 'idle' && this._isExecutionActiveState(oldState);
  }

  /**
   * Determines if a kernel state indicates interrupted/failed execution.
   * @param newState - The new kernel execution state
   * @param oldState - The previous kernel execution state
   * @returns True if the state indicates interrupted/failed execution
   */
  private _isExecutionInterruptedState(newState: string, oldState: string): boolean {
    // States that indicate execution was interrupted, terminated, or failed
    // We treat these as "finished" since the execution cycle has ended
    if (newState === 'dead' || newState === 'terminating') {
      return true;
    }
    
    // Restart states might interrupt ongoing execution
    if ((newState === 'restarting' || newState === 'autorestarting') && 
        this._isExecutionActiveState(oldState)) {
      return true;
    }
    
    return false;
  }

  /**
   * Lab-specific cleanup method.
   * Removes "dangling" change summaries - cells that appear to be executing
   * but are actually in an inconsistent state (empty, no outputs, no execution count).
   */
  cleanup(): void {
    const indexes = [...this.keys()];
    const cleaned = [];
    
    indexes.forEach(idx => {
      const summary = this.get(idx);
      // Check if the summary represents a potentially dangling execution state:
      if (summary && summary.executionChanged && summary.executionStatus === 'running') {
        try {
          // Get the actual cell from the JupyterLab model
          const cellModel = this._model.cells.get(idx);
          
          if (cellModel) {
            // Check if cell is in a "dangling" state:
            // - No outputs
            // - No execution count
            // - Empty or whitespace-only source
            const hasOutputs = (cellModel as any).outputs && (cellModel as any).outputs.length > 0;
            const hasExecutionCount = (cellModel as any).execution_count !== null && (cellModel as any).execution_count !== undefined;
            const hasContent = (cellModel as any).source && (cellModel as any).source.trim().length > 0;
            
            if (!hasOutputs && !hasExecutionCount && !hasContent) {
              log(`Cleaning up dangling summary for empty cell ${idx}`);
              this.delete(idx);
              this.pending.delete(idx);
              cleaned.push(idx);
            }
          } else {
            // Cell no longer exists in the model - definitely dangling
            logError(`Cell ${idx} no longer exists in model during cleanup`);
            this.delete(idx);
            this.pending.delete(idx);
            cleaned.push(idx);
          }
        } catch (e) {
          logError(`Error accessing cell ${idx} during cleanup:`, e);
          // If we can't access the cell, assume it's dangling and remove it
          this.delete(idx);
          this.pending.delete(idx);
          cleaned.push(idx);
        }
      }
    });
    
    if (cleaned.length > 0) {
      log(`ChangeCollatorLab cleanup: Removed ${cleaned.length} dangling summaries`);
    }
  }

  /**
   * Lab-specific summary method for debugging.
   * Calls the base class showSummary method.
   */
  showSummary(): void {
    if (!log.enabled) return;
    // log('**** ChangeCollatorLab Summary ****');
    // Call the base class showSummary method
    super.showSummary();
  }

  /**
   * Unified event processing method (VSCode-style pattern for Lab).
   * Processes a unified Lab notebook event containing cell changes, content changes, and metadata.
   * @param evt - The unified Lab event object
   * @param timestamp - Optional timestamp (defaults to Date.now())
   */
  addEvent(evt: LabNotebookEvent, timestamp?: number): this {
    if (!evt) {
      logError('ChangeCollatorLab received a null event.');
      return this;
    }
    
    // if (log.enabled) {
    //   const t = timestamp ?? Date.now();
    //   log('Processing unified Lab event:', JSON.stringify({
    //     cellChanges: evt.cellChanges?.length || 0,
    //     contentChanges: evt.contentChanges?.length || 0,
    //     hasMetadata: !!evt.metadata,
    //     timestamp: t
    //   }));
    // }
    
    try {
      const { metadata, contentChanges, cellChanges } = evt;
      
      // 1. Handle Notebook-level metadata changes
      if (metadata) {
        this._recordNotebookMetadataChange({ metadata });
      }
      
      // 2. Handle Content Changes (Cell Add/Remove/Move)
      if (contentChanges?.length && contentChanges.length > 0) {
        contentChanges.forEach(contentChange => {
          this.addCellsListChange(contentChange.change);
        });
        
        // Verify cell count consistency
        const currentCellCount = this._model.cells.length;
        if (this.cellCount !== currentCellCount) {
          log(`Cell count mismatch (${this.cellCount} vs ${currentCellCount}). Forcing diff.`);
          this.addDiff(); // Trigger diff check due to potential structural change
        }
      }
      
      // 3. Handle Cell-level Changes
      if (cellChanges?.length && cellChanges.length > 0) {
        cellChanges.forEach(cellChange => {
          const { cell, change } = cellChange;
          this.addCellChange(cell, change);
        });
      }
      
      // 4. Final cell count verification
      const finalCellCount = this._model.cells.length;
      if (this.cellCount !== finalCellCount) {
        log(`Final cell count mismatch (${this.cellCount} vs ${finalCellCount}). Forcing diff.`);
        this.addDiff();
      }
      
    } catch (error) {
      logError('Error processing Lab event in ChangeCollatorLab:', error, evt);
      // Avoid rethrowing from event handler loop
    }
    
    return this;
  }

  /**
   * Adds multiple unified events.
   * @param evts - Array of unified Lab event objects
   */
  addEvents(evts: LabNotebookEvent[]): this {
    evts.forEach(evt => this.addEvent(evt));
    return this;
  }

  hasChanges() {
    // Should generate diff if there are full changes OR if there are structural/doc changes.
    return (this.documentChanges.size || this.full.size || this.added.length || this.removed.length);
  }

  get hasDiffs() {
    this.addDiff();
    return super.hasDiffs;
  }

}
