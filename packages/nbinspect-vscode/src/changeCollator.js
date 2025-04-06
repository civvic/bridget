import { debug } from './debug.js';
const DEBUG_NAMESPACE = 'nbinspect:coll';
const log = debug(DEBUG_NAMESPACE, 'dimgray');
const logError = debug(`${DEBUG_NAMESPACE}:error`, 'red');

/**
 * @template TCellChange, TContentChange
 * @typedef {Object} ChangeSummary
 * @property {Boolean|undefined} document
 * @property {Boolean|undefined} metadata
 * @property {Boolean|undefined} outputs
 * @property {Boolean|undefined} executionSummary
 * @property {number|undefined} execution_count
 * @property {[TimeStamp, (TCellChange|TContentChange)][]} changes
 */

/** @template TCellChange, TContentChange */
export class ChangeSummary {
  constructor(document) {
    this.document = document;
    this.changes = [];
  }
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
 * @template TChange, TCellChange, TContentChange 
 * @extends {Map<CellIdx, ChangeSummary<TCellChange, TContentChange>>}
 * @abstract
 */
export class ChangeCollator extends Map {
  /** @type {[TimeStamp, {[key: string]: any;}][]} */
  metadataChanges = [];
  /** @type {[TimeStamp, TContentChange][]} */
  #contentChanges = [];
  /** @type {Set<CellIdx>} */
  #documentChanges = new Set();
  /** @type {Added[]} */
  #added = [];
  /** @type {Removed[]} */
  #removed = [];
  /** @type {Map<CellIdx, ChangeSummary<TCellChange, TContentChange>>} */
  #full = new Map();
  /** @type {Set<CellIdx>} Indexes of cells with pending execution summary */
  #pending = new Set();
  /** @type {[TimeStamp, TChange][]} */
  events;
  cellCount = 0;
  /** @type {Diff[]} */
  #diffs = [];

  constructor(notebook) {
    if (new.target === ChangeCollator) {
      throw new TypeError('Cannot construct ChangeCollator instances directly');
    }
    super();
    if (debug.enabled) this.events = [];
    this.nb = notebook;
    this.cellCount = notebook.cellCount;
  }
  get hasDocumentChanges() {
    return this.#documentChanges.size > 0;
  }
  setDocumentChanges(...cellIdxs) {
    cellIdxs.forEach(idx => {
      const chs = this.get(idx);
      if (!chs) this.set(idx, new ChangeSummary(true));
      else chs.document = true;
      this.#documentChanges.add(idx);
    });
  }
  get hasDiffs() {
    return this.#hasChanges() || this.#diffs.length > 0;
  }
  cleanup() {
    // for now, just remove empty cells with dangling execution summary
    const indexes = [...this.keys()];
    indexes.forEach(idx => {
      const chs = this.get(idx);
      if (chs.changes.length === 1 && chs.executionSummary && !chs.executionSummary.executionOrder) {
        const cell = this.nb.cellAt(idx);
        if (cell.outputs.length === 0 && !cell.metadata.execution_count && cell.document.getText().trim().length === 0) {
          this.delete(idx);  // empty cell
        }
      }
    });
  }
  get isEmpty() {
    return (this.size === 0 && this.#full.size === 0 && this.#pending.size === 0 &&
            this.#added.length === 0 && this.#removed.length === 0 && 
            this.#diffs.length === 0);
  }
  /** @returns {Diff[]} */
  getDiffs() {
    this.addDiff();
    return this.#diffs.splice(0, this.#diffs.length);
  }
  addDiff() {
    const all = this.#getDiffs();
    if (all) this.#diffs.push(all);
  }
  #getDiffs() {
    if (this.#hasChanges()) {
      this.#documentChanges.forEach(idx => this.has(idx) && this.#setFull(idx, this.get(idx)));
      this.#documentChanges.clear();
      let full = this.#getChanges();
      let { added, removed } = this.#getContentChanges();
      return [full, added, removed, this.cellCount];
    }
  }
  #setFull(cellIndex, chs) {
    this.#full.set(cellIndex, chs);
    this.delete(cellIndex);
    this.#pending.delete(cellIndex);
  }
  collate(ts, ch) {
    const { cell, document, metadata:md, outputs, executionSummary:exec } = ch;
    let chs = this.get(cell.index);
    // ignore dup, dangling evts
    if (!chs) {
      if (this.#full.has(cell.index)) return;  // already queued
      if (exec && exec.success !== undefined) return;  // dangling exec - should't happen w/out prev exec
      if (md && md.execution_count !== undefined) return;  // dangling md - should't happen w/out prev exec
      chs = new ChangeSummary();
      this.set(cell.index, chs);
    } else {
      if (exec && chs?.executionSummary?.executionOrder === exec.executionOrder && 
        chs?.executionSummary?.success === exec.success) {  // dup exec
          chs.executionSummary = exec;
          return;
        };
      if (document && chs.document) return;  // dup document change
    }
    chs.changes.push([ts, ch]);
    if (exec) {
      chs.executionSummary = exec;
      if (exec.executionOrder !== undefined) this.#pending.add(cell.index);
    }
    if (md) {
      chs.metadata = md;
      if (md?.execution_count && md.execution_count === chs?.executionSummary?.executionOrder) {
        chs.execution_count = md.execution_count;
        this.#setFull(cell.index, chs);
      }
    }
    if (exec?.success !== undefined) {
      if (exec.executionOrder === chs?.metadata?.execution_count || 
          exec.executionOrder === cell?.metadata?.execution_count) {
        chs.execution_count = exec.executionOrder;
        this.#setFull(cell.index, chs);
      }
    }
    if (document) {
      this.setDocumentChanges(cell.index);
    }
    if (outputs) {
      chs.outputs = outputs;
      if (chs.changes.length === 1) {  // first event
        if (!outputs.length) {
          // dangling empty outputs - should happen only when clearing outputs
          this.#setFull(cell.index, chs);
        } else {
          // dangling outputs - display handle update surely
          this.#setFull(cell.index, chs);
        }
      }
    }
  }
  /** @param {TContentChange} ch */
  contentChange(ts, ch) {
    this.#contentChanges.push([ts, ch]);
    const { range, addedCells, removedCells } = ch;
    if (removedCells.length > 0) this.#removed.push(range);
    else if (addedCells.length > 0) this.#added.push({start:range.start, cellIdxs:addedCells.map(c => c.index)});
  }
  #changes() {
    return [
      ...[...this.values()].flatMap(chs=>chs.changes),
      ...this.#contentChanges,
      ...[...this.#full.values()].flatMap(chs=>chs.changes)
    ].sort((a, b)=>a[0]-b[0]);
  }
  // hasContentChanges() {
  //   return this.#added.length || this.#removed.length;
  // }
  #getContentChanges() {
    const added = this.#added.splice(0, this.#added.length);
    added.forEach(({ cellIdxs }) => cellIdxs.forEach(idx => this.delete(idx)));
    const removed = this.#removed.splice(0, this.#removed.length);
    this.#contentChanges.length = 0;
    return { added, removed };
  }
  #hasChanges() {
    return Boolean(this.#pending.size === 0 && 
      (this.#documentChanges.size || this.#full.size || this.#added.length || this.#removed.length));
  }
  #getChanges() {
    const full = [...this.#full.keys()];
    this.#full.clear();
    return full;
  }
  summary() {
    return {
      added: this.#added,
      removed: this.#removed,
      changedCells: Array.from(this.keys()),
      fullCells: Array.from(this.#full.keys()),
      pending: Array.from(this.#pending),
      changes: this.#changes(),
      diffs: this.#diffs
    }
  }
  showSummary() {
    const { added, removed, changedCells, fullCells, pending, changes, diffs } = this.summary();
    const ll = [];
    log(`**** changes ---- (${changes.length}) ---- ****`);
    if (diffs.length > 0) ll.push(`diffs: ${JSON.stringify(diffs)}`);
    if (this.#documentChanges.length > 0) ll.push(`hasDocumentChanges: ${[...this.#documentChanges].toString()}`);
    if (pending.length > 0) ll.push(`pending: ${pending.toString()}`);
    if (added.length > 0) ll.push(`added: ${added.toString()}`);
    if (removed.length > 0) ll.push(`removed: ${JSON.stringify(removed.map(r => ({start: r.start, end: r.end})))}`);
    if (fullCells.length > 0) ll.push(`fullCells: ${fullCells.toString()}`);
    if (changedCells.length > 0) ll.push(`changedCells: ${changedCells.toString()}`);
    this.forEach((ch, cellIndex) => {
      ll.push(`collator ${cellIndex} { \
d: ${ch.document ? '✓' : '-'} o: ${ch.outputs ? '✓' : '-'} \
md: ${ch.metadata ? JSON.stringify(ch.metadata) : '-'} \
ex: ${ch.executionSummary ? JSON.stringify(ch.executionSummary) : '-' } \
}`);
    });
    this.#full.forEach((ch, cellIndex) => {
      const prx = `${'full'} ${cellIndex}`;
      ll.push(`${prx} { \
d: ${ch.document ? '✓' : '-'} o: ${ch.outputs ? '✓' : '-'} \
md: ${ch.metadata ? JSON.stringify(ch.metadata) : '-'}
${' '.repeat(prx.length)}   ex: ${ch.executionSummary ? JSON.stringify(ch.executionSummary) : '-' } \
}`);
    });
    changes.forEach(([ts, ch], idx) => {
      const { cell, range } = ch;
      const delta = (idx > 0 ? `+${ts - changes[idx-1][0]}` : `${ts}`).padStart(14);
      if (range) {
        if (ch.addedCells.length > 0) ll.push(`${delta} added ${JSON.stringify({range, idx: ch.addedCells.map(c => c.index)})}`);
        if (ch.removedCells.length > 0) ll.push(`${ts} removed ${JSON.stringify({range})}`);
      } 
      if (cell) ll.push(`${delta} ${cell.index} { \
d: ${ch.document ? '✓' : '-'} o: ${ch.outputs ? '✓' : '-'} \
md: ${ch.metadata ? JSON.stringify(ch.metadata) : '-'} \
ex: ${ch.executionSummary ? JSON.stringify(ch.executionSummary) : '-'} \
}`);
    });
    console.log(`\x1B[1;35m${ll.join('\n')}\x1B[m`);
    log("**** ---------------------------- ****");
  }

  showCellChanges(changes) {
    changes.forEach(([ts, evt], idx) => {
      const ch = evt.cellChanges[0];
      const { cell } = ch;
      const delta = (idx > 0 ? `+${ts - changes[idx-1][0]}` : `${ts}`).padStart(14);
      const s = `${delta} ${cell.index} { \
d: ${ch.document ? '✓' : '-'} o: ${ch.outputs ? '✓' : '-'} \
md: ${ch.metadata ? JSON.stringify(ch.metadata) : '-'} \
ex: ${ch.executionSummary ? JSON.stringify(ch.executionSummary) : '-'} \
}`
      if (cell) console.log(s);
    });

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
 * @extends {ChangeCollator<
 *   NotebookDocumentChangeEvent,
 *   NotebookDocumentCellChange,
 *   NotebookDocumentContentChange
 * >}
 */
export class ChangeCollatorVSCode extends ChangeCollator {
  /** @type {[TimeStamp, NotebookDocumentChangeEvent][]} */
  events;

  constructor(notebook, evts=null) {
    super(notebook, evts);
    if (debug.enabled) this.events = [];
    if (evts && evts.length > 0) this.addEvents(evts);
  }

  /** @param {NotebookDocumentChangeEvent} evt */
  addEvent(evt) {
    const t = Date.now();
    if (debug.enabled) this.events.push([t, evt]);
    if (this.cellCount !== this.nb.cellCount) {
      this.cellCount = this.nb.cellCount;
      this.addDiff();
    }
    if (evt.metadata) this.metadataChanges.push([t, evt.metadata]);
    evt.contentChanges.map(ch => this.contentChange(t, ch));
    evt.cellChanges.map(ch => this.collate(t, ch));
    return this;
  }
  addEvents(evts) {
    evts.map(evt => this.addEvent(evt));
  }
  
}

/** @typedef {import('vscode').NotebookDocumentChangeEvent} NotebookDocumentChangeEvent */
/** @typedef {import('vscode').NotebookDocumentContentChange} NotebookDocumentContentChange */
/** @typedef {import('vscode').NotebookDocumentCellChange} NotebookDocumentCellChange */
/** @typedef {import('vscode').NotebookRange} NotebookRange */
