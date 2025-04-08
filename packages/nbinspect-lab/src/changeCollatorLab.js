import { ChangeCollator } from './common/changeCollator.js';
import { debug } from './common/debug.js';

const log = debug('collator:lab', 'purple');
const logError = debug('collator:lab:error', 'red');

/**
 * @typedef {import('@jupyterlab/notebook').INotebookModel} INotebookModel
 * @typedef {import('@jupyterlab/cells').ICellModel} ICellModel
 * @typedef {import('@jupyter/ydoc').CellChange} CellChange
 * @typedef {import('@jupyterlab/observables').IObservableList} IObservableList
 */

/**
 * Concrete implementation of ChangeCollator for JupyterLab Notebooks.
 * Translates JupyterLab/Yjs cell and model changes into calls
 * to the abstract ChangeCollator base class methods.
 * @extends {ChangeCollator}
 */
export class ChangeCollatorLab extends ChangeCollator {
  /** @type {INotebookModel} The JupyterLab notebook model */
  #model;

  /**
   * Creates an instance of ChangeCollatorLab.
   * @param {INotebookModel} model The notebook model to monitor.
   */
  constructor(model) {
    if (!model) {
      throw new Error('ChangeCollatorLab requires a valid INotebookModel.');
    }
    const initialCellCount = model.cells.length;
    super(initialCellCount); // Pass initial cell count to base
    this.#model = model;
    log('Initialized ChangeCollatorLab with cell count:', initialCellCount);
  }

  /**
   * Processes changes originating from a specific cell's shared model.
   * @param {ICellModel} cellModel The cell model whose shared model changed.
   * @param {CellChange} change The details of the change from Yjs.
   */
  addCellChange(cellModel, change) {
    const cellId = cellModel.id;
    const cellIndex = this.#getCellIndexById(cellId); // Helper needed

    if (cellIndex === -1) {
      logError(`addCellChange: Could not find index for cell ID ${cellId}. Ignoring change.`);
      return;
    }

    const { sourceChange, attachmentsChange, outputsChange, executionCountChange,
            executionStateChange, metadataChange } = change;

    // --- Translate and call base class methods ---

    if (sourceChange) {
      this._recordDocumentEdit(cellIndex);
    }

    if (executionCountChange || metadataChange?.execution_count) {
      const count = executionCountChange?.newValue ?? cellModel.getMetadata('execution_count');
      this._recordCellMetadataChange(cellIndex, { execution_count: count });
    } else if (metadataChange) {
        log(`... Cell #${cellIndex}: Other metadata changed (not processed by base class)`, metadataChange);
    }

    if (outputsChange) {
      const count = cellModel.outputs.length;
      const empty = count === 0;
      this._recordOutputsUpdate(cellIndex, { outputCount: count, isEmpty: empty });
    }

    if (executionStateChange) {
      const newState = executionStateChange.newValue;
      const oldState = executionStateChange.oldValue;

      const executionOrder = cellModel.getMetadata('execution_count') ?? undefined;

      if (newState === 'running') {
        this._recordExecutionUpdate(cellIndex, { executionOrder: executionOrder });
      } else if (newState === 'idle' && oldState === 'running') {
        this._recordExecutionUpdate(cellIndex, { executionOrder: executionOrder, success: true });
      } else if (newState === 'idle' && oldState !== 'running') {
        log(`... Cell #${cellIndex}: Execution ended without running (state: ${newState}, old: ${oldState}). Not marking success.`);
      }
    }

    if (attachmentsChange) {
      log(`... Cell #${cellIndex}: Attachments changed (not processed by base class)`);
    }
  }

  /**
   * Processes changes to the list of cells in the notebook model (add/remove/move).
   * @param {IObservableList.IChangedArgs<ICellModel>} change Change details.
   */
  addCellsListChange(change) {
    const { type, oldIndex, newIndex, oldValues, newValues } = change;
    const currentCellCount = this.#model.cells.length;

    switch (type) {
      case 'add':
        const addedIndexes = newValues.map(cell => this.#getCellIndexById(cell.id));
        const validAddedIndexes = addedIndexes.filter(idx => idx !== -1);
        if (validAddedIndexes.length !== newValues.length) {
            logError("Could not find indexes for all added cells immediately.");
        }
        this._recordCellAddition({ startIndex: newIndex, addedCellIndexes: validAddedIndexes }, currentCellCount);
        break;

      case 'remove':
        const removedCount = oldValues.length;
        const endIndex = oldIndex + removedCount;
        this._recordCellRemoval({ startIndex: oldIndex, endIndex: endIndex, removedCount: removedCount }, currentCellCount);
        break;

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
   * @private
   * @param {string} cellId The ID of the cell to find.
   * @returns {number} The current index, or -1 if not found.
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

  // TODO: Implement cleanup() if specific Lab cleanup logic is needed.
  // cleanup() {
  //   log('Running ChangeCollatorLab cleanup');
  //   // Add Lab-specific cleanup if required
  //   super.cleanup(); // Call base cleanup if it exists and is relevant
  // }

  // TODO: Implement showSummary() for Lab-specific debugging if needed.
  // showSummary() {
  //   if (!debug.enabled) return;
  //   log('**** ChangeCollatorLab Summary ****');
  //   // Add Lab-specific details to the summary
  //   super.showSummary(); // Call base summary
  // }
} 