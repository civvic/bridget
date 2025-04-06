import { randomUUID } from 'crypto';
import { NBStateMonitor } from './stateMonitor.js';
import { MIME } from './utils.js';

/** 
 * @typedef {Object} BridgedOutputMetadata
 * @property {{ [key: string]: any } | undefined} metadata - Can be anything but must be JSON-stringifyable
 * @property {boolean} skip - Whether to consider this output for state updates
 * @property {boolean} renderer - Whether this output is renderer output (always skipped)
 */

class Bridged {
  /** @type {Map<string, BridgedOutputMetadata>} */
  outputs;
  constructor(cell) {
    this.id = Bridged.brdId(cell) ?? randomUUID();
    this.cell = cell;
    this.outputs = new Map();
    this.renderer = false;
    this.syncOutputs(cell.outputs);
  }
  /** 
   * @param {vscode.NotebookCell} cell 
   * @returns {string|undefined} */
  static brdId(cell) { return cell.metadata.metadata?.brd; }
  static setBrdId(cell, id) { cell.metadata.metadata.brd = id; }

  /** Get or create a Bridged for a cell.
   * @param {vscode.NotebookCell} cell 
   * @returns {Bridged} */
  static bridgedOf(cell) {
    const brdMap = NBStateMonitor.get(cell.notebook).bridged;
    const brdId = Bridged.brdId(cell);
    let brd = brdMap.get(brdId);
    if (!brd && cell.metadata?.metadata) {  // newly added cell may not have metadata yet
      brd = new Bridged(cell);
      Bridged.setBrdId(cell, brd.id);
      brdMap.set(brd.id, brd);
      // if (DEBUG) console.log("---- added brd of cell", cell.index, cell.document.uri.fragment);
    }
    return brd;
  }

  // ---- Outputs lifecycle ----
  /** 
   * @param {vscode.NotebookCellOutput} o 
   * @returns {BridgedOutputMetadata} */
  #addOutput(o) {
    if (this.outputs.has(o.id)) return;
    const md = o.metadata?.metadata?.bridge;
    const brdOMd = { 
      metadata: md,
      skip: md?.skip,
      renderer: o.items?.some(it => it.mime === MIME),
    };
    this.outputs.set(o.id, brdOMd);
    return brdOMd;
  }
  /** 
   * @param {string} oId 
   * @returns {BridgedOutputMetadata} */
  #delOutput(oId) {
    if (!this.outputs.has(oId)) return;
    const brdOMd = this.outputs.get(oId);
    this.outputs.delete(oId);
    return brdOMd;
  }
  /** 
   * @param {vscode.NotebookCellOutput[]} outputs 
   * @returns {{added: vscode.BridgedOutputMetadata[], removed: BridgedOutputMetadata[]}} */
  syncOutputs(outputs) {
    const outputIds = new Set(outputs.map(o => o.id));
    const chs = { 
      added: outputs.map(o => this.#addOutput(o)), 
      removed: [...this.outputs.keys()]
        .map(oId => !outputIds.has(oId) && this.#delOutput(oId))};
    this.renderer = this.outputs.values().some(md => md.renderer);
    return chs;
  }
  asJSON() {
    return this.id;
    // return {
    //   id: this.id,
    //   cell_index: this.cell_index,
    //   cell_uri: this.cell_uri.toString(),
    //   outputs: this.outputs.size ? Array.from(this.outputs) : null
    // };
  }
}

export { Bridged };
