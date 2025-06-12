// debugger;

import { debug } from './common/debug.js';
const log = debug('monitor', 'darkgreen');
const logError = debug('monitor:error', 'red');
import { ChangeCollatorLab } from './changeCollatorLab.js'; // <-- Import the Lab-specific collator

/**
 * @typedef {import('@jupyterlab/notebook').INotebookModel} INotebookModel
 * @typedef {import('@jupyterlab/notebook').NotebookPanel} NotebookPanel
 * @typedef {import('@jupyterlab/cells').ICellModel} ICellModel
 * @typedef {import('@jupyterlab/observables').IObservableList} IObservableList
 * @typedef {import('./common/changeCollator.js').Diff} Diff // Import Diff type
 */

/**
 * Monitors a notebook for cell changes using a ChangeCollatorLab.
 */
export class NotebookMonitor {
  /** @type {NotebookPanel} */
  #panel = null;
  /** @type {INotebookModel} */
  #model = null;
  /** @type {NotebookPanel['content']} The notebook widget */
  #notebook = null;
  /** @type {ChangeCollatorLab | null} Reference to the change collator */
  #changeCollator = null;

  /**
   * Map storing signal objects and handlers for connected cells.
   * @type {Map<string, {
   *   sharedModelSignal: import('@lumino/signaling').ISignal<any, any>,
   *   sharedModelHandler: Function,
   *   outputsSignal?: import('@lumino/signaling').ISignal<any, any> | null,
   *   outputsHandler?: Function | null
   * }>}
   */
  #cellSignalHandlers = new Map();

  /** @type {Set<number>} Cell indexes with pending document changes (typing) */
  #pendingDocumentChanges = new Set();

  /** @type {number | null} Timeout ID for debouncing processing */
  #processChangesTimer = null;
  /** @type {number} Debounce delay in milliseconds */
  #debounceDelay = 500; // Default delay, adjust as needed

  /** Creates an instance of NotebookMonitor.
   * @param {NotebookPanel} panel - The notebook panel to monitor
   */
  constructor(panel) {
    this.#panel = panel;
    this.#model = panel?.model;
    this.#notebook = panel?.content;
    if (!this.#model || !this.#notebook) {
      logError('Notebook model or notebook content not available at monitor creation!');
      return;
    }
    this.#changeCollator = new ChangeCollatorLab(this.#model);
    this.#connectSignals();
    
    // Send initial full state after connecting to signals
    this.#sendInitialState();
    
    log('NotebookMonitor: Attached to notebook panel');
  }

  /** Connects to the notebook's signals.
   */
  #connectSignals() {
    if (!this.#notebook || !this.#model) return;
    
    // Listen for notebook state changes (selection, mode changes)
    this.#notebook.stateChanged.connect(this.#onNotebookStateChanged, this);
    
    // Listen for cells list changes (structural changes)
    this.#model.cells.changed.connect(this.#onCellsChanged, this);
    // Connect to existing cells
    this.#connectToCells();
  }

  #onModelContentChanged(notebook) {
    // const cellIndex = this.#panel.content.activeCellIndex;
    // log(`onModelContentChanged active cell: ${cellIndex}`);
    // this.#pendingDocumentChanges.add(cellIndex);
  }

  /**
   * Handles notebook state changes to process deferred document changes.
   * @param {NotebookPanel['content']} notebook - The notebook widget
   * @param {any} changed - The change details
   */
  #onNotebookStateChanged(notebook, changed) {
    log(`onNotebookStateChanged: ${changed.name} = ${changed.newValue}`);
    
    // Process pending document changes when user changes selection or exits edit mode
    if (changed.name === 'activeCellIndex' || 
        (changed.name === 'mode' && changed.newValue === 'command')) {
      this.#processDocumentChanges();
    }
  }

  /**
   * Processes accumulated document changes (deferred typing changes).
   * Called when user changes selection or exits edit mode.
   * @private
   */
  #processDocumentChanges() {
    if (this.#pendingDocumentChanges.size === 0) return;
    
    const docChanges = Array.from(this.#pendingDocumentChanges);
    this.#pendingDocumentChanges.clear();
    
    log(`Processing deferred document changes for cells: [${docChanges}]`);
    
    if (!this.#changeCollator) return;
    
    if (this.#changeCollator.isEmpty) {
      // Send directly as a simple diff - no other changes pending
      const diffs = [[docChanges, [], [], this.#model.cells.length]];
      log('>>>> Diffs Received (document-only):', JSON.stringify(diffs));
      // TODO: Send these diffs somewhere (e.g., to a display mechanism)
    } else {
      // Add to collator to be combined with other pending changes
      this.#changeCollator.setDocumentChanges(docChanges);
      this.#triggerDebouncedProcessing();
    }
  }

  /** Connect to signals from all cells in the notebook
   */
  #connectToCells() {
    const cells = this.#model.cells;
    for (let i = 0; i < cells.length; i++) {
      this.#connectToCell(cells.get(i));
    }
  }

  /**
   * Sends initial full state when the notebook is first loaded.
   * Creates a full state message with all current cells.
   * @private
   */
  #sendInitialState() {
    if (!this.#model) return;
    
    const cellCount = this.#model.cells.length;
    log(`Sending initial full state with ${cellCount} cells`);
    
    if (cellCount === 0) {
      // Empty notebook - send empty state
      const diffs = [[[/* no cells changed */], [/* no cells added */], [/* no cells removed */], 0]];
      log('>>>> Initial State (empty notebook):', JSON.stringify(diffs));
      // TODO: Send these diffs somewhere (e.g., to a display mechanism)
      return;
    }
    
    // Create a diff that represents all current cells as "changed" (full state)
    const allCellIndexes = Array.from({ length: cellCount }, (_, i) => i);
    const diffs = [[allCellIndexes, [/* no cells added */], [/* no cells removed */], cellCount]];
    
    log('>>>> Initial State (full notebook):', JSON.stringify(diffs));
    // TODO: Send these diffs somewhere (e.g., to a display mechanism)
  }

  /** Connect to a single cell's signals
   * @param {ICellModel} cellModel - The cell model
   */
  #connectToCell(cellModel) {
    const cellId = cellModel.id;
    if (this.#cellSignalHandlers.has(cellId)) return;

    // --- Get signal and define handler for sharedModel ---
    const sharedModelSignal = cellModel.sharedModel.changed;
    const sharedModelHandler = (changedCellModel, change) => {
      if (change.sourceChange) {
        // Defer document changes - don't process immediately (VSCode-style deferral)
        const cellIndex = this.#changeCollator?.getCellIndexById(changedCellModel.id);
        if (cellIndex !== -1 && cellIndex !== undefined) {
          this.#pendingDocumentChanges.add(cellIndex);
          log(`Cell #${cellIndex}: Document change deferred (typing)`);
        }
        return; // Don't trigger debounced processing for source changes
      }
      
      // Process other changes immediately using unified event pattern
      if (this.#changeCollator) {
        const unifiedEvent = this.#createCellChangeEvent(changedCellModel, change);
        this.#changeCollator.addEvent(unifiedEvent);
        this.#triggerDebouncedProcessing();
      }
    };
    sharedModelSignal.connect(sharedModelHandler, this);

    // --- Get signal and define handler for outputs (if code cell) ---
    let outputsSignal = null;
    let outputsHandler = null;
    if (cellModel.type === 'code') {
      outputsSignal = cellModel.outputs.changed;
      outputsHandler = (cellOutputs, change) => {
        // Need to create a CellChange-like object for outputs-only changes
        const outputsOnlyChange = {
          outputsChange: {
            // Get the latest count/state directly from the model outputs
            outputCount: cellModel.outputs.length,
            isEmpty: cellModel.outputs.length === 0
          }
          // No other change types in this synthetic event
        };
        // Pass the original cellModel and the synthetic change object using unified event pattern
        if (this.#changeCollator) {
          const unifiedEvent = this.#createCellChangeEvent(cellModel, outputsOnlyChange);
          this.#changeCollator.addEvent(unifiedEvent);
          this.#triggerDebouncedProcessing();
        }
      };
      outputsSignal.connect(outputsHandler, this);
    }

    // --- Store signals and handlers in the map ---
    this.#cellSignalHandlers.set(cellId, {
      sharedModelSignal,
      sharedModelHandler,
      outputsSignal,
      outputsHandler
    });
  }

  /** Handler for changes in the cells list - feeds changes to the collator
   * @param {IObservableList<ICellModel>} sender - The cells list
   * @param {IObservableList.IChangedArgs<ICellModel>} change - Change arguments
   */
  #onCellsChanged(sender, change) {
    switch (change.type) {
      case 'add':
        change.newValues.forEach(cellModel => this.#connectToCell(cellModel));
        break;

      case 'remove': {
        // Identify which cell IDs are no longer in the model
        const currentCellIds = new Set([...this.#model.cells].map(c => c.id));
        const handlersToRemove = [];

        for (const cellId of this.#cellSignalHandlers.keys()) {
          if (!currentCellIds.has(cellId)) {
            handlersToRemove.push(cellId);
          }
        }

        // Disconnect signals for removed cells
        handlersToRemove.forEach(cellId => {
          const signalsAndHandlers = this.#cellSignalHandlers.get(cellId);
          if (signalsAndHandlers) {
            // Disconnect using the stored signal, handler, and context (this)
            if (signalsAndHandlers.sharedModelSignal && signalsAndHandlers.sharedModelHandler) {
              signalsAndHandlers.sharedModelSignal.disconnect(signalsAndHandlers.sharedModelHandler, this);
            }
            if (signalsAndHandlers.outputsSignal && signalsAndHandlers.outputsHandler) {
              signalsAndHandlers.outputsSignal.disconnect(signalsAndHandlers.outputsHandler, this);
            }
            this.#cellSignalHandlers.delete(cellId); // Remove from map
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
    if (this.#changeCollator) {
      const unifiedEvent = this.#createContentChangeEvent(change);
      this.#changeCollator.addEvent(unifiedEvent);
      this.#triggerDebouncedProcessing();
    }
  }

  /**
   * Clears the existing debounce timer and starts a new one.
   * @private
   */
  #triggerDebouncedProcessing() {
    if (this.#processChangesTimer !== null) {
      clearTimeout(this.#processChangesTimer);
    }
    this.#processChangesTimer = window.setTimeout(() => {
      this.#processChanges();
    }, this.#debounceDelay);
  }

  /**
   * Processes the accumulated changes from the collator.
   * Called after the debounce delay.
   * @private
   */
  #processChanges() {
    this.#processChangesTimer = null; // Clear timer ID
    if (!this.#changeCollator || this.#changeCollator.isEmpty) {
      return;
    }

    if (this.#changeCollator.hasDiffs) {
      // Check if there are any pending executions - don't send diffs if executions are ongoing
      if (this.#changeCollator.pending && this.#changeCollator.pending.size > 0) {
        log(`Skipping diff emission - ${this.#changeCollator.pending.size} executions still pending`);
        // Reset the debounce timer to check again later
        this.#triggerDebouncedProcessing();
        return;
      }

      /** @type {Diff[]} */
      const diffs = this.#changeCollator.getDiffs();
      log('>>>> Diffs Received:', JSON.stringify(diffs)); // Log the diffs for verification

      // TODO: Send these diffs somewhere (e.g., to a display mechanism)

      // Run cleanup if needed to remove dangling summaries
      if (!this.#changeCollator.isEmpty) {
        this.#changeCollator.cleanup();
      }
    }
    if (debug.enabled) {
      if (this.#changeCollator.isEmpty) {
        console.log('     ____ empty collator ____\n');
      } else {
        // This might happen if changes occurred but the conditions for a diff weren't met
        // (e.g., execution started but hasn't finished).
        console.log('     ____ pending changes ____');
        this.#changeCollator.showSummary();
        console.log();
      }
    }
  }

  /** Dispose of the monitor, disconnecting all signals.
   */
  dispose() {
    if (!this.#panel || !this.#model) return;

    // Process any remaining document changes before disposing
    this.#processDocumentChanges();

    // Clear debounce timer
    if (this.#processChangesTimer !== null) {
      clearTimeout(this.#processChangesTimer);
      this.#processChangesTimer = null;
    }

    // Disconnect from notebook-level signals
    this.#notebook?.stateChanged?.disconnect(this.#onNotebookStateChanged, this);
    this.#model.cells.changed.disconnect(this.#onCellsChanged, this);

    // Disconnect from all remaining cell signals
    this.#cellSignalHandlers.forEach((signalsAndHandlers, cellId) => {
      if (signalsAndHandlers.sharedModelSignal && signalsAndHandlers.sharedModelHandler) {
        signalsAndHandlers.sharedModelSignal.disconnect(signalsAndHandlers.sharedModelHandler, this);
      }
      if (signalsAndHandlers.outputsSignal && signalsAndHandlers.outputsHandler) {
        signalsAndHandlers.outputsSignal.disconnect(signalsAndHandlers.outputsHandler, this);
      }
    });
    this.#cellSignalHandlers.clear();

    // Clear pending document changes
    this.#pendingDocumentChanges.clear();

    // Nullify references
    this.#panel = null;
    this.#model = null;
    this.#notebook = null;
    this.#changeCollator = null;
    log('NotebookMonitor: Disposed');
  }

  /**
   * Creates a unified Lab notebook event for cell changes.
   * @param {ICellModel} cellModel - The cell model that changed
   * @param {import('@jupyter/ydoc').CellChange} change - The cell change details
   * @returns {import('./changeCollatorLab.js').LabNotebookEvent}
   * @private
   */
  #createCellChangeEvent(cellModel, change) {
    return {
      cellChanges: [{ cell: cellModel, change }],
      timestamp: Date.now()
    };
  }

  /**
   * Creates a unified Lab notebook event for structural changes.
   * @param {import('@jupyterlab/observables').IObservableList.IChangedArgs<ICellModel>} change - The list change details
   * @returns {import('./changeCollatorLab.js').LabNotebookEvent}
   * @private
   */
  #createContentChangeEvent(change) {
    return {
      contentChanges: [{ change }],
      timestamp: Date.now()
    };
  }

}
