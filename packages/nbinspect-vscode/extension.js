const vscode = require('vscode');
const crypto = require('crypto');

/**
 * @typedef {Object} StateMessage
 * @property {'state''} type - Message type identifier
 * @property {Object} cells - Notebook cells
 * @property {Object} NBData - Notebook metadata
 * @property {number} timestamp - Timestamp of the state message
 * @property {'notebookUpdate'} [changeType] - Type of change that triggered update
 * @property {string} [outputId] - ID of the output requesting state
 * @property {string} [reqid] - ID of the request
 */

/**
 * @typedef {Object} RendererStateMessage
 * @property {'getState' | 'updateState'} type - Message type identifier
 * @property {string} outputId - ID of the output requesting state
 * @property {string} reqid - ID of the request
 * @property {Object} opts - Options for the renderer
 * @property {string} origin - Origin of the request (window)
 */

/**
 * @typedef {Object} RendererDeregisterMessage
 * @property {'deregister'} type - Message type identifier
 * @property {string} outputId - ID of the output requesting state
 */

/** 
 * @typedef {Object} BridgedOutputMetadata
 * @property {{ [key: string]: any } | undefined} metadata - Can be anything but must be JSON-stringifyable
 * @property {boolean} skip - Whether to consider this output for state updates
 * @property {boolean} renderer - Whether this output is renderer output (always skipped)
 */


let DEBUG = false;

const MIME = 'application/x-notebook-state';  // Renderer MIME type

// ---- Utils ----

const _CACHE = {};
function getType(obj) {
  let key;
  return obj === null ? 'null' // null
    : obj === globalThis ? 'global' // window in browser or global in nodejs
    : (key = typeof obj) !== 'object' ? key // basic: string, boolean, number, undefined, function
    : obj.nodeType ? 'object' // DOM element
    : _CACHE[key = ({}).toString.call(obj)] // cached. date, regexp, error, object, array, math
    || (_CACHE[key] = key.slice(8, -1).toLowerCase()); // get XXXX from [object XXXX], and cache it
}

// function debounce(func, delay) {
//   let timer;
//   return function (...args) {
//     clearTimeout(timer);
//     timer = setTimeout(() => func.apply(this, args), delay);
//   };
// }

/** Check if a notebook has any mime outputs.
 * @param {vscode.NotebookDocument} nb
 * @param {string} mime
 * @returns {boolean}
 */
function hasMimeOutputs(nb, mime) {
  return nb.getCells().some(c => c.outputs.some(o => o.items.some(it => it.mime === mime)));
}

function cellChange(change) {
  const ch = {
    executionSummary: change.executionSummary ? true : undefined,
    document: change.document ? true : undefined,
    metadata: change.metadata ? true : undefined,
    outputs: change.outputs ? true : undefined
  }
  return ch;
}

/** @param {vscode.NotebookDocumentCellChange} ch */
function hasTransientOutputs(ch) {
  return ch?.outputs?.some(o => o.metadata?.transient && Object.keys(o.metadata.transient).length > 0);
}

// ---- Mime handling ----

function isJsonMime(mime) {
  return  mime === 'application/json' || 
          mime.endsWith('+json') ||
          mime.startsWith('application/vnd.jupyter') ||
          mime.includes('json');
}

function isBinaryMime(mime) {
  return  mime === 'image/png' || 
          mime === 'image/jpeg' || 
          mime === 'image/gif' ||
          mime === 'application/pdf';
}

function isTextMime(mime) {
  return  mime.startsWith('text/') || 
          mime === 'image/svg+xml' ||
          mime === 'application/xml';
}

function bufferToString(data, mime) {
  // If not a buffer, return as is
  if (!Buffer.isBuffer(data)) return data;
  if (mime) {
    // Binary types need base64 encoding
    if (isBinaryMime(mime)) return data.toString('base64');
    // JSON types need parsing
    if (isJsonMime(mime)) {
        try {
          return JSON.parse(data.toString('utf8'));
        } catch (e) {
          console.warn(`Failed to parse JSON for ${mime}`, e);
          return data.toString('utf8');
        }
    }
    // Text types (including SVG) use UTF-8
    if (isTextMime(mime)) return data.toString('utf8');
  }
  // Default to UTF-8 for unknown types
  return data.toString('utf8');
}

/** @param {vscode.NotebookCellOutputItem[]} items */
function getMimeBundle(items) {
  return items.reduce((bundle, item) => {
    if (item.data) {
      bundle[item.mime] = bufferToString(item.data, item.mime);
    }
    return bundle;
  }, {});
}

// ---- Notebook State ----

function getOutputMetadata(output) {
  const { outputType, metadata, ...rest } = output.metadata;  // eslint-disable-line no-unused-vars
  const md = { ...rest, ...metadata };
  return Object.keys(md).length > 0 ? md : undefined;
}

function getOutputType(output) {  // 0: stream, 1: display_data, 2: execute_result, 3: error
  return output.metadata.outputType
}

/** @param {vscode.NotebookCellOutput} o */
function processOutput(output) {
  let fields, item;
  let metadata = getOutputMetadata(output);
  const t = getOutputType(output);
  switch(t) {
    case 'stream':
      item = output.items[0];
      const text = bufferToString(item.data);
      fields = { output_type: t, name: item.mime.includes('stderr') ? 'stderr' : 'stdout', text: text };
      break;
    case 'error':
      item = output.items[0];
      const errorData = JSON.parse(bufferToString(item.data));
      fields = { output_type: t, ename: errorData.name, evalue: errorData.message };
      if (errorData.stack) fields.traceback = errorData.stack.split('\n');
      metadata = null;
      break;
    case 'execute_result':
      fields = { output_type: t, data: getMimeBundle(output.items) };
      fields.execution_count = metadata?.executionCount;
      delete metadata?.executionCount;
      break;
    default:  // display_data
      fields = { output_type: t, data: getMimeBundle(output.items) };
  }
  if (metadata && Object.keys(metadata).length > 0) fields.metadata = metadata;
  return fields;
}

/** @param {vscode.NotebookCell} cell */
function getCellMetadata(cell) {
  const cellMd = cell.metadata;
  const metadata = { 'brd': cellMd.metadata.brd };
  if (cellMd.tags?.length > 0) metadata.tags = cellMd.tags;
  if (cellMd.jupyter) metadata.jupyter = cellMd.jupyter;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

const _cellKind = ['raw', 'markdown', 'code'];
function getCellType(cell) {
  return _cellKind[cell.kind];
}

function processCell(cell) {
  if (DEBUG) console.log("processCell", cell.index);
  /* const brd = */ BridgedMap.getBridgedOf(cell);
  const cellData = { cell_type: getCellType(cell), source: cell.document.getText() };
  const metadata = getCellMetadata(cell);
  if (metadata) cellData.metadata = metadata;
  if (cell.kind === vscode.NotebookCellKind.Code && cell.outputs.length > 0) {
    cellData.outputs = cell.outputs.map(processOutput);
  }
  if (cellData.outputs?.length === 0) delete cellData.outputs;
  return cellData;
}

// ---- Notebook State monitoring ----

class Bridged {
    /** @type {Map<string, BridgedOutputMetadata>} */
    outputs;
  constructor(cell) {
    this.id = cell.metadata?.metadata?.brd ?? crypto.randomUUID();
    this.cell = cell;
    this.outputs = new Map();
    this.syncOutputs(cell.outputs);
  }
  static fromCell(cell) {
    return BridgedMap.getBridgedOf(cell);
  }
  // ---- Outputs lifecycle ----
  /** 
   * @param {vscode.NotebookCellOutput} o 
   * @returns {vscode.NotebookCellOutput | undefined} */
  #addOutput(o, relevant=false) {
    if (this.outputs.has(o.id)) return;
    const md = o.metadata?.metadata?.bridge;
    const brdMd = { 
      metadata: md,
      skip: md?.skip,
      renderer: o.items?.some(it => it.mime === MIME),
    };
    this.outputs.set(o.id, brdMd);
    return relevant ? (brdMd.renderer || brdMd.skip ? undefined : o) : o;
  }
  /** 
   * @param {string} oId 
   * @returns {BridgedOutputMetadata | undefined} */
  #delOutput(oId, relevant=false) {
    if (!this.outputs.has(oId)) return;
    const brdOMd = this.outputs.get(oId);
    this.outputs.delete(oId);
    return relevant ? (brdOMd.renderer || brdOMd.skip ? undefined : brdOMd) : brdOMd;
  }
  /** 
   * @param {vscode.NotebookCellOutput[]} outputs 
   * @param {boolean} relevant - if true, only return relevant outputs (not skipped or renderer)
   * @returns {{added: vscode.NotebookCellOutput[], removed: BridgedOutputMetadata[]}} */
  syncOutputs(outputs, relevant=false) {
    const outputIds = new Set(outputs.map(o => o.id));
    return { 
      added: outputs.map(o => this.#addOutput(o, relevant)).filter(Boolean), 
      removed: [...this.outputs.keys()]
        .map(oId => !outputIds.has(oId) && this.#delOutput(oId, relevant)).filter(Boolean)};
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

/** @type {Map<string, Bridged>} - bridged.id -> Bridged */
class BridgedMap extends Map {
  /** 
   * @param {vscode.NotebookCell} cell 
   * @returns {Bridged} */
  static getBridgedOf(cell) {
    const brdMap = NBStateMonitor.get(cell.notebook).bridged;
    const cellMd = cell.metadata;
    const brdId = cellMd.metadata?.brd;
    let brd = brdMap.get(brdId);
    if (!brd) {
      brd = new Bridged(cell);
      cellMd.metadata.brd = brd.id;
      brdMap.set(brd.id, brd);
      if (DEBUG) console.log("---- added brd of cell", cell.index);
    }
    return brd;
  }
  /** @param {string | number | vscode.NotebookCell} k */
  get(k) {
    return super.get(k) ?? super.get(k?.metadata?.metadata?.brd ?? 
      (typeof k === 'number' ? this.nb.cellAt(k)?.metadata?.metadata?.brd : undefined)
    );
  }
}

class BridgeNBEventsFilter {
  nb;
  constructor(nb) {
    this.nb = nb;
  }
  /** has this cell relevant changes (those that affect cell source or outputs)?
   * @param {[number, ChangeCollator]} cellChs *
   * @returns {boolean} */
  filterChanges([cellIndex, cellChs]) {
    const { document=false, metadata=false, outputs=undefined, executionSummary=false } = cellChs;
    // document change
    if (document) return true;
    
    const nb = this.nb;
    const cell = nb.cellAt(cellIndex);

    // brand new cell; this should be detected previously, but just in case.
    const brdId = cell.metadata?.metadata?.brd;
    if (!brdId) return true;
    const brd = NBStateMonitor.get(nb).bridged.get(brdId);
    if (brd === undefined) throw new Error("Bridged not found");
    if (brd.id !== brdId) throw new Error("Bridged id mismatch");
    
    if (outputs === undefined) {
      // summary
      if (executionSummary) { /* if (!isRenderer) */ return false; }
      // metadata
      if (metadata && cell.outputs.length === 0) return false;
    }

    // // outputs
    // const { added, removed } = brd.syncOutputs(outputs);
    // if (added.some(o => {
    //   const brdOMd = brd.outputs.get(o.id);
    //   return !brdOMd?.renderer && !brdOMd?.skip;
    // })) return true;
    // if (removed.some(brdOMd => {
    //   return !brdOMd?.renderer && !brdOMd?.skip;
    // })) return true;
    // outputs
    const { added, removed } = brd.syncOutputs(outputs, true);
    if (added.length || removed.length) return true;

    return false;
  }
  /** @param {ChangeCollator} chs */
  filter(chs, watch, transient=false) {
    if (!watch && !transient) return false;
    if (this.contentOnly) return chs.added?.length || chs.removed?.length;
    if (chs.events.length === 0) return false;
    if (chs?.added?.length || chs?.removed?.length) return true;
    if (DEBUG) chs.summary(true);
    const cells = [...chs.entries()].filter(this.filterChanges, this);
    if (!cells.length) { 
      if (DEBUG) console.log("-------- no cells with relevant changes");
      return false; 
    };
    if (watch) {
      // assume this changes was triggered by a renderer cell change
      // if (cells.values().some(c => isRendererCell(c))) this.oneShotDelay();
    }
    return true;
  }
}

class ChangeCollator extends Map {
  /** @param {vscode.NotebookDocumentChangeEvent[]} evts */
  constructor(evts=null) {
    super();
    this.events = [];
    if (evts && evts.length > 0) this.addEvents(evts);
  }
  /** @param {vscode.NotebookDocumentCellChange} ch */
  collate(ch) {
    const { cell, document, metadata, outputs, executionSummary } = ch;
    if (!this.has(cell.index)) this.set(cell.index, {});
    const chs = this.get(cell.index);
    if (document) chs.document = true;
    if (metadata) chs.metadata = true;
    if (outputs) chs.outputs = outputs;
    if (executionSummary) chs.executionSummary = true;
  }
  /** @param {vscode.NotebookDocumentContentChange} ch */
  contentChange(ch) {
    const { addedCells, removedCells } = ch;
    if (addedCells.length > 0) {
      if (!this.added) this.added = addedCells;
      else this.added.push(...addedCells);
    }
    if (removedCells.length > 0) {
      if (!this.removed) this.removed = removedCells;
      else this.removed.push(...removedCells);
    }
  }
  /** @param {vscode.NotebookDocumentChangeEvent} evt */
  addEvent(evt) {
    this.events.push(evt);
    evt.cellChanges.map(ch => this.collate(ch));
    evt.contentChanges.map(ch => this.contentChange(ch));
  }
  addEvents(evts) {
    evts.map(evt => evt.cellChanges.map(ch => this.collate(ch)));
  }
  summary(show=false) {
    const added = this?.added?.map(cell => cell.index) ?? undefined;
    const removed = this?.removed?.map(cell => cell.index) ?? undefined;
    const changedCells = Array.from(this.keys());
    const events = this.events.map(e => e.cellChanges.map(ch => [ch.cell.index, cellChange(ch)]));
    if (show) {
      console.log("---- changes ----");
      if (added) console.log("added", added.toString());
      if (removed) console.log("removed", removed.toString());
      if (changedCells.length > 0) console.log("changedCells", changedCells.toString());
      events.map(evt => {
        console.log(JSON.stringify(evt));
      });
      console.log("---- ---- ----");
    }
    return { added, removed, changedCells, events };
  }
}

class NBStateMonitor {
  /** @type {Map<string, NBStateMonitor>} - notebook.uri -> NBStateMonitor */
  static monitors = new Map();
  static defaultOpts = {
    watch: false,  // watch for changes, otherwise only send state on renderer request
    contentOnly: false,  // send state if notebook structure changes, e.g. cells added or removed
    debug: false
  };
  static messaging = null;
  static defaultDebounceDelay = 600;
  
  /** @type {vscode.NotebookDocument} */
  nb;
  active = false;
  #origin;  // renderer origin (document.origin, webview)
  #opts;  // options
  /** @type {BridgeNBEventsFilter} */
  #filterer;  // filter events
  /** @type {BridgedMap} */
  bridged;
  debounce = true;
  #debounceDelay = NBStateMonitor.defaultDebounceDelay;
  
  constructor(notebook, origin, opts = {}) {
    this.nb = notebook;
    this.#origin = origin;
    this.#opts = { ...NBStateMonitor.defaultOpts, ...opts };
    this.#filterer = new BridgeNBEventsFilter(notebook);
    this.bridged = new BridgedMap();
  }
  
  static get(notebook) { return this.monitors.get(notebook.uri.toString()); }
  static delete(notebook) { this.monitors.delete(notebook.uri.toString()); }
  static create(notebook, origin, opts = {}) {
    const monitor = new NBStateMonitor(notebook, origin, opts);
    this.monitors.set(notebook.uri.toString(), monitor);
    return monitor;
  }
  
  get debounceDelay() { 
    return this.#debounceDelay;
  }
  restoreDebounceDelay() {
    this.#debounceDelay = NBStateMonitor.defaultDebounceDelay;
  }
  oneShotDelay(delay = 100) {
    this.#debounceDelay = delay;
    setTimeout(() => {
      this.restoreDebounceDelay();
    }, 1000);
  }

  get watch() { return this.#opts.watch; }
  set watch(flag) { this.#opts.watch = flag; }
  get contentOnly() { return this.#opts.contentOnly; }
  set contentOnly(flag) { this.#opts.contentOnly = flag; }

  /** 
   * @param {RendererMessage | null} reqMsg
   * @param {'notebookUpdate' | undefined} changeType
   */
  sentNBState(reqMsg, changeType) {
    const nb = this.nb;
    // if (DEBUG) console.group("render");
    const cells = nb.getCells().map(processCell);
    // if (DEBUG) console.groupEnd();
    const nbData = { metadata: nb.metadata, cellCount: nb.cellCount, notebookType: nb.notebookType };
    const t = Date.now();
    if (DEBUG) console.log("sentNBState", t);
    /** @type {StateMessage} */
    const message = { type: "state", cells: cells, nbData: nbData, timestamp: t, origin: reqMsg.origin };
    if (changeType) message.changeType = changeType;
    NBStateMonitor.messaging.postMessage(message);
  }

  /** @param {{message: RendererStateMessage | RendererDeregisterMessage}} e */
  static onRendererMessage(e) {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor) return;
    /** @type {RendererStateMessage | RendererDeregisterMessage} */
    const nb = editor.notebook; const msg = e.message;
    const nOpts = msg.opts;
    if (nOpts && nOpts.debug !== undefined) DEBUG = nOpts.debug;
    if (DEBUG) console.log("Message from renderer");
    if (DEBUG) console.log(msg.type, 'from:', msg.outputId);
    const monitor = NBStateMonitor.get(nb) ?? NBStateMonitor.create(nb, msg.origin);
    if (msg.type === "deregister") {
      monitor.active = false;
      if (DEBUG) console.log("---- deregister", msg.outputId);
      if (!hasMimeOutputs(nb, MIME)) {
        NBStateMonitor.delete(nb);
        if (DEBUG) console.log("---- deleted monitor", monitor.nb.uri);
      }
      if (DEBUG) console.log("----"); return;
    }
    if (DEBUG) console.log('nOpst:', nOpts);
    if (DEBUG) console.log("----");
    if (nOpts.watch !== undefined) monitor.watch = nOpts.watch;
    if (nOpts.contentOnly !== undefined) monitor.contentOnly = nOpts.contentOnly;
    if (nOpts.debug !== undefined) monitor.#opts.debug = nOpts.debug;
    if (!monitor.watch) {
      monitor.sentNBState(msg);
    } else {
      if (msg.type === "getState") {
        monitor.oneShotDelay();  // reduce delay for renderer cell changes
      } else {  // updateState
        monitor.oneShotDelay();  // reduce delay for renderer cell changes
      }
      monitor.sentNBState(msg);
    }
    monitor.active = true;
  }
  
  /** @param {ChangeCollator} chs */
  changed(chs, transient = false) {
    if (chs.removed) {
      chs.removed.forEach(cell => {
        const brd = this.bridged.get(cell);
        if (brd) this.bridged.delete(brd.id);
      });
    }
    // newly added cells will be handled in `filterChanges`
    if (this.#filterer.filter(chs, this.watch, transient)) {
      this.sentNBState({ origin: this.#origin }, "notebookUpdate");
    }
  }

  static onChange = (() => {
    const debounceState = new WeakMap();

    return (event) => {
      const monitor = NBStateMonitor.get(event.notebook);
      if (!monitor || !monitor.active) return;  // start monitoring only after first renderer message
      
      if (monitor.debounce) {
        let state = debounceState.get(monitor) ?? { 
          collator: new ChangeCollator(), timer: null, delay: monitor.debounceDelay, 
          nb: event.notebook, transient: null, tmp: [] };
        if (DEBUG) console.log("-------- d");
          
        clearTimeout(state.timer);
        state.collator.addEvent(event);
        const transient = event.cellChanges && event.cellChanges.some(ch => hasTransientOutputs(ch));
        if (transient && state.transient === null) {
          state.transient = true;
          state.delay = 100;
        }
      
        state.timer = setTimeout(() => {
          if (!NBStateMonitor.get(state.nb)) return;  // monitor deleted
          monitor.restoreDebounceDelay();
          debounceState.delete(monitor);
          if (state.collator.events.length === 0) return;
          if (!monitor.watch && !state.transient) return;
          monitor.changed(state.collator, state.transient);
        }, state.delay);
        
        debounceState.set(monitor, state);
        return;
      }
      
      monitor.changed(new ChangeCollator([event]));
    };
  })();

}

// ---- Extension life-cycle ----

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  if (DEBUG) console.log('Extension "nbinspect" is now active!', getType(context));
  const messaging = vscode.notebooks.createRendererMessaging("nbinspect-renderer");
  NBStateMonitor.messaging = messaging;
  messaging.onDidReceiveMessage(NBStateMonitor.onRendererMessage);
  const listener = vscode.workspace.onDidChangeNotebookDocument(
    NBStateMonitor.onChange);
  context.subscriptions.push(messaging, listener);
}

function deactivate() {
  NBStateMonitor.monitors.forEach( monitor => monitor.watch = false );
  NBStateMonitor.monitors.clear();
}

module.exports = { activate, deactivate };
