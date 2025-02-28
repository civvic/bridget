import * as vscode from 'vscode';  // eslint-disable-line no-unused-vars
// import debug from 'debug';

import { debug } from './utils.js';

const log = debug('nbinspect:coll', 'dimgray');
// log.log = console.info.bind(console);


/**
 * @typedef {Object} ChangeSummary
 * @property {Boolean} document
 * @property {Boolean} metadata
 * @property {Boolean} outputs
 * @property {Boolean} executionSummary
 * @property {number} execution_count
 * @property {(vscode.NotebookDocumentCellChange|vscode.NotebookDocumentContentChange)[]} changes
 */
export class ChangeSummary {
    // document;
    // metadata;
    // outputs;
    // executionSummary;
    // execution_count;
    // changes;
  constructor() {
    // this.document = false;
    // this.metadata = null;
    // this.outputs = null;
    // this.executionSummary = {};
    // this.execution_count = null;
    this.changes = [];
  }
}

/** @typedef {[number, {[key: string]: any;}]} MetadataChange -  notebook metadata changes */
/** @typedef {[number, vscode.NotebookDocumentContentChange]} ContentChange -  notebook content changes */
/** @typedef {{start:number, cellIdxs:number[]}} Added - cell indexes added at starting index */
/** @typedef {vscode.NotebookRange} Removed */
/** @typedef {Map<number, ChangeSummary>} Full */
/** @typedef {Set<number>} HasDocumentChanges */
/** @typedef {[number, vscode.NotebookDocumentChangeEvent][]} Events */
/** 
 * @typedef {Map<number, ChangeSummary>} ChangeCollator
*/
export class ChangeCollator extends Map {
  /** @type {MetadataChange[]} */
  #metadataChanges = [];
  /** @type {ContentChange[]} */
  #contentChanges = [];
  /** @type {Added[]} */
  #added = [];
  /** @type {Removed[]} */
  #removed = [];
  /** @type {Map<number, ChangeSummary>} */
  #full = new Map();
  /** @type {number[]} */
  hasDocumentChanges = new Set();
  /** @type {[number, vscode.NotebookDocumentChangeEvent][]} */
  events = [];

  constructor(evts=null) {
    super();
    if (evts && evts.length > 0) this.addEvents(evts);
  }
  #setFull(cellIndex, chs) {
    this.#full.set(cellIndex, chs);
    this.delete(cellIndex);
  }
  #collate(ts, ch) {
    const { cell, document, metadata:md, outputs, executionSummary:exec } = ch;
    let chs = this.get(cell.index);
    // ignore dup, dangling evts
    if (!chs) {
      if (exec && exec.success !== undefined) return;  // dangling exec - should't happen w/out prev exec
      if (md && md.execution_count) return;  // dangling md - should't happen w/out prev exec
      chs = new ChangeSummary();
      this.set(cell.index, chs);
    } else {
      if (exec && chs?.executionSummary.executionOrder === exec.executionOrder && 
        chs?.executionSummary.success === exec.success) {  // dup exec
          chs.executionSummary = exec;
          return;
        };
      if (document && chs.document) return;  // dup document change
    }
    chs.changes.push([ts, ch]);
    if (exec) {
      chs.executionSummary = exec;
      if (exec?.success !== undefined) {
        if (exec.executionOrder === chs?.metadata?.execution_count || 
          exec.executionOrder === cell?.metadata?.execution_count) {
          chs.execution_count = exec.executionOrder;
          this.#setFull(cell.index, chs);
        }
      }
    }
    if (md) {
      chs.metadata = md;
      if (md?.execution_count && md.execution_count === chs?.executionSummary?.executionOrder) {
        chs.execution_count = md.execution_count;
        this.#setFull(cell.index, chs);
      }
    }
    if (document) {
      chs.document = true;
      this.hasDocumentChanges.add(cell.index);
    }
    if (outputs) {
      log('outputs');
      chs.outputs = outputs;
      if (outputs.length && chs.changes.length === 1) {
        // dangling outputs - display handle update surely
        this.#setFull(cell.index, chs);
      }
    }
  }
  /** @param {vscode.NotebookDocumentContentChange} ch */
  #contentChange(ts, ch) {
    this.#contentChanges.push([ts, ch]);
    const { range, addedCells, removedCells } = ch;
    if (removedCells.length > 0) this.#removed.push(range);
    else if (addedCells.length > 0) this.#added.push({start:range.start, cellIdxs:addedCells.map(c => c.index)});
  }
  #changes() {
    return [
      ...this.values().flatMap(chs=>chs.changes),
      ...this.#contentChanges,
      ...this.#full.values().flatMap(chs=>chs.changes)
    ].sort((a, b)=>a[0]-b[0]);
  }
  /** @param {vscode.NotebookDocumentChangeEvent} evt */
  addEvent(evt) {    
    const t = Date.now();
    this.events.push([t, evt]);
    if (evt.metadata) this.#metadataChanges.push([t, evt.metadata]);
    evt.contentChanges.map(ch => this.#contentChange(t, ch));
    evt.cellChanges.map(ch => this.#collate(t, ch));
    return this;
  }
  addEvents(evts) {
    evts.map(evt => this.addEvent(evt));
  }
  hasContentChanges() {
    return this.#added.length || this.#removed.length;
  }
  getContentChanges() {
    const added = this.#added.splice(0, this.#added.length);
    added.forEach(({ cellIdxs }) => cellIdxs.forEach(idx => this.delete(idx)));
    const removed = this.#removed.splice(0, this.#removed.length);
    this.#contentChanges.length = 0;
    return { added, removed };
  }
  hasChanges() {
    return this.#full.size > 0;
  }
  getChanges() {
    const full = [...this.#full.keys()];
    this.#full.clear();
    return full;
  }
  /** @returns {[number[], Added[], Removed[]]} */
  getAll() {
    if (this.hasDocumentChanges.size || this.#full.size || this.#added.length || this.#removed.length) {
      if (log.enabled) this.summary();
      this.hasDocumentChanges.forEach(idx => this.has(idx) && this.#setFull(idx, this.get(idx)));
      this.hasDocumentChanges.clear();
      let full = this.getChanges();
      let { added, removed } = this.getContentChanges();
      return [full, added, removed];
    }
  }
  summary() {
    const added = this.#added;
    const removed = this.#removed;
    const changedCells = Array.from(this.keys());
    const fullCells = Array.from(this.#full.keys());
    const changes = this.#changes();

    log(`**** changes (${changes.length}) ****`);
    if (this.hasDocumentChanges.length > 0) log("hasDocumentChanges", JSON.stringify(this.hasDocumentChanges));
    if (added.length > 0) log("added", JSON.stringify(added));
    if (removed.length > 0) log("removed", 
      JSON.stringify(removed.map(r => ({start: r.start, end: r.end}))));
    if (fullCells.length > 0) log("fullCells: [", fullCells.toString(), "]");
    if (changedCells.length > 0) log("changedCells: [", changedCells.toString(), "]");
    this.forEach((ch, cellIndex) => {
      log('collator', cellIndex, {
        d: ch.document ? '✓' : '-', o: ch.outputs ? '✓' : '-', 
        metadata: ch.metadata ? JSON.stringify(ch.metadata) : '-',
        ex: ch.executionSummary ? JSON.stringify(ch.executionSummary) : '-'
      });
    });
    this.#full.forEach((ch, cellIndex) => {
      const prx = `${'full'} ${cellIndex}`;
      log(
`${prx} { \
d: ${ch.document ? '✓' : '-'} o: ${ch.outputs ? '✓' : '-'} \
md: ${ch.metadata ? JSON.stringify(ch.metadata) : '-'}
${' '.repeat(prx.length)}   ex: ${ch.executionSummary ? JSON.stringify(ch.executionSummary) : '-' } \
}`);
    });
    changes.forEach(([ts, ch], idx) => {
      const { cell, range } = ch;
      const delta = (idx > 0 ? `+${ts - changes[idx-1][0]}` : `${ts}`).padStart(14);
      if (range) {
        if (ch.addedCells.length > 0) log(delta, 'added', 
          JSON.stringify({range, idx: ch.addedCells.map(c => c.index)}));
        if (ch.removedCells.length > 0) log(ts, 'removed', JSON.stringify({range}));
      } 
      if (cell) log(`${delta} ${cell.index} { \
d: ${ch.document ? '✓' : '-'} o: ${ch.outputs ? '✓' : '-'} \
md: ${ch.metadata ? JSON.stringify(ch.metadata) : '-'} \
ex: ${ch.executionSummary ? JSON.stringify(ch.executionSummary) : '-'} \
}`);
    });
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

  // cleanup() {
  //   const ts = Date.now();
  //   this.forEach((chs, cellIndex) => {
  //     chs.changes = [];
  //   });
  // }

}

