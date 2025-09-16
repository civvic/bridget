// debugger;
import type { INotebookModel } from '@jupyterlab/notebook';
import type { NotebookPanel } from '@jupyterlab/notebook';
import type { ICellModel, ICodeCellModel } from '@jupyterlab/cells';
import type { IObservableList } from '@jupyterlab/observables';
import type { DocumentRegistry } from '@jupyterlab/docregistry';
import type { Diff } from '../../common/changeCollator.js'; // Import Diff type
import { ISignal, Signal } from '@lumino/signaling';

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
import { SessionManager } from './sessionManager.js';
import type { SessionState } from './types.js';


/**
 * Monitors a notebook document context for cell changes using a ChangeCollatorLab.
 * This monitor tracks the document/model, not specific UI panels.
 */
export class NotebookMonitor {
  private _context: DocumentRegistry.IContext<INotebookModel>;
  private _model: INotebookModel;
  private _sessionId: string;
  private _sessionManager: SessionManager<SessionState>;
  private _changeCollator: ChangeCollatorLab;
  private _currentKernelId: string | null = null;

  // State management
  private _stateChanged = new Signal<this, DiffsMessage | StateMessage>(this);
  private _isActive: boolean = false;
  
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

  constructor(
    context: DocumentRegistry.IContext<INotebookModel>,
    sessionManager: SessionManager<SessionState>
  ) {
    this._context = context;
    this._currentKernelId = this._context.sessionContext?.session?.kernel?.id;
    this._model = context.model;
    this._sessionId = this._createSessionId(context.path);
    this._sessionManager = sessionManager;
    if (!this._model) {
      logError('Notebook model not available at monitor creation!');
      return;
    }
    this._changeCollator = new ChangeCollatorLab(this._model);
    this._setupSession();
    this._connectSignals();
    this._sendInitialState();
  }

  /**
   * Signal emitted when this notebook's state changes
   */
  get stateChanged(): ISignal<this, DiffsMessage | StateMessage> {
    return this._stateChanged;
  }

  get currentState(): DiffsMessage | StateMessage | null {
    const session = this._sessionManager.getSession(this._sessionId);
    return session?.currentState || null;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  public getContextPath(): string {
    return this._context.path;
  }

  private _createNbAPI(): NBStateAPI {
    const sessionId = this._sessionId;
    const sessionManager = this._sessionManager;
    
    return {
      _sessionId: sessionId,
      addStateObserver: (callback: (state: DiffsMessage | StateMessage) => void) => {
        // Store callback in session, not in monitor
        const session = sessionManager.getSession(sessionId);
        session.stateObservers.push(callback);
        sessionManager.setSession(sessionId, session);
        log(`Session ${sessionId}: Added state observer (${session.stateObservers.length} total)`);
        // Return unsubscribe function
        return () => {
          const session = sessionManager.getSession(sessionId);
          if (session) {
            const index = session.stateObservers.indexOf(callback);
            if (index > -1) {
              session.stateObservers.splice(index, 1);
              sessionManager.setSession(sessionId, session);
              log(`Session ${sessionId}: Removed state observer (${session.stateObservers.length} remaining)`);
            }
          }
        };
      },
      
      getNBState: () => {
        const session = sessionManager.getSession(sessionId);
        return session?.currentState || null;
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
          if (this.currentState) {
            this._stateChanged.emit(this.currentState);
          }
          return undefined;
        } else {
          // Return current state
          return this.currentState || undefined;
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
        return send ? undefined : this.currentState;
    }
  }

  /**
   * Called by plugin when this notebook becomes active
   */
  public setActive(): void {
    this._isActive = true;
    const session = this._sessionManager.getSession(this._sessionId);
    if (session) {
      // Set up global $Nb with fresh API proxy for this monitor
      const w = window as Window;
      w.$Nb = this._createNbAPI(); // Always fresh API
      if (session.bridge) w.bridge = session.bridge;
      if (session.brdimport) w.brdimport = session.brdimport;
    }
    log(`Monitor for ${this._context.path.split('/').pop()} is now active`);
  }

  /**
   * Called by plugin when this notebook becomes inactive
   */
  public setInactive(): void {
    this._isActive = false;
    const w = window as Window;
    
    // Store current global state back to session
    const session = this._sessionManager.getSession(this._sessionId);
    if (session) {
      session.bridge = w.bridge;
      session.brdimport = w.brdimport;
      session.lastAccessedAt = Date.now();
      this._sessionManager.setSession(this._sessionId, session);
    }
    
    // Clear globals
    delete w.$Nb;
    delete w.bridge;
    delete w.brdimport;
    
    log(`Monitor for ${this._context.path.split('/').pop()} is now inactive`);
  }

  /**
   * Updates the state and emits a change signal
   */
  private updateState(message: DiffsMessage | StateMessage): void {
    // Update session state
    const session = this._sessionManager.getSession(this._sessionId);
    if (session) {
      session.currentState = message;
      session.lastAccessedAt = Date.now();
      this._sessionManager.setSession(this._sessionId, session);
      
      // Notify all stored observers
      session.stateObservers.forEach((callback, index) => {
        try {
          callback(message);
        } catch (error) {
          console.error(`Error in state observer ${index} for session ${this._sessionId}:`, error);
        }
      });
      
      log(`Session ${this._sessionId}: Updated state and notified ${session.stateObservers.length} observers`);
    }
    
    // Still emit signal for immediate observers (like status widget)
    this._stateChanged.emit(message);
  }

  /**
   * Setup session state - get existing or create new
   */
  private _setupSession(): void {
    const currentKernelId = this._context.sessionContext?.session?.kernel?.id || null;
    let session = this._sessionManager.getSession(this._sessionId);
    
    if (session) {
      // Validate session against current kernel
      if (session.kernelId !== currentKernelId) {
        log(`Session invalid - kernel changed from ${session.kernelId} to ${currentKernelId} - clearing session`);
        this._sessionManager.clearSession(this._sessionId);
        session = null; // Force recreation
      } else {
        log(`Session valid - same kernel ${currentKernelId}`);
      }
    }
    
    if (!session) {
      session = {
        currentState: null,
        stateObservers: [],
        bridge: null,
        brdimport: null,
        kernelId: currentKernelId, // Store current kernel ID
        createdAt: Date.now(),
        lastAccessedAt: Date.now()
      };
      this._sessionManager.setSession(this._sessionId, session);
    } else {
      session.lastAccessedAt = Date.now();
      this._sessionManager.setSession(this._sessionId, session);
    }
  }
  
  /** Connects to the notebook's signals.
   */
  private _connectSignals(): void {
    if (!this._model) return;

    // Listen for cells list changes (structural changes)
    this._model.cells.changed.connect(this._onCellsChanged, this);
    
    // Listen for kernel lifecycle events
    if (this._context.sessionContext) {
      this._context.sessionContext.kernelChanged.connect(this._onKernelChanged, this);
      this._context.sessionContext.statusChanged.connect(this._onKernelStatusChanged, this);
    }
    
    this._context.pathChanged.connect(this._onPathChanged, this);
    
    // Connect to existing cells
    this._connectToCells();
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
      const diffs: Diff[] = [[docChanges, [], [], this._model.cells.length]];
      log('>>>> Diffs Received (document-only):', JSON.stringify(diffs));
      this._sendDiffs(diffs);
    } else {
      // Add to collator to be combined with other pending changes
      this._changeCollator.setDocumentChanges(docChanges);
      this._triggerDebouncedProcessing();
    }
  }

  private _connectToCells(): void {
    const cells = this._model.cells;
    for (let i = 0; i < cells.length; i++) {
      this._connectToCell(cells.get(i));
    }
  }

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
        const currentCellIds = new Set([...this._model.cells].map(c => c.id));
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

  private _onKernelChanged(): void {
    const kernel = this._context.sessionContext?.session?.kernel;
    const newKernelId = kernel?.id || null;
    
    if (newKernelId && newKernelId !== this._currentKernelId) {
      log(`Session ${this._sessionId}: Kernel changed from ${this._currentKernelId} to ${newKernelId}`);
      // Only clear if we had a previous kernel (not initial connection)
      if (this._currentKernelId) {
        this._sessionManager.clearSession(this._sessionId);
        this._setupSession();
        // this._sendInitialState(); // not needed, nobody out there is waiting for it
      }
      this._currentKernelId = newKernelId;
    } else if (!newKernelId && this._currentKernelId) {
      log(`Session ${this._sessionId}: Lost connection to kernel ${this._currentKernelId} - keeping session`);
      // Don't clear - kernel might reconnect with same ID
    }
  }

  private _onKernelStatusChanged(): void {
    const status = this._context.sessionContext?.kernelDisplayStatus;
    if (status === 'idle' || status === 'busy') return;
    
    if (status === 'restarting') {
      log(`Session ${this._sessionId}: Kernel restarting - clearing session`);
      this._sessionManager.clearSession(this._sessionId);
      this._setupSession();
      // this._sendInitialState(); // not needed, nobody out there is waiting for it
    }
    
    log(`Session ${this._sessionId}: Kernel status changed to ${status}`);
  }

  /**
   * Handle file path changes (rename/move)
   */
  private _onPathChanged(sender: any, newPath: string): void {
    const oldSessionId = this._sessionId;
    const newSessionId = this._createSessionId(newPath);
    
    if (oldSessionId !== newSessionId) {
      log(`Path changed: ${oldSessionId} → ${newSessionId}`);
      this._sessionManager.renameSession(oldSessionId, newSessionId);
      this._sessionId = newSessionId; // Update current session ID
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
      const diffs: Diff[] = this._changeCollator.getDiffs();
      log('>>>> Diffs Received:', JSON.stringify(diffs)); // Log the diffs for verification
      this._sendDiffs(diffs);
      sent = true;
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

  private _getOutputsWithTransient(cellModel: ICodeCellModel): any[] {
    const outputs: any[] = [];
    const outputArea = cellModel.outputs; // IOutputAreaModel
    for (let i = 0; i < outputArea.length; i++) {
      const outputModel = outputArea.get(i) as any;
      // HACK: The _raw property contains all original data including transient
      if (outputModel._raw) {
        const rawOutput = { ...outputModel._raw };
        rawOutput.data = outputModel.data;
        rawOutput.metadata = outputModel.metadata;
        if (rawOutput.transient) {
          rawOutput.metadata.transient = rawOutput.transient;
          delete rawOutput.transient;
        }
        outputs.push(rawOutput);
      } else {
        outputs.push(outputModel.toJSON());
      }
    }
    return outputs;
  }

  private _toStateCells(idxs: number[]): StateCell[] {
    const cells: StateCell[] = [];
    for (const idx of idxs) {
      const cellModel = this._model.cells.get(idx);
      if (cellModel) {
        const cell: StateCell = {
          idx: idx,
          id: cellModel.id,
          cell_type: cellModel.type as 'code' | 'raw' | 'markdown',
          source: cellModel.sharedModel.source,
          metadata: cellModel.sharedModel.getMetadata(),
          outputs:
            cellModel.type === 'code'
              // ? (cellModel as ICodeCellModel).sharedModel.outputs.slice()
              ? this._getOutputsWithTransient(cellModel as ICodeCellModel)
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
    const m = this._model;
    return {
      cellCount: m.cells.length,
      notebookUri: this._context.path,
      metadata: {
        metadata: m.sharedModel.getMetadata(),
        nbformat: m.sharedModel.nbformat,
        nbformat_minor: m.sharedModel.nbformat_minor
      }
    };
  }

  private _createFullStateMessage(): StateMessage {
    if (!this._model) {
      throw new Error('Cannot create state message: model not available');
    }

    const cellCount = this._model.cells.length;
    const allCellIndexes = Array.from({ length: cellCount }, (_, i) => i);
    const cells = this._toStateCells(allCellIndexes);

    return {
      type: 'state',
      origin: this._context.path,
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
    if (!this._model) return;

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
      origin: this._context.path,
      timestamp: Date.now(),
      changes: changes,
      nbData: this._nbData()
    };
    const diffsMessageString = JSON.stringify(diffsMessage).substring(0, 120);
    log('Sending diffs message:', `${diffsMessageString}...`);
    this.updateState(diffsMessage);
  }

  dispose(): void {
    if (!this._model) return;

    // Process any remaining document changes before disposing
    // this._processDocumentChanges();

    // Clear debounce timer
    if (this._processChangesTimer !== null) {
      clearTimeout(this._processChangesTimer);
      this._processChangesTimer = null;
    }

    if (this._context.sessionContext) {
      this._context.sessionContext.kernelChanged.disconnect(this._onKernelChanged, this);
      this._context.sessionContext.statusChanged.disconnect(this._onKernelStatusChanged, this);
      this._context.pathChanged.disconnect(this._onPathChanged, this);
    }

    // Disconnect from model-level signals
    if (this._model?.cells?.changed) {
      this._model.cells.changed.disconnect(this._onCellsChanged, this);
    }
  
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

    this._pendingDocumentChanges.clear();

    if (this._isActive) {
      const w = window as Window;
      delete w.$Nb;
      delete w.bridge;
      delete w.brdimport;
    }

    this._context = null;
    this._model = null;
    this._changeCollator = null;
    this._stateChanged = null;
    this._isActive = false;

    log(`Session ${this._sessionId}: disposed monitor`);
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

  private _createSessionId(path: string): string {
    // Use the full path as session ID for now
    return path;
  }

  get sessionId(): string {
    return this._sessionId;
  }
}
