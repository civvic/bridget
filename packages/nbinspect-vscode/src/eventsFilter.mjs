import { debug } from './debug.mjs';
import { NBStateMonitor } from './stateMonitor.mjs';
import { Bridged } from './bridged.mjs';

const log = debug('nbinspect:filter');

class BridgeNBEventsFilter {
  nb;
  constructor(nb) {
    this.nb = nb;
  }
  static filterOutput(brdMd) {
    return /* brdMd.renderer || */ brdMd.skip ? undefined : brdMd;
  }
  /** has this cell relevant changes (those that affect cell source or outputs)?
   * @param {[number, ChangeSummary]} cellChs *
   * @returns {boolean} */
  filterChanges([cellIndex, cellChs]) {
    const { document=false, /* metadata=false, */ outputs=undefined, /* executionSummary=false */ } = cellChs;
    const nb = this.nb;
    const cell = nb.cellAt(cellIndex);
    // brand new cell; this should be detected previously, but just in case.
    const brdId = Bridged.brdId(cell);
    if (!brdId) return true;
    const brd = NBStateMonitor.get(nb).bridged.get(brdId);
    if (debug.enabled) {
      if (brd === undefined) throw new Error("Bridged not found");
      if (brd.id !== brdId) throw new Error("Bridged id mismatch");
    }
    if (brd.renderer) return true;
    if (outputs) {
      const { added, removed } = brd.syncOutputs(outputs, true), f = BridgeNBEventsFilter.filterOutput;
      if (added.filter(f).length || removed.filter(f).length) return true;
    }
    // document change
    if (document) return true;
    // // summary
    // if (executionSummary) return false;
    // // metadata
    // if (metadata && cell.outputs.length === 0) return false;
    return false;
  }
  /** @param {ChangeCollator} chs */
  filter(chs) {
    if (this.contentOnly) return chs.added?.length || chs.removed?.length;
    if (chs.cellChanges.length === 0 && chs.contentChanges.length === 0) return false;
    // NOTE: call filterChanges now to syncOutputs
    const cells = [...chs.entries()].filter(this.filterChanges, this);
    if (chs?.added?.length || chs?.removed?.length) return true;
    if (!cells.length) { 
      log("-------- no cells with relevant changes");
      return false; 
    };
    return true;
  }
}

export { BridgeNBEventsFilter };
