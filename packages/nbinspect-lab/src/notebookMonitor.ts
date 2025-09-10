// debugger;

import { debug } from '../../common/debug.js';
const log = debug('nb:monitor', 'darkgreen');
const logError = debug('nb:monitor:error', 'red');
import { ChangeCollatorLab } from './changeCollatorLab.js'; // <-- Import the Lab-specific collator
import { NotebookStateManager } from './stateManager.js';
import type {
  DiffsMessage,
  NBData,
  StateCell,
  StateChange,
  StateMessage
} from './types.js';

import type { INotebookModel } from '@jupyterlab/notebook';
import type { NotebookPanel } from '@jupyterlab/notebook';
import type { ICellModel, ICodeCellModel } from '@jupyterlab/cells';
import type { IObservableList } from '@jupyterlab/observables';
import type { Diff } from '../../common/changeCollator.js'; // Import Diff type

/**
 * Monitors a notebook for cell changes using a ChangeCollatorLab.
 */
export class NotebookMonitor {
  private _panel: NotebookPanel | null = null;
  private _model: INotebookModel | null = null;
  private _notebook: NotebookPanel['content'] | null = null;
  private _changeCollator: ChangeCollatorLab | null = null;
  private _stateManager: NotebookStateManager;

  /**
   * Map storing signal objects and handlers for connected cells.
   */
  private _cellSignalHandlers = new Map<string, {
    sharedModelSignal: any;
    sharedModelHandler: Function;
    outputsSignal?: any | null;
    outputsHandler?: Function | null;
  }>();

  /** Cell indexes with pending document changes (typing) */
  private _pendingDocumentChanges = new Set<number>();

  /** Timeout ID for debouncing processing */
  private _processChangesTimer: number | null = null;
  /** Debounce delay in milliseconds */
  private _debounceDelay = 500; // Default delay, adjust as needed

  /** Creates an instance of NotebookMonitor.
   * @param panel - The notebook panel to monitor
   * @param stateManager - The global state manager
   */
  constructor(panel: NotebookPanel, stateManager: NotebookStateManager) {
    this._panel = panel;
    this._model = panel?.model;
    this._notebook = panel?.content;
    this._stateManager = stateManager;

    if (!this._model || !this._notebook) {
      logError(
        'Notebook model or notebook content not available at monitor creation!'
      );
      return;
    }
    this._changeCollator = new ChangeCollatorLab(this._model);
    this._connectSignals();
    
    // Send initial full state after connecting to signals
    this._sendInitialState();
    
    log('NotebookMonitor: Attached to notebook panel');
  }

  /** Connects to the notebook's signals.
   */
  private _connectSignals(): void {
    if (!this._notebook || !this._model) return;
    
    // Listen for notebook state changes (selection, mode changes)
    this._notebook.stateChanged.connect(this._onNotebookStateChanged, this);
    
    // Listen for cells list changes (structural changes)
    this._model.cells.changed.connect(this._onCellsChanged, this);
    // Connect to existing cells
    this._connectToCells();
  }

  private _onModelContentChanged(notebook: any): void {
    // const cellIndex = this._panel.content.activeCellIndex;
    // log(`onModelContentChanged active cell: ${cellIndex}`);
    // this._pendingDocumentChanges.add(cellIndex);
  }

  /**
   * Handles notebook state changes to process deferred document changes.
   * @param notebook - The notebook widget
   * @param changed - The change details
   */
  private _onNotebookStateChanged(notebook: NotebookPanel['content'], changed: any): void {
    log(`onNotebookStateChanged: ${changed.name} = ${changed.newValue}`);
    
    // Process pending document changes when user changes selection or exits edit mode
    if (changed.name === 'activeCellIndex' || 
        (changed.name === 'mode' && changed.newValue === 'command')) {
      this._processDocumentChanges();
    }
  }

  /**
   * Processes accumulated document changes (deferred typing changes).
   * Called when user changes selection or exits edit mode.
   */
  private _processDocumentChanges(): void {
    if (this._pendingDocumentChanges.size === 0) return;
    
    const docChanges = Array.from(this._pendingDocumentChanges);
    this._pendingDocumentChanges.clear();
    
    log(`Processing deferred document changes for cells: [${docChanges}]`);
    
    if (!this._changeCollator) return;
    
    if ((this._changeCollator as any).isEmpty) {
      // Send directly as a simple diff - no other changes pending
      const diffs: Diff[] = [[docChanges, [], [], this._model!.cells.length]];
      log('>>>> Diffs Received (document-only):', JSON.stringify(diffs));
      this._sendDiffs(diffs);
    } else {
      // Add to collator to be combined with other pending changes
      (this._changeCollator as any).setDocumentChanges(docChanges);
      this._triggerDebouncedProcessing();
    }
  }

  /** Connect to signals from all cells in the notebook
   */
  private _connectToCells(): void {
    const cells = this._model!.cells;
    for (let i = 0; i < cells.length; i++) {
      this._connectToCell(cells.get(i));
    }
  }

  /**
   * Sends initial full state when the notebook is first loaded.
   * Creates a full state message with all current cells.
   */
  private _sendInitialState(): void {
    if (!this._model) return;
    
    const cellCount = this._model.cells.length;
    log(`Sending initial full state with ${cellCount} cells`);
    
    if (cellCount === 0) {
      // Empty notebook - send empty state
      this._sendDiffs([
        [
          /* no cells changed */ [],
          /* no cells added */ [],
          /* no cells removed */ [],
          0
        ]
      ]);
      return;
    }
    
    // Create a diff that represents all current cells as "changed" (full state)
    const allCellIndexes = Array.from({ length: cellCount }, (_, i) => i);
    const diffs: Diff[] = [
      [allCellIndexes, [/* no cells added */], [/* no cells removed */], cellCount]
    ];
    
    log('>>>> Initial State (full notebook):', JSON.stringify(diffs));
    this._sendDiffs(diffs, true);
  }

  /** Connect to a single cell's signals
   * @param cellModel - The cell model
   */
  private _connectToCell(cellModel: ICellModel): void {
    const cellId = cellModel.id;
    if (this._cellSignalHandlers.has(cellId)) return;

    // --- Get signal and define handler for sharedModel ---
    const sharedModelSignal = cellModel.sharedModel.changed;
    const sharedModelHandler = (changedCellModel: any, change: any) => {
      if (change.sourceChange) {
        // Defer document changes - don't process immediately (VSCode-style deferral)
        const cellIndex = this._changeCollator?.getCellIndexById(changedCellModel.id);
        if (cellIndex !== -1 && cellIndex !== undefined) {
          this._pendingDocumentChanges.add(cellIndex);
          log(`Cell #${cellIndex}: Document change deferred (typing)`);
        }
        return; // Don't trigger debounced processing for source changes
      }
      
      // Process other changes immediately using unified event pattern
      if (this._changeCollator) {
        const unifiedEvent = this._createCellChangeEvent(changedCellModel, change);
        this._changeCollator.addEvent(unifiedEvent);
        this._triggerDebouncedProcessing();
      }
    };
    sharedModelSignal.connect(sharedModelHandler, this);

    // --- Get signal and define handler for outputs (if code cell) ---
    let outputsSignal: any = null;
    let outputsHandler: Function | null = null;
    if (cellModel.type === 'code') {
      outputsSignal = (cellModel as any).outputs.changed;
      outputsHandler = (cellOutputs: any, change: any) => {
        // Need to create a CellChange-like object for outputs-only changes
        const outputsOnlyChange = {
          outputsChange: {
            // Get the latest count/state directly from the model outputs
            outputCount: (cellModel as any).outputs.length,
            isEmpty: (cellModel as any).outputs.length === 0
          }
          // No other change types in this synthetic event
        };
        // Pass the original cellModel and the synthetic change object using unified event pattern
        if (this._changeCollator) {
          const unifiedEvent = this._createCellChangeEvent(cellModel, outputsOnlyChange);
          this._changeCollator.addEvent(unifiedEvent);
          this._triggerDebouncedProcessing();
        }
      };
      outputsSignal?.connect(outputsHandler, this);
    }

    // --- Store signals and handlers in the map ---
    this._cellSignalHandlers.set(cellId, {
      sharedModelSignal,
      sharedModelHandler,
      outputsSignal,
      outputsHandler
    });
  }

  /** Handler for changes in the cells list - feeds changes to the collator
   * @param sender - The cells list
   * @param change - Change arguments
   */
  private _onCellsChanged(sender: any, change: any): void {
    switch (change.type) {
      case 'add':
        change.newValues.forEach(cellModel => this._connectToCell(cellModel));
        break;

      case 'remove': {
        // Identify which cell IDs are no longer in the model
        const currentCellIds = new Set([...this._model!.cells].map(c => c.id));
        const handlersToRemove: string[] = [];

        for (const cellId of this._cellSignalHandlers.keys()) {
          if (!currentCellIds.has(cellId)) {
            handlersToRemove.push(cellId);
          }
        }

        // Disconnect signals for removed cells
        handlersToRemove.forEach(cellId => {
          const signalsAndHandlers = this._cellSignalHandlers.get(cellId);
          if (signalsAndHandlers) {
            // Disconnect using the stored signal, handler, and context (this)
            if (signalsAndHandlers.sharedModelSignal && signalsAndHandlers.sharedModelHandler) {
              signalsAndHandlers.sharedModelSignal.disconnect(signalsAndHandlers.sharedModelHandler, this);
            }
            if (signalsAndHandlers.outputsSignal && signalsAndHandlers.outputsHandler) {
              signalsAndHandlers.outputsSignal.disconnect(signalsAndHandlers.outputsHandler, this);
            }
            this._cellSignalHandlers.delete(cellId); // Remove from map
            log(`Disconnected signals for removed cell ${cellId}`);
          }
        });
        break;
      }

      case 'move':
        // Moves are handled by the remove/add cases in terms of signals,
        // and by the collator interpreting the diff. No extra action needed here.
        break;
    }

    // Feed the structural change to the collator AFTER handling signals
    if (this._changeCollator) {
      const unifiedEvent = this._createContentChangeEvent(change);
      this._changeCollator.addEvent(unifiedEvent);
      this._triggerDebouncedProcessing();
    }
  }

  /**
   * Clears the existing debounce timer and starts a new one.
   */
  private _triggerDebouncedProcessing(): void {
    if (this._processChangesTimer !== null) {
      clearTimeout(this._processChangesTimer);
    }
    this._processChangesTimer = window.setTimeout(() => {
      this._processChanges();
    }, this._debounceDelay);
  }

  /**
   * Processes the accumulated changes from the collator.
   * Called after the debounce delay.
   */
  private _processChanges(): void {
    this._processChangesTimer = null; // Clear timer ID
    if (!this._changeCollator || (this._changeCollator as any).isEmpty) {
      return;
    }

    if ((this._changeCollator as any).hasDiffs) {
      // Check if there are any pending executions - don't send diffs if executions are ongoing
      if ((this._changeCollator as any).pending && (this._changeCollator as any).pending.size > 0) {
        log(`Skipping diff emission - ${(this._changeCollator as any).pending.size} executions still pending`);
        // Reset the debounce timer to check again later
        this._triggerDebouncedProcessing();
        return;
      }

      const diffs: Diff[] = (this._changeCollator as any).getDiffs();
      log('>>>> Diffs Received:', JSON.stringify(diffs)); // Log the diffs for verification

      this._sendDiffs(diffs);

      // Run cleanup if needed to remove dangling summaries
      if (!(this._changeCollator as any).isEmpty) {
        this._changeCollator.cleanup();
      }
    }
    if (log.enabled) {
      if ((this._changeCollator as any).isEmpty) {
        console.log('     ____ empty collator ____\n');
      } else {
        // This might happen if changes occurred but the conditions for a diff weren't met
        // (e.g., execution started but hasn't finished).
        console.log('     ____ pending changes ____');
        this._changeCollator.showSummary();
        console.log();
      }
    }
  }

  /**
   * Converts raw diffs from the collator into a structured DiffsMessage
   * and sends it to the state manager.
   * @param diffs - The raw diffs to process.
   * @param isFullState - Whether this diff represents the full initial state.
   */
  private _sendDiffs(diffs: Diff[], isFullState = false): void {
    if (!this._model || !this._panel) return;

    const changes: StateChange[] = diffs.map(diff => {
      const [changed, added, removed, cellCount] = diff;
      const cells: { idx: number; cell: StateCell }[] = [];

      const changedOrAdded = [...(changed || []), ...(added || [])];
      for (const idx of changedOrAdded) {
        const cellModel = this._model!.cells.get(idx);
        if (cellModel) {
          cells.push({
            idx: idx,
            cell: {
              cell_type: cellModel.type as 'code' | 'raw' | 'markdown',
              source: cellModel.sharedModel.source,
              metadata: cellModel.sharedModel.getMetadata(),
              outputs:
                cellModel.type === 'code'
                  ? (cellModel as ICodeCellModel).sharedModel.outputs.slice()
                  : undefined
            }
          });
        }
      }

      return {
        cells: cells,
        added: added,
        removed: removed,
        cellCount: cellCount
      };
    });

    const nbData: NBData = {
      cellCount: this._model.cells.length,
      notebookUri: this._panel.context.path
      // metadata: this._model.sharedModel.getMetadata(), // TODO: check if this is correct
    };

    if (isFullState) {
      const stateMessage: StateMessage = {
        type: 'state',
        origin: this._panel.context.path,
        timestamp: Date.now(),
        cells: changes.length > 0 ? changes[0].cells : [],
        nbData: nbData
      };
      const stateMessageString = JSON.stringify(stateMessage).substring(0, 120);
      log('Sending full state message:', `${stateMessageString}...`);
      this._stateManager.updateState(stateMessage);
    } else {
      const diffsMessage: DiffsMessage = {
        type: 'diffs',
        origin: this._panel.context.path,
        timestamp: Date.now(),
        changes: changes,
        nbData: nbData
      };
      const diffsMessageString = JSON.stringify(diffsMessage).substring(0, 120);
      log('Sending diffs message:', `${diffsMessageString}...`);
      this._stateManager.updateState(diffsMessage);
    }
  }

  /** Dispose of the monitor, disconnecting all signals.
   */
  dispose(): void {
    if (!this._panel || !this._model) return;

    // Process any remaining document changes before disposing
    this._processDocumentChanges();

    // Clear debounce timer
    if (this._processChangesTimer !== null) {
      clearTimeout(this._processChangesTimer);
      this._processChangesTimer = null;
    }

    // Disconnect from notebook-level signals
    this._notebook?.stateChanged?.disconnect(this._onNotebookStateChanged, this);
    this._model?.cells?.changed.disconnect(this._onCellsChanged, this);

    // Disconnect from all remaining cell signals
    this._cellSignalHandlers.forEach((signalsAndHandlers, cellId) => {
      if (signalsAndHandlers.sharedModelSignal && signalsAndHandlers.sharedModelHandler) {
        signalsAndHandlers.sharedModelSignal.disconnect(signalsAndHandlers.sharedModelHandler, this);
      }
      if (signalsAndHandlers.outputsSignal && signalsAndHandlers.outputsHandler) {
        signalsAndHandlers.outputsSignal.disconnect(signalsAndHandlers.outputsHandler, this);
      }
    });
    this._cellSignalHandlers.clear();

    // Clear pending document changes
    this._pendingDocumentChanges.clear();

    // Nullify references
    this._panel = null;
    this._model = null;
    this._notebook = null;
    this._changeCollator = null;
    log('NotebookMonitor: Disposed');
  }

  /**
   * Creates a unified Lab notebook event for cell changes.
   * @param cellModel - The cell model that changed
   * @param change - The cell change details
   * @returns Lab notebook event
   */
  private _createCellChangeEvent(cellModel: ICellModel, change: any): any {
    return {
      cellChanges: [{ cell: cellModel, change }],
      timestamp: Date.now()
    };
  }

  /**
   * Creates a unified Lab notebook event for structural changes.
   * @param change - The list change details
   * @returns Lab notebook event
   */
  private _createContentChangeEvent(change: IObservableList.IChangedArgs<ICellModel>): any {
    return {
      contentChanges: [{ change }],
      timestamp: Date.now()
    };
  }
} 