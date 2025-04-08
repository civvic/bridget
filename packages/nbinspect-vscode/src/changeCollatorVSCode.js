import { ChangeCollator, eventSummary } from '../../common/changeCollator.js';

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
    const currentCellCount = this.notebook.cellCount;
    if (this.cellCount !== currentCellCount) {
      log(`Cell count mismatch detected by VSCode subclass (${this.cellCount} vs ${currentCellCount}). Forcing diff.`);
      this.addDiff(); // Trigger diff check due to potential structural change
    }
    try {
      // 1. Handle Notebook-level metadata change
      if (evt.metadata) this._recordNotebookMetadataChange({ metadata: evt.metadata });
      // 2. Handle Content Changes (Cell Add/Remove)
      if (evt?.contentChanges?.length > 0) {
        const cellCount = this.notebook.cellCount;
        evt.contentChanges.forEach(ch => {
          if (ch?.addedCells?.length > 0) {
            this._recordCellAddition({
              startIndex: ch.range.start, addedCellIndexes: ch.addedCells.map(c => c.index),
            }, cellCount);
          } else if (ch?.removedCells?.length > 0) {
            this._recordCellRemoval({
              startIndex: ch.range.start, endIndex: ch.range.end, removedCount: ch.removedCells.length,
            }, cellCount);
          }
        });
      }
      // 3. Handle Cell-level Changes
      if (evt?.cellChanges?.length > 0) {
        evt.cellChanges.forEach(ch => {
          const cellIndex = ch.cell.index;
          if (this.full.has(cellIndex)) return; // Already processed

          // Document Edit
          if (ch.document) this._recordDocumentEdit(cellIndex);
          // Metadata
          if (ch.metadata) {
            this._recordCellMetadataChange(cellIndex, {
              metadata: ch.metadata, // Pass the whole metadata diff
              execution_count: ch.metadata.execution_count, // Extract specific field if needed by base
            });
          }
          // Outputs
          if (ch.outputs) {
            this._recordOutputsUpdate(cellIndex, {
              outputCount: ch.outputs.length, isEmpty: ch.outputs.length === 0,
            });
          }
          // Execution Summary
          if (ch.executionSummary) {
            this._recordExecutionUpdate(cellIndex, {
              executionOrder: ch.executionSummary.executionOrder, success: ch.executionSummary.success,
            });
          }
        });
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
          ll.push(`Tracked ${cellIndex}: { doc:${summary.documentChanged?'✓':'-'}, 
            meta:${summary.metadataChanged?'✓':'-'}, out:${summary.outputsChanged?'✓':'-'}, 
            exec:${summary.executionChanged?'✓':'-'} | mExecCnt:${summary.metadataExecutionCount}, 
            execOrd:${summary.executionOrder}, execOk:${summary.executionSuccess} }`);
      });
      this.full.forEach((summary, cellIndex) => {
          ll.push(`Full ${cellIndex}   : { doc:${summary.documentChanged?'✓':'-'}, 
            meta:${summary.metadataChanged?'✓':'-'}, out:${summary.outputsChanged?'✓':'-'}, 
            exec:${summary.executionChanged?'✓':'-'} | mExecCnt:${summary.metadataExecutionCount}, 
            execOrd:${summary.executionOrder}, execOk:${summary.executionSuccess} }`);
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

export { eventSummary };
