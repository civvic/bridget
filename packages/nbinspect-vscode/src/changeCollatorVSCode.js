import { ChangeCollator } from '../../common/changeCollator.js';

import { debug } from '../../common/debug.js';
const DEBUG_NAMESPACE = 'nbinspect:coll';
const log = debug(DEBUG_NAMESPACE, 'dimgray');
const logError = debug(`${DEBUG_NAMESPACE}:error`, 'red');

/**
 * Concrete implementation of ChangeCollator for VSCode Notebooks.
 * @extends {ChangeCollator}
 */
export class ChangeCollatorVSCode extends ChangeCollator {
  /** @type {import('vscode').NotebookDocument} The VSCode notebook document */
  notebook;
  /** @type {[TimeStamp, NotebookDocumentChangeEvent][]} Debug log of raw events */
  events;

  /**
   * @param {import('vscode').NotebookDocument} notebook
   * @param {[TimeStamp, NotebookDocumentChangeEvent][] | null} [initialEvents=null]
   */
  constructor(notebook, initialEvents = null) {
    super(notebook.cellCount); // Pass initial cell count to base
    this.notebook = notebook;
    if (debug.enabled) this.events = [];
    if (initialEvents && initialEvents.length > 0) initialEvents.forEach(([ts, evt]) => this.addEvent(evt, ts));
  }

  /**
   * @param {NotebookDocumentChangeEvent} evt The VSCode event object.
   * @param {TimeStamp} [timestamp] Optional timestamp (defaults to Date.now()).
   */
  addEvent(evt, timestamp) {
    if (!evt) logError('ChangeCollatorVSCode received a null event.');
    const t = timestamp ?? Date.now();
    if (debug.enabled) {
      if (!this.events) this.events = []; // Ensure initialized
      // Optional: Limit debug event log size
      // if (this.events.length > 1000) this.events.shift();
      this.events.push([t, evt]);
    }
    try {
      const { metadata, contentChanges, cellChanges } = evt;
      // 1. Handle Notebook-level metadata change
      if (metadata) this._recordNotebookMetadataChange({ metadata });
      // 2. Handle Content Changes (Cell Add/Remove)
      if (contentChanges?.length > 0) {
        contentChanges.forEach(ch => {
          if (ch?.addedCells?.length > 0) {
            this._recordCellAddition({
              startIndex: ch.range.start, addedCellIndexes: ch.addedCells.map(c => c.index),
            });
          } else if (ch?.removedCells?.length > 0) {
            this._recordCellRemoval({
              startIndex: ch.range.start, endIndex: ch.range.end, removedCount: ch.removedCells.length,
            });
          }
        });
        // assert registered cell count matches notebook cell count
        const cellCount = this.notebook.cellCount;
        if (this.cellCount !== cellCount) {
          throw new Error(`Cell count mismatch detected (${this.cellCount} vs ${cellCount}).`);
        }
      }
      // 3. Handle Cell-level Changes
      if (cellChanges?.length > 0) {
        cellChanges.forEach(ch => {
          const cellIndex = ch.cell.index;
          if (this.full.has(cellIndex)) return; // Already processed
          
          const { document, metadata, outputs, executionSummary } = ch;
          if (document) this._recordDocumentEdit(cellIndex);
          if (metadata) {
              // If metadata change is the first thing we see (e.g., execution count update)
              // if (md && md.execution_count !== undefined) return;  // dangling md - should't happen w/out prev exec
              if (!this.has(cellIndex) && metadata.execution_count !== undefined) return;
            this._recordCellMetadataChange(cellIndex, { execution_count: metadata.execution_count });
          }
          if (outputs) {
            this._recordOutputsUpdate(cellIndex, { outputCount: outputs.length, isEmpty: outputs.length === 0 });
          }
          if (executionSummary) {
            if (!this.has(cellIndex)) {
              //  NOTE: VSCode sends many of these before finally sending one with exe order
              if (executionSummary.executionOrder === undefined) return;
              // Dangling execution update (e.g., success signal without executionOrder)? Ignore for now.
              if (executionSummary.success !== undefined) return;  // dangling exec - should't happen w/out prev exec
            }
            this._recordExecutionUpdate(cellIndex, 
              executionSummary.success !== undefined ? 'finished' : 'running');
          }
        });
      }
      // 4. Catch cell count mismatch (shouldn't happen)
      const currentCellCount = this.notebook.cellCount;
      if (this.cellCount !== currentCellCount) {
        log(`Cell count mismatch (${this.cellCount} vs ${currentCellCount}). Forcing diff.`);
        this.addDiff(); // Trigger diff check due to potential structural change
      }
    } catch (error) {
        logError('Error processing VSCode event in ChangeCollatorVSCode:', error, evt);
        // Avoid rethrowing from event handler loop
    }
    return this;
  }

  /**
   * Adds multiple events.
   * @param {NotebookDocumentChangeEvent[]} evts Array of VSCode event objects.
   */
  addEvents(evts) {
    evts.forEach(evt => this.addEvent(evt));
  }

  cleanup() {
    // This logic requires accessing cell details (outputs, metadata, document)
    // specific to the VSCode notebook object.
    log('Running VSCode-specific cleanup');
    const indexes = [...this.keys()]; // Get indexes from the base map (holding ChangeSummary)
    indexes.forEach(idx => {
      const summary = this.get(idx);
      // Check if the summary represents a potentially dangling state:
      // - Only execution changed reported (summary.executionChanged is true)
      // - Execution order is present but success status is missing (summary.executionSuccess === undefined)
      // - OR check original logic: changes.length === 1 && executionSummary && !executionSummary.executionOrder
      // Let's adapt the condition using ChangeSummary state:
      if (summary && summary.executionChanged && summary.executionOrder !== undefined 
        && summary.executionSuccess === undefined) {
         // Now check the actual cell state using the VSCode notebook object
        try {
          const cell = this.notebook.cellAt(idx); // Use the stored notebook object
          if (cell && cell.outputs.length === 0 && !cell.metadata.execution_count && 
            cell.document.getText().trim().length === 0) {
            log(`Cleaning up dangling summary for empty cell ${idx}`);
            this.delete(idx);  // Remove from the base map
            this.pending.delete(idx); // Also ensure removed from pending (might be redundant if delete handles it)
          }
        } catch (e) {
          logError(`Error accessing cell ${idx} during cleanup:`, e);
          // Cell might have been removed between change recording and cleanup
          this.delete(idx); // Clean up the summary anyway if cell access fails
          this.pending.delete(idx);
        }
      }
    });
  }

  /** Provides a string summary for debugging. 
   * This is not common because we may want to log raw events or some platform-specific stuff.
   */
  showSummary() {
      if (!debug.enabled) return;

      const baseSummary = {
          added: this.added, // These are still CellAddition[]
          removed: this.removed, // These are still CellRemoval[]
          changedCells: Array.from(this.keys()), // Indexes with ChangeSummary
          fullCells: Array.from(this.full.keys()), // Indexes of fully processed cells
          pending: Array.from(this.pending), // Indexes of pending execution cells
          diffs: this.diffs // Array of generated Diff[]
      };

      const ll = [];
      const formatChanges = (arr, type) => arr.map(c => `${type} ${JSON.stringify(c)}`).join('\n  ');

      log(`**** VSCode Collator Summary ****`);
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

      // log raw events
      // if (this.events && this.events.length > 0) {
      //     ll.push(`Raw Events (${this.events.length}):`);
      //     this.events.forEach(([ts, evt], idx) => {
      //         const delta = (idx > 0 ? `+${ts - this.events[idx-1][0]}` : `${ts}`).padStart(14);
      //         ll.push(`${delta} ${eventSummary(evt)}`); // Use existing utility
      //     });
      // }

      console.log(`\x1B[1;35m${ll.join('\n')}\x1B[m`); // Keep color for visibility
      log("**** ------------------------- ****");
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


/** @typedef {import('vscode').NotebookDocumentChangeEvent} NotebookDocumentChangeEvent */
/** @typedef {import('vscode').NotebookDocumentContentChange} NotebookDocumentContentChange */
/** @typedef {import('vscode').NotebookDocumentCellChange} NotebookDocumentCellChange */
/** @typedef {import('vscode').NotebookRange} NotebookRange */
