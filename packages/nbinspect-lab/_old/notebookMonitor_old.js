debugger;

import { debug } from './common/debug.js';
// import { ChangeCollator } from './changeCollator.js';
const log = debug('monitor', 'darkgreen');

/**
 * @typedef {import('@jupyterlab/notebook').INotebookModel} INotebookModel
 * @typedef {import('@jupyterlab/notebook').NotebookPanel} NotebookPanel
 * @typedef {import('@jupyterlab/cells').ICellModel} ICellModel
 * @typedef {import('@jupyter/ydoc').SourceChange} SourceChange
 * @typedef {import('@jupyter/ydoc').CellChange} CellChange
 */

/** @typedef {{doc?: any, attach?: any, outs?: any, exeCount?: any, exeState?: any, md?: any}} CellChanges */

/**
 * Monitors a notebook for cell changes, processing them when selection changes.
 */
export class NotebookMonitor {
  /** @type {NotebookPanel} */
  #panel = null;
  /** @type {INotebookModel} */
  #model = null;
  /** @type {NotebookPanel} */
  #notebook = null;
  // /** @type {ChangeCollator | null} Reference to the change collator */
  // #changeCollator = null;
  /** @type {Map<string, CellChanges>} - IDs of cells with pending changes */
  #pendingChanges = new Map();
  /** @type {Map<string, CellChanges>} - IDs of changed cells */
  #changedCells = new Map();
  /** @type {Map<string, Function>} - Cell signal handlers by cell ID */
  #cellSignalHandlers = new Map();

  // #changeTracker;

  /** Creates an instance of NotebookMonitor.
   * @param {NotebookPanel} panel - The notebook panel to monitor
   */
  constructor(panel) {
    this.#panel = panel;
    this.#model = panel.model;
    this.#notebook = panel.content;
    // this.#changeTracker = { collator: this.#changeCollator, timer: null, delay: 500 };

    this.#connectSignals();
    log('NotebookMonitor: Attached to notebook panel');
  }

  /** Connects to the notebook's signals.
   */
  #connectSignals() {
    if (!this.#notebook || !this.#model) return;
    const notebook = this.#notebook;
    // Listen for active cell changes
    // notebook.activeCellChanged.connect(this.#onActiveCellChanged, this);
    // Listen for edit mode changes
    notebook.stateChanged.connect(this.#onNotebookStateChanged, this);
    notebook.modelContentChanged.connect(this.#onModelContentChanged, this);
    
    // Listen for cells list changes (structural changes)
    this.#model.cells.changed.connect(this.#onCellsChanged, this);
    // Connect to existing cells
    this.#connectToCells();
  }

  #onModelContentChanged(notebook) {
    log(`onModelContentChanged active cell: ${this.#panel.content.activeCellIndex}`);
  }

  #onNotebookStateChanged(notebook, changed) {
    log(`onStateChanged active cell: ${this.#panel.content.activeCellIndex}`, changed);
    switch (changed.name) {
      case 'mode':
        if (changed.newValue === 'command') {
          this.#processChangedCells();
        }
        break;
      case 'activeCellIndex':
        this.#processChangedCells();
        break;
    }
  }

  /** Handler for active cell changes - processes pending changes.
 * @param {Object} sender - The notebook content
 * @param {Object} newCell - The new active cell
 */
  // #onActiveCellChanged(notebook, ...args) {
  //   this.#processChangedCells();
  // }
  
  
  /** Connect to signals from all cells in the notebook
   */
  #connectToCells() {
    const cells = this.#model.cells;
    for (let i = 0; i < cells.length; i++) {
      this.#connectToCell(cells.get(i));
    }
  }

  /** Connect to a single cell's signals
   * @param {ICellModel} cellModel - The cell model
   */
  #connectToCell(cellModel) {
    const cellId = cellModel.id;
    if (this.#cellSignalHandlers.has(cellId)) return;
    cellModel.sharedModel.changed.connect(this.#onCellChanged, this);
    
    const cellIndex = this.#getCellIndexById(cellId);
    // const cellIndex = this.#notebook._findCellById(cellId);

    const handlers = {
      // state: (sender, ...args) => {
      //   // if (!this.#pendingChanges.has(cellId)) this.#pendingChanges.set(cellId, {});
      //   // this.#pendingChanges.get(cellId).state = args;
      //   log(`Cell #${cellIndex}/${cellId} state changed`, args);
      // },
      metadata: (sender, changes) => {
        // if (!this.#pendingChanges.has(cellId)) this.#pendingChanges.set(cellId, {});
        // this.#pendingChanges.get(cellId).metadata = changes;
        log(`Cell #${cellIndex}/${cellId} metadata changed`, changes);
      },
      outputs: null // Will set for code cells below
    };
    // Connect to state & metadata changes for all cell types
    cellModel.metadataChanged.connect(handlers.metadata);
    // cellModel.stateChanged.connect(handlers.state);
    
    // Connect to outputs changes for code cells only
    if (cellModel.type === 'code') {
      handlers.outputs = (sender, ...changes) => {
        for (const chg of changes) {
          const { type, oldIndex, oldValues, newIndex, newValues } = chg;
          let changed = false;
          if (type === 'remove') {
            if (oldIndex === newIndex && oldValues.length === newValues.length) { // No change
              return;
            } else { // Output removed
              changed = true;
            }
          } else if (type === 'add') { // Output added
            changed = true;
          } else { 
            changed = true;
          }
          if (changed) {
            const cellIndex = this.#getCellIndexById(cellId);
            let changes = this.#changedCells.get(cellId) ?? this.#pendingChanges.get(cellId);
            if (!changes) { changes = {}; this.#pendingChanges.set(cellId, changes); }
            changes.outs = true;
            log(`**Cell #${cellIndex}/${cellId} changed:`, 'outputs');
            if (!this.#changedCells.has(cellId)) {
              this.#pendingChanges.delete(cellId);
              this.#changedCells.set(cellId, changes);
              log(`.... Cell #${cellIndex}/${cellId} queued for processing`);
            }
          }
        }
      };
      cellModel.outputs.changed.connect(handlers.outputs, this);
    }
    
    // Store handlers for later disconnection
    this.#cellSignalHandlers.set(cellId, handlers);
  }

  /** Handler for cell changes - tracks which cells changed.
   * @param {ICellModel} cellModel - The cell model
   * @param {CellChange} cellChange - The cell change
   */
  #onCellChanged(cellModel, cellChange) {
    const cellId = cellModel.id;
    // TODO: Feed changes into the collator instance
    // if (this.#changeCollator) {
    //   this.#changeCollator.collate(Date.now(), cellChange); // Need a Lab-specific 'collate' or 'addEvent'
    // }
    // if (this.#changedCells.has(cellId)) return;
    let changes = this.#changedCells.get(cellId) ?? this.#pendingChanges.get(cellId);

    const cellIndex = this.#getCellIndexById(cellId);
    const { sourceChange, attachmentsChange, outputsChange, executionCountChange, 
      executionStateChange, metadataChange } = cellChange;
    if (sourceChange && changes?.doc) return;
    log(`Cell #${cellIndex}/${cellId} changed:`, 
      (sourceChange ? ' source' : '') +
      (attachmentsChange ? ' attachments' : '') +
      (outputsChange ? ' outputs' : '') +
      (executionCountChange ? ` executionCount: ${executionCountChange.newValue}` : '') +
      (executionStateChange ? ` executionState: ${executionStateChange.newValue}` : '') +
      (metadataChange ? ` metadata: ${metadataChange}` : '')
    );
    // if (!this.#pendingChanges.has(cellId)) this.#pendingChanges.set(cellId, {});
    if (!changes) { changes = {}; this.#pendingChanges.set(cellId, changes); }
    if (sourceChange) changes.doc = true;
    if (attachmentsChange) changes.attach = true;
    if (executionCountChange) changes.exeCount = executionCountChange.newValue;
    if (metadataChange) changes.md = true;
    if (outputsChange) {
        changes.outs = true;
        if (!this.#changedCells.has(cellId)) {
          this.#pendingChanges.delete(cellId);
          this.#changedCells.set(cellId, changes);
          log(`.... Cell #${cellIndex}/${cellId} queued for processing`);
        }
        // return;
    }
    if (executionStateChange) {
      changes.exeState = executionStateChange.newValue;
      const { oldValue, newValue } = executionStateChange;
      if (oldValue === 'running' && newValue === 'idle') {
        if (!this.#changedCells.has(cellId)) {
          this.#pendingChanges.delete(cellId);
          this.#changedCells.set(cellId, changes);
          log(`.... Cell #${cellIndex}/${cellId} queued for processing`);
        }
        // return;
      } 
    }
  }

  /** Handler for content changes - tracks which cells changed.
   */
  // #onContentChanged(sender) {
  //   // Since JupyterLab doesn't provide explicit cell change info in the contentChanged signal,
  //   // we track the currently active cell ID since that's likely what changed
  //   const activeCell = this.#panel.content.activeCell;
  //   if (activeCell) {
  //     const cellId = activeCell.model.id;
  //     if (!this.#pendingChanges.has(cellId)) this.#pendingChanges.set(cellId, {});
  //     if (this.#pendingChanges.get(cellId).doc) return;
  //     this.#pendingChanges.get(cellId).doc = true;
  //     log(`Cell #${this.#getCellIndexById(cellId)}/${cellId} content changed`);
  //   }
  // }

  /** Process all pending changes.
   */
  #processChangedCells() {
    for (const [cellId, changes] of [...this.#pendingChanges.entries()]) {
      if (changes.doc) {
        this.#pendingChanges.delete(cellId);
        this.#changedCells.set(cellId, changes);
      }
    }

    const hasChanges = this.#changedCells.size > 0;
    if (!hasChanges) return;

    log('Processing changed cells:');

    /** @type {{index: number, id: string, type: string, changes: string[]}[]} */
    const changed = [];
    
    for (const [cellId, changes] of this.#changedCells.entries()) {
      // Find the cell with this ID
      const cellIndex = this.#getCellIndexById(cellId);
      if (cellIndex !== -1) {
        const cellModel = this.#model.cells.get(cellIndex);
        if (cellModel) {
          const changeTypes = [];
          if (changes.doc) changeTypes.push('document');
          if (changes.attach) changeTypes.push('attachments');
          if (changes.outs) changeTypes.push('outputs');
          if (changes.exeCount) changeTypes.push('executionCount');
          if (changes.exeState) changeTypes.push('executionState');
          if (changes.md) changeTypes.push('metadata');
          
          changed.push({
            index: cellIndex,
            id: cellId,
            type: cellModel.type,
            changes: changeTypes
          });
        }
      }
    }

    // Log the changes
    log('---- Changed cells processed:', changed.map(c => [c.index, c.changes].join(':')));
    // Clear all pending changes
    this.#changedCells.clear();
    // log the pending changes
    log('---- Pending changes:', Array.from(this.#pendingChanges.entries()).map(([id]) => id).join(', '));
  }

  /** Handler for changes in the cells list - tracks cell additions, removals, and moves
   * @param {IObservableList<ICellModel>} sender - The cells list
   * @param {IObservableList.IChangedArgs<ICellModel>} args - Change arguments
   */
  #onCellsChanged(sender, change) {
    const { newIndex, newValues, oldIndex, oldValues, type } = change;
    switch (type) {
      case 'add':
        log(`Cells added: ${newValues.length} starting at ${newIndex}`);
        newValues.forEach(cellModel => {
          this.#connectToCell(cellModel);
          // this.#changedCells.set(cellModel.id, {});
          log(`Cell added with ID ${cellModel.id} @ ${this.#getCellIndexById(cellModel.id)}`);
        });
        break;
        
      case 'remove':
        log(`Cells removed: ${oldValues.length} starting at ${oldIndex}`);
        // for (let idx = oldIndex; idx < oldIndex + oldValues.length; idx++) {}
        break;
        
      case 'move':
        // With cell IDs, we don't need to do anything special for moves
        log(`Cell moved from ${oldIndex} to ${newIndex}`);
        break;
    }
    
    // After structural changes, process any pending changes
    this.#processChangedCells();
  }

  /** Dispose of the monitor, disconnecting all signals.
   */
  dispose() {
    if (!this.#panel || !this.#model) return;

    // Process any remaining changes
    this.#processChangedCells();

    // Disconnect from notebook signals
    // this.#model.contentChanged.disconnect(this.#onContentChanged, this);
    // this.#panel.content.activeCellChanged.disconnect(this.#onActiveCellChanged, this);
    this.#model.cells.changed.disconnect(this.#onCellsChanged, this);

    // // Disconnect from all cell signals
    this.#cellSignalHandlers.forEach((handlers, cellId) => {
      const cellIndex = this.#getCellIndexById(cellId);
      if (cellIndex !== -1) {
        const cellModel = this.#model.cells.get(cellIndex);
        if (cellModel) {
          // cellModel.stateChanged.disconnect(handlers.state);
          cellModel.metadataChanged.disconnect(handlers.metadata);
          if (cellModel.type === 'code' && handlers.outputs) {
            cellModel.outputs.changed.disconnect(handlers.outputs);
          }
        }
      }
    });
    this.#cellSignalHandlers.clear();

    this.#pendingChanges.clear();
    this.#changedCells.clear();
    this.#panel = null;
    this.#model = null;
    this.#notebook = null;
    log('NotebookMonitor: Disposed');
  }

  /** Helper to get cell index by ID
   * @param {string} cellId - The cell ID to find
   * @returns {number} - The cell index or -1 if not found
   */
  #getCellIndexById(cellId) {
    const cells = this.#model.cells;
    for (let i = 0; i < cells.length; i++) {
      if (cells.get(i).id === cellId) {
        return i;
      }
    }
    return -1;
  }
}
