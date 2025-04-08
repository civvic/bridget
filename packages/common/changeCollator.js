import { debug } from './debug.js';
const DEBUG_NAMESPACE = 'nbinspect:coll';
const log = debug(DEBUG_NAMESPACE, 'dimgray');
const logError = debug(`${DEBUG_NAMESPACE}:error`, 'red');

export class ChangeSummary {
  /** @type {boolean | undefined} Indicates if the document/source changed */
  documentChanged;
  /** @type {boolean | undefined} Indicates if metadata changed */
  metadataChanged;
  /** @type {boolean | undefined} Indicates if outputs changed */
  outputsChanged;
  /** @type {boolean | undefined} Indicates if execution state changed */
  executionChanged;
  // Helpers to assess change state
  /** @type {number | undefined} Last known execution count from metadata */
  metadataExecutionCount;
  /** @type {number | undefined} Last known execution order from execution events */
  executionOrder;
  /** @type {boolean | undefined} Last known execution success status */
  executionSuccess;

  constructor(initialChangeType) {
    if (initialChangeType) this[`${initialChangeType}Changed`] = true;
  }

  updateExecution(execUpdate) {
    this.executionChanged = true;
    if (execUpdate.executionOrder !== undefined) this.executionOrder = execUpdate.executionOrder;
    if (execUpdate.success !== undefined) this.executionSuccess = execUpdate.success;
  }

  updateMetadata(execution_count) {
    this.metadataChanged = true;
    if (execution_count !== undefined) this.metadataExecutionCount = execution_count;
  }
}

/**
 * Base class for collating notebook changes.
 * @extends {Map<CellIdx, ChangeSummary>}
 * @abstract
 */
export class ChangeCollator extends Map {
  /** @type {MetadataChange[]} Notebook-level metadata changes */
  metadataChanges = [];
  /** @type {Set<CellIdx>} */
  documentChanges = new Set();
  /** @type {CellAddition[]} */
  added = [];
  /** @type {CellRemoval[]} */
  removed = [];
  /** @type {Map<CellIdx, ChangeSummary>} */
  full = new Map();
  /** @type {Set<CellIdx>} Indexes of cells pending execution completion */
  pending = new Set();
  cellCount = 0;
  /** @type {Diff[]} */
  diffs = [];

  /**
   * @param {number} initialCellCount
   */
  constructor(initialCellCount) {
    if (new.target === ChangeCollator) throw new TypeError('Cannot construct ChangeCollator instances directly');
    super();
    this.cellCount = initialCellCount;
  }

  /**
   * Records a notebook-level metadata change.
   * @protected
   * @param {MetadataChange} change
   */
  _recordNotebookMetadataChange(change) {
    this.metadataChanges.push(change.metadata);
    this.addDiff();
  }

  /**
   * Records a cell metadata change.
   * @protected
   * @param {CellMetadataChangeMetadataChange} change
   */
  _recordCellMetadataChange(cellIndex, change) {
    const { execution_count } = change;
    let summary = this.get(cellIndex);
    if (!summary) {
      // If metadata change is the first thing we see (e.g., execution count update)
      // if (md && md.execution_count !== undefined) return;  // dangling md - should't happen w/out prev exec
      if (execution_count !== undefined) return; // Non-execution metadata change without prior summary? Ignore for now.
      summary = new ChangeSummary('metadata');
      this.set(cellIndex, summary);
    }
    summary.updateMetadata(execution_count);
    // Check if this completes an execution cycles
    if (summary.executionOrder !== undefined && summary.executionOrder === execution_count) {
      // log(`Execution completed by metadata for cell ${cellIndex} (count: ${execution_count})`);
      this.#setFull(cellIndex, summary);
    } else {
        // Still pending or metadata changed independently
        // log(`Metadata change for cell ${cellIndex}, execution count ${execution_count}, 
        //   pending order ${summary.executionOrder}`);
    }
  }

  /**
   * Records a cell execution state update.
   * @protected
   * @param {ExecutionUpdate} change
   */
  _recordExecutionUpdate(cellIndex, change) {
    const { executionOrder, success } = change;
    let summary = this.get(cellIndex);
    if (!summary) {
       // Dangling execution update (e.g., success signal without executionOrder)? Ignore for now.
      //     if (exec && exec.success !== undefined) return;  // dangling exec - should't happen w/out prev exec
      if (executionOrder === undefined) return;
      if (success !== undefined) return;  // dangling exec - should't happen w/out prev exec
      summary = new ChangeSummary('execution');
      this.set(cellIndex, summary);
    }
    // Avoid processing duplicate execution order events
    if (executionOrder !== undefined && summary.executionOrder === executionOrder && summary.executionSuccess === success) {
        // log(`Duplicate execution event ignored for cell ${cellIndex}`);
        return;
    }
    summary.updateExecution({ executionOrder, success });
    if (executionOrder !== undefined) {
      this.pending.add(cellIndex); // Mark as pending execution completion
      // log(`Execution pending for cell ${cellIndex} (order: ${executionOrder})`);
    }
    // Check if this completes an execution cycle (matches existing metadata count)
    const exeCount = summary.metadataExecutionCount;
    if (success !== undefined && exeCount !== undefined && exeCount === executionOrder) {
        // log(`Execution completed by success status for cell ${cellIndex} (order: ${executionOrder})`);
        this.#setFull(cellIndex, summary);
    } else if (success !== undefined) {
        // Execution finished, but metadata hasn't caught up or doesn't match
        // log(`Execution finished for cell ${cellIndex} (order: ${executionOrder}), 
        //   success: ${success}, metadata count: ${exeCount}`);
        // We might still need to mark as full if it's definitely done,
        // even if counts mismatch (depends on desired behavior for errors/interrupts)
        // For now, we only mark full when counts match.
    }
  }

  /**
   * Records a cell document/source edit.
   * @protected
   * @param {CellIdx} cellIndex
   */
  _recordDocumentEdit(cellIndex) {
    let summary = this.get(cellIndex);
    if (!summary) {
      summary = new ChangeSummary('document');
      this.set(cellIndex, summary);
    }
    // Avoid duplicate document change flags if already set in this cycle
    if (summary.documentChanged) return;
    summary.documentChanged = true;
    this.documentChanges.add(cellIndex);
    log(`Document edit recorded for cell ${cellIndex}`);
  }

  /**
   * Records an outputs update for a cell.
   * @protected
   * @param {OutputsUpdate} change
   */
  _recordOutputsUpdate(cellIndex, change) {
    const { isEmpty } = change;
    let summary = this.get(cellIndex);
    if (!summary) {
      summary = new ChangeSummary('outputs');
      this.set(cellIndex, summary);
    }
    summary.outputsChanged = true;
    // log(`Outputs updated for cell ${cellIndex}, count: ${outputCount}, isEmpty: ${isEmpty}`);

    // Outputs updates often signify the end of a change cycle, especially clearing outputs.
    if (isEmpty) {
        // log(`Empty outputs marking cell ${cellIndex} as full.`);
        this.#setFull(cellIndex, summary);
    }
    // Also handle the case where outputs appear without prior execution info (e.g., display handle updates)
    else if (summary.executionOrder === undefined && summary.metadataExecutionCount === undefined) {
      // log(`Dangling outputs marking cell ${cellIndex} as full.`);
      this.#setFull(cellIndex, summary);
    }
  }

  /**
   * Records the addition of cells.
   * @protected
   * @param {CellAddition} change
   */
  _recordCellAddition(change, cellCount) {
    this.added.push(change);
    this.cellCount = cellCount;
    log(`Cells added starting at index ${change.startIndex}, new count: ${this.cellCount}`);
    this.addDiff();
  }

  /**
   * Records the removal of cells.
   * @protected
   * @param {CellRemoval} change
   */
  _recordCellRemoval(change, cellCount) {
    this.removed.push(change);
    this.cellCount = cellCount;
    log(`Cells removed from index ${change.startIndex} to ${change.endIndex}, new count: ${this.cellCount}`);
    this.addDiff();
  }

  get hasDocumentChanges() {
    return this.documentChanges.size > 0;
  }

  setDocumentChanges(cellIdxs) {
    cellIdxs.forEach(idx => {
      if (this.full.has(idx)) return;
      this._recordDocumentEdit(idx);
    });
  }

  get hasDiffs() {
    return this.#hasChanges() || this.diffs.length > 0;
  }

  get isEmpty() {
    return (this.size === 0 && this.full.size === 0 && this.pending.size === 0 &&
            this.added.length === 0 && this.removed.length === 0 &&
            this.diffs.length === 0);
  }

  /** @returns {Diff[]} */
  getDiffs() {
    this.addDiff();
    return this.diffs.splice(0, this.diffs.length);
  }

  addDiff() {
    const all = this.#getDiffs();
    if (all) this.diffs.push(all);
  }

  #getDiffs() { // Keep as is for now (relies on #hasChanges, #setFull, #getChanges, #getContentChanges)
    if (this.#hasChanges()) {
      this.documentChanges.forEach(idx => this.has(idx) && this.#setFull(idx, this.get(idx)));
      this.documentChanges.clear();
      let full = this.#getChanges();
      let { added, removed } = this.#getContentChanges();
      // Ensure 'added' and 'removed' structures match the Diff typedef expectation
      // The Diff typedef uses:
      // Added = {start:CellIdx, cellIdxs:CellIdxs}
      // Removed = NotebookRange = {start: number, end: number}
      // Our internal types are:
      // CellAddition = {timestamp, startIndex, addedCellIndexes}
      // CellRemoval = {timestamp, startIndex, endIndex, removedCount}
      // We need to map internal -> external format in #getContentChanges
      const formattedAdded = added.map(a => ({ start: a.startIndex, cellIdxs: a.addedCellIndexes }));
      // Assuming NotebookRange is {start: number, end: number}
      const formattedRemoved = removed.map(r => ({ start: r.startIndex, end: r.endIndex }));
      return [full, formattedAdded, formattedRemoved, this.cellCount];
    }
  }

  /**
   * Sets a cell change as "full" (completely processed) and cleans up related state
   * @private
   * @param {CellIdx} cellIndex - Index of the cell
   * @param {ChangeSummary} summary - Change summary
   */
  #setFull(cellIndex, summary) { // Updated parameter type
    if (!summary) {
        // logError(`Attempted to #setFull for cell ${cellIndex} without a summary.`);
        return;
    }
    // log(`Setting cell ${cellIndex} to full.`);
    this.full.set(cellIndex, summary);
    this.delete(cellIndex);  // Remove from pending changes map (this)
    this.pending.delete(cellIndex);  // Remove from execution pending set
  }

  #getContentChanges() {
    const added = this.added.splice(0, this.added.length);
    // When cells are added, we might have temporary summaries for them in the main map
    // that need clearing if they weren't otherwise marked 'full'.
    added.forEach(({ addedCellIndexes }) => addedCellIndexes.forEach(idx => this.delete(idx)));

    const removed = this.removed.splice(0, this.removed.length);
    // When cells are removed, clear any pending state for them
    removed.forEach(({ startIndex, endIndex }) => {
        for (let i = startIndex; i < endIndex; i++) {
            this.delete(i);
            this.full.delete(i);
            this.pending.delete(i);
            this.documentChanges.delete(i);
        }
        // TODO: Adjust indexes of subsequent cells in internal state maps/sets?
        // This is tricky. If diffs are processed immediately, the consumer handles re-indexing.
        // If state persists across diffs, the collator needs to re-index its own keys.
        // Given the transient nature, let's assume consumers handle re-indexing based on diffs.
    });
    return { added, removed };
  }

  #hasChanges() {
    // Should generate diff if pending executions are done OR if there are structural/doc changes.
    return Boolean(this.pending.size === 0 &&
      (this.documentChanges.size || this.full.size || this.added.length || this.removed.length));
  }

  #getChanges() {
    const full = [...this.full.keys()];
    this.full.clear(); // Clear the processed 'full' state
    return full;
  }

}

/** @param {NotebookDocumentChangeEvent} evt */
export function eventSummary(evt) {
  let chs = [];
  if (evt.cellChanges.length > 0) {
    const cellChs = [];
    evt.cellChanges.forEach(ch => {
      const cc = [];
      cc.push(`${ch.cell.index}`);
      if (ch.executionSummary) {
        cc.push('x');
        if (ch.executionSummary.executionOrder !== undefined) cc.push(`${ch.executionSummary.executionOrder}`);
        if (ch.executionSummary.success !== undefined) cc.push(`${ch.executionSummary.success}`);
      }
      if (ch.metadata) {
        cc.push('m');
        if (ch.metadata.execution_count !== undefined) cc.push(`${ch.metadata.execution_count}`);
      }
      if (ch.document) cc.push('d');
      if (ch.outputs) {
        cc.push('o');
        if (ch.outputs.length > 0) cc.push(`${ch.outputs.length}`);
      }
      cellChs.push(`ch_${cc.join('_')}`);
    });
    chs.push(cellChs.join(' '));
  }
  if (evt.contentChanges.length > 0) {
    const cntChs = [];
    evt.contentChanges.forEach(ch => {
      const cc = [];
      if (ch.addedCells.length > 0) cc.push('a', ch.addedCells.map(c => c.index).join(','));
      if (ch.removedCells.length > 0) cc.push('r', `${ch.range.start},${ch.range.end}`);
      cntChs.push(`cn_${cc.join('_')}`);
    });
    chs.push(cntChs.join(' '));
  }
  if (evt.metadata) {
    chs.push('md');
    if (evt.metadata.execution_count !== undefined) chs.push(`${evt.metadata.execution_count}`);
  }
  return `${chs.join(' | ')}`;
}

/** 
 * @typedef {number} TimeStamp
 * @typedef {number} CellIdx
 * @typedef {CellIdx[]} CellIdxs - changed cells indexes
 * @typedef {{start:CellIdx, cellIdxs:CellIdxs}} Added - cell indexes added at starting index
 * @typedef {NotebookRange} Removed
 * @typedef {Set<CellIdx>} HasDocumentChanges
 * @typedef {[CellIdxs, Added[], Removed[], number]} Diff
 */

/**
 * Represents a change to notebook-level metadata.
 * @typedef {Object} MetadataChange
 * @property {{[key: string]: any}} metadata - The changed metadata key-value pairs.
 */

/**
 * Represents a change to a cell's metadata.
 * @typedef {Object} CellMetadataChangeMetadataChange
 * @property {{[key: string]: any}} metadata - The changed metadata key-value pairs.
 * @property {number} [execution_count] - Optional execution count if relevant.
 */

/**
 * Represents the addition of cells.
 * @typedef {Object} CellAddition
 * @property {CellIdx} startIndex - The index where cells were inserted.
 * @property {CellIdx[]} addedCellIndexes - The indexes of the newly added cells.
 */

/**
 * Represents the removal of cells.
 * @typedef {Object} CellRemoval
 * @property {CellIdx} startIndex - The starting index of the removed range.
 * @property {CellIdx} endIndex - The ending index of the removed range.
 * @property {number} removedCount - How many cells were removed.
 */

/**
 * Represents an update to a cell's execution state.
 * @typedef {Object} ExecutionUpdate
 * @property {number} [executionOrder] - The execution order number, if applicable.
 * @property {boolean} [success] - The success status, if applicable (end of execution).
 */

/**
 * Represents an update to a cell's outputs.
 * @typedef {Object} OutputsUpdate
 * @property {number} outputCount - The new number of outputs.
 * @property {boolean} isEmpty - True if the outputs array is now empty.
 */

/** @typedef {import('vscode').NotebookDocumentChangeEvent} NotebookDocumentChangeEvent */
/** @typedef {import('vscode').NotebookDocumentContentChange} NotebookDocumentContentChange */
/** @typedef {import('vscode').NotebookDocumentCellChange} NotebookDocumentCellChange */
/** @typedef {import('vscode').NotebookRange} NotebookRange */
