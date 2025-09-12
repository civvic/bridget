// debugger;

import { debug } from '../../common/debug.js';
const log = debug('nb:monitor', 'darkgreen');
const logError = debug('nb:monitor:error', 'red');
import { ChangeCollatorLab } from './changeCollatorLab.js';
import type {
  DiffsMessage,
  NBData,
  StateCell,
  StateChange,
  StateMessage,
  MIMEMessage,
  NBStateAPI
} from './types.js';

import type { INotebookModel } from '@jupyterlab/notebook';
import type { NotebookPanel } from '@jupyterlab/notebook';
import type { ICellModel, ICodeCellModel } from '@jupyterlab/cells';
import type { IObservableList } from '@jupyterlab/observables';
import type { Diff } from '../../common/changeCollator.js'; // Import Diff type
import { ISignal, Signal } from '@lumino/signaling';

/**
 * Monitors a notebook for cell changes using a ChangeCollatorLab.
 */
export class NotebookMonitor {
  private _panel: NotebookPanel | null = null;
  private _model: INotebookModel | null = null;
  private _notebook: NotebookPanel['content'] | null = null;
  private _changeCollator: ChangeCollatorLab | null = null;
  
  // State management
  private _stateChanged = new Signal<this, DiffsMessage | StateMessage>(this);
  private _currentState: DiffsMessage | StateMessage | null = null;
  private _isActive: boolean = false;
  
  // $Nb API instance for this notebook
  private _nbAPI: NBStateAPI | null = null;
  private _bridge: any = null;
  private _brdimport: any = null;

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
  constructor(panel: NotebookPanel) {
    this._panel = panel;
    this._model = panel?.model;
    this._notebook = panel?.content;

    if (!this._model || !this._notebook) {
      logError('Notebook model or notebook content not available at monitor creation!');
      return;
    }
    
    this._changeCollator = new ChangeCollatorLab(this._model);
    this._createNbAPI();
    this._connectSignals();
    this._sendInitialState();
    
    // log('NotebookMonitor: Attached to notebook panel');
  }

  /**
   * Signal emitted when this notebook's state changes
   */
  get stateChanged(): ISignal<this, DiffsMessage | StateMessage> {
    return this._stateChanged;
  }

  /**
   * Current state of this notebook
   */
  get currentState(): DiffsMessage | StateMessage | null {
    return this._currentState;
  }

  /**
   * Whether this monitor is for the active notebook
   */
  get isActive(): boolean {
    return this._isActive;
  }

  /**
   * Creates the $Nb API for this notebook
   */
  private _createNbAPI(): void {
    this._nbAPI = {
      addStateObserver: (callback: (state: DiffsMessage | StateMessage) => void) => {
        const slot = (sender: this, state: DiffsMessage | StateMessage) => callback(state);
        this._stateChanged.connect(slot);
        return () => this._stateChanged.disconnect(slot);
      },
      getNBState: () => {
        return this._currentState;
      },
      update: (message: MIMEMessage) => {
        this._processUpdateMessage(message, true);
      },
      aupdate: async (message: MIMEMessage) => {
        const result = this._processUpdateMessage(message, false);
        return Promise.resolve(result);
      }
    };
  }

  /**
   * Process update message from Python widgets or MIME renderer
   * @param message - The update message
   * @param send - Whether to emit state changes (true) or just return data (false)
   * @returns State message for aupdate, undefined for update
   */
  private _processUpdateMessage(
    message: MIMEMessage, 
    send: boolean
  ): DiffsMessage | StateMessage | undefined {
    switch (message.update) {
      case 'diff':
        if (send) {
          // Re-emit last state update
          if (this._currentState) {
            this._stateChanged.emit(this._currentState);
          }
          return undefined;
        } else {
          // Return current state
          return this._currentState || undefined;
        }
        
      case 'full':
        if (send) {
          // Trigger full state resend
          this._sendInitialState();
          return undefined;
        } else {
          // Create and return full state message without emitting
          return this._createFullStateMessage();
        }
        
      default:
        // Handle 'opts' or null - TBD for options handling
        log('Update message with unhandled type:', message.update);
        return send ? undefined : this._currentState;
    }
  }

  /**
   * Called by plugin when this notebook becomes active
   */
  public setActive(): void {
    this._isActive = true;
    // Set up global $Nb to point to this notebook's API
    const w = window as Window;
    w.$Nb = this._nbAPI;
    if (this._bridge) w.bridge = this._bridge;
    if (this._brdimport) w.brdimport = this._brdimport;
    log(`Monitor for ${this._panel.context.path.split('/').pop()} is now active`);
  }

  /**
   * Called by plugin when this notebook becomes inactive
   */
  public setInactive(): void {
    this._isActive = false;
    log(`Monitor for ${this._panel.context.path.split('/').pop()} is now inactive`);
    const w = window as Window;
    this._bridge = w.bridge;
    this._brdimport = w.brdimport;
    delete w.$Nb;
    delete w.bridge;
    delete w.brdimport;
  }

  /**
   * Updates the state and emits a change signal (moved from StateManager)
   */
  private updateState(message: DiffsMessage | StateMessage): void {
    this._currentState = message;
    this._stateChanged.emit(message);
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
    // log(`onNotebookStateChanged: ${changed.name} = ${changed.newValue}`);
    
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
    
    if (this._changeCollator.isEmpty) {
      // Send directly as a simple diff - no other changes pending
      const diffs: Diff[] = [[docChanges, [], [], this._model!.cells.length]];
      log('>>>> Diffs Received (document-only):', JSON.stringify(diffs));
      this._sendDiffs(diffs);
    } else {
      // Add to collator to be combined with other pending changes
      this._changeCollator.setDocumentChanges(docChanges);
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
   * Sends initial full state when the notebook is first loaded
   */
  private _sendInitialState(): void {
    if (!this._model) return;
    
    const cellCount = this._model.cells.length;
    log(`Sending initial full state with ${cellCount} cells`);
    
    const stateMessage = this._createFullStateMessage();
    this.updateState(stateMessage);
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
          // log(`Cell #${cellIndex}: Document change deferred (typing)`);
        }
        return; // Don't trigger debounced processing for source changes
      }
      
      // Process other changes immediately using unified event pattern
      if (this._changeCollator) {
        const unifiedEvent = this._createCellChangeEvent(changedCellModel, change);
        if (unifiedEvent) {
          this._changeCollator.addEvent(unifiedEvent);
          this._triggerDebouncedProcessing();
        }
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
    if (!this._changeCollator || this._changeCollator.isEmpty) {
      return;
    }
    let sent = false;
    if (this._changeCollator.hasDiffs) {
      // Check if there are any pending executions - don't send diffs if executions are ongoing
      // if (this._changeCollator.pending && this._changeCollator.pending.size > 0) {
      //   log(`Skipping diff emission - ${this._changeCollator.pending.size} executions still pending`);
      //   // Reset the debounce timer to check again later
      //   this._triggerDebouncedProcessing();
      //   return;
      // }
      const diffs: Diff[] = this._changeCollator.getDiffs();
      log('>>>> Diffs Received:', JSON.stringify(diffs)); // Log the diffs for verification
      this._sendDiffs(diffs);
      sent = true;
      // Run cleanup if needed to remove dangling summaries
      // if (!this._changeCollator.isEmpty) {
      //   this._changeCollator.cleanup();
      // }
    }
    if (log.enabled) {
      if (this._changeCollator.isEmpty) {
        console.log('     ____ empty collator ____\n');
      } else {
        // This might happen if changes occurred but the conditions for a diff weren't met
        // (e.g., execution started but hasn't finished).
        console.log('     ____ pending changes ____');
        if (sent) {
          this._changeCollator.showSummary();
          console.log();
        }
      }
    }
  }

  private _toStateCells(idxs: number[]): StateCell[] {
    const cells: StateCell[] = [];
    for (const idx of idxs) {
      const cellModel = this._model!.cells.get(idx);
      if (cellModel) {
        const cell: StateCell = {
          idx: idx,
          id: cellModel.id,
          cell_type: cellModel.type as 'code' | 'raw' | 'markdown',
          source: cellModel.sharedModel.source,
          metadata: cellModel.sharedModel.getMetadata(),
          outputs:
            cellModel.type === 'code'
              ? (cellModel as ICodeCellModel).sharedModel.outputs.slice()
              : undefined
        };
        if (cellModel.type === 'code') {
          cell.execution_count = (cellModel as ICodeCellModel).executionCount;
        }
        cells.push(cell);
      }
    }
    return cells;
  }

  private _nbData(): NBData {
    return {
      cellCount: this._model.cells.length,
      notebookUri: this._panel.context.path
      // metadata: this._model.sharedModel.getMetadata(), // TODO: check if this is correct
    };
  }

  /**
   * Creates a full state message
   * @returns StateMessage with current notebook state
   */
  private _createFullStateMessage(): StateMessage {
    if (!this._model || !this._panel) {
      throw new Error('Cannot create state message: model or panel not available');
    }

    const cellCount = this._model.cells.length;
    const allCellIndexes = Array.from({ length: cellCount }, (_, i) => i);
    const cells = this._toStateCells(allCellIndexes);

    return {
      type: 'state',
      origin: this._panel.context.path,
      timestamp: Date.now(),
      cells: cells,
      nbData: this._nbData()
    };
  }
  
  /**
   * Converts raw diffs from the collator into a structured DiffsMessage
   * and sends it to the state manager.
   * @param diffs - The raw diffs to process.
   */
  private _sendDiffs(diffs: Diff[]): void {
    if (!this._model || !this._panel) return;

    const changes: StateChange[] = diffs.map(diff => {
      const [changed, added, removed, cellCount] = diff;
      const changedOrAdded = [...(changed || []), ...(added || [])];
      const cells = this._toStateCells(changedOrAdded);
      return {
        cells: cells,
        added: added,
        removed: removed,
        cellCount: cellCount
      };
    });

    const diffsMessage: DiffsMessage = {
      type: 'diffs',
      origin: this._panel.context.path,
      timestamp: Date.now(),
      changes: changes,
      nbData: this._nbData()
    };
    const diffsMessageString = JSON.stringify(diffsMessage).substring(0, 120);
    log('Sending diffs message:', `${diffsMessageString}...`);
    this.updateState(diffsMessage);
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

    // If this was the active monitor, clear global references
    if (this._isActive) {
      const w = window as Window;
      delete w.$Nb;
      delete w.bridge;
      delete w.brdimport;
    }

    // Nullify references
    this._panel = null;
    this._model = null;
    this._notebook = null;
    this._changeCollator = null;
    this._stateChanged = null;
    this._currentState = null;
    this._isActive = false;

    log('NotebookMonitor: Disposed');

  }

  /**
   * Creates a unified Lab notebook event for cell changes.
   * @param cellModel - The cell model that changed
   * @param change - The cell change details
   * @returns Lab notebook event
   */
  private _createCellChangeEvent(cellModel: ICellModel, change: any): any {
    if (change.metadataChange && change.metadataChange.get('scrolled')) return null
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