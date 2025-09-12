import { debug } from './debug.js';
const DEBUG_NAMESPACE = 'nb:collator';
const log = debug(DEBUG_NAMESPACE, 'dimgray');
// const logError = debug(`${DEBUG_NAMESPACE}:error`, 'red');

export class ChangeSummary {
  /** @type {boolean | undefined} Indicates if the document/source changed */
  documentChanged;
  /** @type {boolean | undefined} Indicates if metadata changed */
  metadataChanged;
  /** @type {boolean | undefined} Indicates if outputs changed */
  outputsChanged;
  /** @type {boolean | undefined} Indicates if execution state changed */
  executionChanged;
  // Helpers to assess execution state change (VSCode mostly)
  /** @type {number | null | undefined} Last known execution count from metadata */
  metadataExecutionCount;
  /** @type {'running' | 'finished' | undefined} Last known execution status */
  executionStatus;
  /** @type {number | null | undefined} Timestamp of the last change */
  timestamp;

  constructor(initialChangeType) {
    this.update(initialChangeType);
  }

  update(changeType) {
    if (changeType) {
      this[`${changeType}Changed`] = true;
      this.timestamp = Date.now();
    }
  }

  updateExecution(executionStatus) {
    this.executionChanged = true;
    this.executionStatus = executionStatus;
    this.timestamp = Date.now();
  }

  updateMetadata(execution_count) {
    this.metadataChanged = true;
    this.metadataExecutionCount = execution_count;
    this.timestamp = Date.now();
  }
}

/**
 * Base class for collating notebook changes.
 * @extends {Map<CellIdx, ChangeSummary>}
 * @abstract
 */
export class ChangeCollator extends Map {
  /** @type {MetadataChange[]} Notebook-level metadata changes */
  metadataChanges = null;
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

  getSummary(cellIndex, summaryType) {
    let summary = this.get(cellIndex) || this.full.get(cellIndex);
    if (!summary) {
      summary = new ChangeSummary(summaryType);
      this.set(cellIndex, summary);
    } else {
      summary.update(summaryType);
    }
    return summary;
  }

  _setFull(cellIndex, summary) { // Updated parameter type
    this.full.set(cellIndex, summary);
    this.delete(cellIndex);  // Remove from pending changes map (this)
    this.pending.delete(cellIndex);  // Remove from execution pending set
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
    this._setFull(cellIndex, summary);
  }

  /**
   * Records a notebook-level metadata change.
   * @protected
   * @param {MetadataChange} change
   */
  _recordNotebookMetadataChange(change) {
    // Not sure what to do with this yet.
    this.metadataChanges = change.metadata;
    this.addDiff();
  }

  _executionCompleted(cellIndex, summary) {
    // Check complete execution cycle
    // need this because count updates comes sometimes before, others after ending execution
    if (this.pending.has(cellIndex) && summary.metadataExecutionCount !== undefined && summary.executionStatus === 'finished') {
      this.#setFull(cellIndex, summary);
      // log(`Execution completed cell ${cellIndex}`);
    }
  }

  /**
   * Records a cell metadata change.
   * @protected
   * @param {CellMetadataChange} change
   */
  _recordCellMetadataChange(cellIndex, change) {
    const { execution_count } = change;
    const summary = this.getSummary(cellIndex, 'metadata');
    summary.updateMetadata(execution_count);
    this._executionCompleted(cellIndex, summary);
  }

  /**
   * Records a cell execution state update.
   * @protected
   * @param {ExecutionUpdate} change
   */
  _recordExecutionUpdate(cellIndex, status) {
    const summary = this.getSummary(cellIndex, 'execution');
    summary.updateExecution(status);
    // Track pending executions
    if (status === 'running') {
      this.pending.add(cellIndex);
      if (this.full.has(cellIndex)) {
        this.set(cellIndex, summary);
        this.full.delete(cellIndex);
      }
    } else if (status === 'finished') {
      this.#setFull(cellIndex, summary);
      log(`Execution completed cell ${cellIndex}`);
    }
    this._executionCompleted(cellIndex, summary);
  }

  /**
   * Records a cell document/source edit.
   * @protected
   * @param {CellIdx} cellIndex
   */
  _recordDocumentEdit(cellIndex) {
    // Avoid duplicate document change flags if already set in this cycle
    if (this.get(cellIndex)?.documentChanged) return;
    this.getSummary(cellIndex, 'document');
    this.documentChanges.add(cellIndex);
    log(`Document edit cell ${cellIndex}`);
  }

  /**
   * Records outputs update for a cell.
   * @protected
   * @param {OutputsUpdate} change
   */
  // eslint-disable-next-line no-unused-vars
  _recordOutputsUpdate(cellIndex, change) {
    const summary = this.getSummary(cellIndex, 'outputs');
    if (summary.executionChanged === undefined) {
      if (!this.full.has(cellIndex)) {
        // outputs appear outside of execution cycle (e.g., display handle updates or clear outputs)
        // log(`.... Dangling outputs: cell ${cellIndex} -> full.`);
      }
      this.#setFull(cellIndex, summary);
    }
  }

  /**
   * Records the addition of cells.
   * @protected
   * @param {CellAddition} change
   */
  _recordCellAddition(change) {
    this.added.push(change);
    this.cellCount += change.addedCellIndexes.length;
    log(`Cells added starting at index ${change.startIndex}, new count: ${this.cellCount}`);
    this.addDiff();
  }

  /**
   * Records the removal of cells.
   * @protected
   * @param {CellRemoval} change
   */
  _recordCellRemoval(change) {
    this.removed.push(change);
    this.cellCount -= change.removedCount;
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

  hasChanges() {
    // Should generate diff if pending executions are done OR if there are structural/doc changes.
    return Boolean(this.pending.size === 0 &&
      (this.documentChanges.size || this.full.size || this.added.length || this.removed.length));
  }

  /** @returns {CellIdx[]} */
  #getChanges() {
    const full = [...this.full.keys()];
    this.full.clear(); // Clear the processed 'full' state
    return full;
  }

  get hasDiffs() {
    return this.hasChanges() || this.diffs.length > 0;
  }

  get isEmpty() {
    return (this.size === 0 && this.full.size === 0 && this.pending.size === 0 &&
            this.added.length === 0 && this.removed.length === 0 &&
            this.diffs.length === 0);
  }

  /**
   * @returns {[CellIdx[], Added[], Removed[], number]}
   */
  #getDiffs() {
    if (this.hasChanges()) {
      this.documentChanges.forEach(idx => this.has(idx) && this.#setFull(idx, this.get(idx)));
      this.documentChanges.clear();
      let full = this.#getChanges();
      let { added, removed } = this.#getContentChanges();
      // map internal format -> "diff" format
      /** @type {Added[]} */
      const diffAdded = added.map(a => ({ start: a.startIndex, cellIdxs: a.addedCellIndexes }));
      /** @type {Removed[]} */
      const diffRemoved = removed.map(r => ({ start: r.startIndex, end: r.endIndex }));
      return [full, diffAdded, diffRemoved, this.cellCount];
    }
  }

  addDiff() {
    const all = this.#getDiffs();
    if (all) this.diffs.push(all);
  }
  
  /** @returns {Diff[]} */
  getDiffs() {
    this.addDiff();
    return this.diffs.splice(0, this.diffs.length);
  }

  #clearCell(cellIndex) {
    this.delete(cellIndex);
    this.full.delete(cellIndex);
    this.pending.delete(cellIndex);
    this.documentChanges.delete(cellIndex);
  }

  #getContentChanges() {
    const added = this.added.splice(0, this.added.length);
    // When cells are added, we might have temporary summaries for them in the main map
    // that need clearing if they weren't otherwise marked 'full'.
    added.forEach(({ addedCellIndexes }) => addedCellIndexes.forEach(idx => this.#clearCell(idx)));

    const removed = this.removed.splice(0, this.removed.length);
    // When cells are removed, clear any pending state for them
    removed.forEach(({ startIndex, endIndex }) => {
        for (let i = startIndex; i < endIndex; i++) this.#clearCell(i);
    });
    return { added, removed };
  }

  /** Raw events for debugging. */
  rawEvents() {
    return [];
  }

  summary() {
    return {
      added: this.added, // These are still CellAddition[]
      removed: this.removed, // These are still CellRemoval[]
      changedCells: Array.from(this.keys()), // Indexes with ChangeSummary
      fullCells: Array.from(this.full.keys()), // Indexes of fully processed cells
      pending: Array.from(this.pending), // Indexes of pending execution cells
      diffs: this.diffs // Array of generated Diff[]
    }
  }
  
  /** Provides a string summary for debugging. */
  showSummary() {
    if (!log.enabled) return;

    const baseSummary = this.summary();

    const ll = [];
    const formatChanges = (arr, type) => arr.map(c => `${type} ${JSON.stringify(c)}`).join('\n  ');

    log(`**** Collator Summary ****`);
    if (baseSummary.diffs.length > 0) ll.push(`Diffs Queued: ${baseSummary.diffs.length}`);
    if (this.documentChanges.size > 0) ll.push(`Pending Doc Changes: ${[...this.documentChanges].toString()}`);
    if (baseSummary.pending.length > 0) ll.push(`Pending Execution: ${baseSummary.pending.toString()}`);
    if (baseSummary.added.length > 0) ll.push(`Pending Added:\n  ${formatChanges(baseSummary.added, 'Add')}`);
    if (baseSummary.removed.length > 0) ll.push(`Pending Removed:\n  ${formatChanges(baseSummary.removed, 'Rem')}`);
    if (baseSummary.fullCells.length > 0) ll.push(`Processed (Full): ${baseSummary.fullCells.toString()}`);
    if (baseSummary.changedCells.length > 0) ll.push(`Tracked Cells (Pending Full): ${baseSummary.changedCells.toString()}`);

    this.forEach((summary, cellIndex) => {
      ll.push([`Tracked ${cellIndex}: { doc:${summary.documentChanged?'✓':'-'}`, 
        `meta:${summary.metadataChanged?'✓':'-'}, out:${summary.outputsChanged?'✓':'-'}`, 
        `exec:${summary.executionChanged?'✓':'-'} | exeSt:${summary.executionStatus}`, 
        `exeCnt:${summary.metadataExecutionCount} }`].join(', '));
    });
    this.full.forEach((summary, cellIndex) => {
        ll.push([`Full ${cellIndex}   : { doc:${summary.documentChanged?'✓':'-'}`, 
          `meta:${summary.metadataChanged?'✓':'-'}, out:${summary.outputsChanged?'✓':'-'}`, 
          `exec:${summary.executionChanged?'✓':'-'} | exeSt:${summary.executionStatus}`, 
          `exeCnt:${summary.metadataExecutionCount} }`].join(', '));
    });
  
    ll.push(...this.rawEvents());
    console.log(`\x1B[1;35m${ll.join('\n')}\x1B[m`); // Keep color for visibility
    log("**** ------------------------- ****");
  }
  
}

/** 
 * @typedef {number} TimeStamp
 * @typedef {number} CellIdx
 * @typedef {number} CellCount
 * @typedef {CellIdx[]} CellIdxs - changed cells indexes
 * @typedef {{start:CellIdx, cellIdxs:CellIdxs}} Added - cell indexes added at starting index
 * @typedef {NotebookRange} Removed
 * @typedef {Set<CellIdx>} HasDocumentChanges
 * @typedef {[CellIdxs, Added[], Removed[], CellCount]} Diff
 */

/**
 * Represents a change to notebook-level metadata.
 * @typedef {Object} MetadataChange
 * @property {{[key: string]: any}} metadata - The changed metadata key-value pairs.
 */

/**
 * Represents a change to a cell's metadata.
 * @typedef {Object} CellMetadataChange
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
 * @property {'running'|'finished'} status
 */

/**
 * Represents an update to a cell's outputs.
 * @typedef {Object} OutputsUpdate
 * @property {number} outputCount - The new number of outputs.
 * @property {boolean} isEmpty - True if the outputs array is now empty.
 */
