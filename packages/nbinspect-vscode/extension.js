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
 */

/**
 * @typedef {Object} RendererDeregisterMessage
 * @property {'deregister'} type - Message type identifier
 * @property {string} outputId - ID of the output requesting state
 */

let DEBUG = true;

const MIME = 'application/x-notebook-state';  // Renderer MIME type

// ---- Utils ----

function delIfEmpty(obj, key) {
  if (obj[key] && Object.keys(obj[key]).length === 0) delete obj[key];
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

function isRendererCell(nb, cell) {
  return cell.outputs.some(o => o.items.some(it => it.mime === MIME));
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

/** @param {vscode.NotebookCellChangeEvent} ch */
function hasChangeMimeOutput(ch) {
  const outs = ch.outputs;
  return (outs && outs.length === 1 && outs[0].items.length === 1 && outs[0].items[0].mime === MIME);
}

/** @param {vscode.NotebookDocumentCellChange} ch */
function hasOnlyExecutionSummary(ch) {
  return  ch.executionSummary && !ch.document && !ch.metadata && !ch.outputs;
}


/** @param {vscode.NotebookDocumentCellChange} ch */
function hasOnlyOutputs(ch) {
  return  ch.outputs && !ch.document && !ch.metadata && !ch.executionSummary;
}

function hasOnlyMetadata(ch) {
  return  ch.metadata && !ch.document && !ch.executionSummary && !ch.outputs;
}

// const CHANGETYPES = ['outputs', 'document', 'metadata', 'executionSummary'];
// /** @param {vscode.NotebookDocumentCellChange} cellCh */
// function hasOnlyChange(cellCh, chType) {
//   const chs = CHANGETYPES.filter(t => cellCh[t]);
//   return  chs.length === 1 && chs[0] === chType;
// }

/** @param {vscode.NotebookDocument} nb */
/** @param {vscode.NotebookDocumentChangeEvent} event */
function relevantChanges(nb, event, skipRendererOutput = true) {
  for (const ch of event.cellChanges) {
    const cell = ch.cell;
    const isRenderer = isRendererCell(nb, cell);
    if (isRenderer && skipRendererOutput) return false;
    const isSummary = hasOnlyExecutionSummary(ch);
    if (!isRenderer && isSummary) return false;
    if (hasOnlyOutputs(ch) && hasChangeMimeOutput(ch)) return false;
    if (hasOnlyMetadata(ch) && !cell.outputs.length) return false;
  }
  return true;
}

/** @param {vscode.NotebookDocument} nb */
/** @param {vscode.NotebookDocumentChangeEvent} event */
function relevantEvent(nb, event, contentOnly, skipRendererOutput = true) {
  const hasContentChanges = event.contentChanges.length > 0;  // cells added or removed
  if (contentOnly && !hasContentChanges) return false;
  const chs = event.cellChanges.map(ch => [ch.cell.index, cellChange(ch)]);
  if (DEBUG) console.log("cellChanges", JSON.stringify(chs));
  if (!relevantChanges(nb, event, skipRendererOutput)) return false;
  return true;
}
  
function changedCells(nb, evts, contentOnly) {
  const _evts = evts.filter(evt => relevantEvent(nb, evt, contentOnly));
  return new Map(_evts.flatMap(evt => evt.cellChanges.map(ch => [ch.cell.index, ch.cell])));
}


// ---- Notebook State monitoring ----

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

function getMimeBundle(items) {
  return items.reduce((bundle, item) => {
    if (item.data) {
      bundle[item.mime] = bufferToString(item.data, item.mime);
    }
    return bundle;
  }, {});
}

// ---- Notebook State ----

function getTypeSpecificFields(output, metadata) {
  const item = output.items[0];
  let fields;
  switch(getOutputType(output)) {
    case 'stream':
      const text = bufferToString(item.data);
      fields = { name: item.mime.includes('stderr') ? 'stderr' : 'stdout', text: text };
      break;
    case 'error':
      const errorData = JSON.parse(bufferToString(item.data));
      fields = { ename: errorData.name, evalue: errorData.message };
      if (errorData.stack) fields.traceback = errorData.stack.split('\n');
      metadata = null;
      break;
    case 'execute_result':
      fields = {data: getMimeBundle(output.items)};
      fields.execution_count = output.metadata?.executionCount;
      break;
    default:  // display_data
      fields = {data: getMimeBundle(output.items)};
  }
  if (metadata) fields.metadata = metadata;
  return fields;
}

function getOutputMetadata(output) {
  const metadata = {...output.metadata};
  delete metadata.outputType;
  delIfEmpty(metadata, 'metadata');
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function getOutputType(output) {  // 0: stream, 1: display_data, 2: execute_result, 3: error
  const output_type = output.metadata.outputType
  return output_type;
}

function processOutput(output) {
  const result = { output_type: getOutputType(output) };
  const metadata = getOutputMetadata(output);
  // if (metadata?.metadata?.bridget?.skip) return undefined;
  const fields = getTypeSpecificFields(output, metadata);
  return {...result, ...fields};
}

function getCellMetadata(cell) {
  const metadata = {};
  const cellM = cell.metadata;
  if (cellM.metadata?.bridget) metadata.bridget = cellM.metadata.bridget;
  if (cellM.tags?.length > 0) metadata.tags = cellM.tags;
  if (cellM.jupyter) metadata.jupyter = cellM.jupyter;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

const _cellKind = ['raw', 'markdown', 'code'];
function getCellType(cell) {
  return _cellKind[cell.kind];
}

function processCell(cell) {
  const cellData = { cell_type: getCellType(cell), source: cell.document.getText() };
  let brid = cell.metadata.metadata?.bridget?.id
  if (!brid) cell.metadata.metadata.bridget = {id: crypto.randomUUID()};
  const metadata = getCellMetadata(cell);
  if (metadata) cellData.metadata = metadata;
  if (cell.kind === vscode.NotebookCellKind.Code && cell.outputs.length > 0) {
      cellData.outputs = cell.outputs.map(processOutput).filter(output => output !== undefined);
  }
  if (cellData.outputs?.length === 0) delete cellData.outputs;
  return cellData;
}

function getCellsData(notebook) {
  return notebook.getCells().map(processCell);
}

function getNbData(nb) {
  return { metadata:nb.metadata, cellCount: nb.cellCount, notebookType: nb.notebookType };
}

/** 
 * @param {vscode.NotebookDocument} nb
 * @param {RendererMessage | null} reqMsg
 * @param {'notebookUpdate' | undefined} changeType
 */
function sentNBState(nb, changeType) {
  const cells = getCellsData(nb);
  const nbData = getNbData(nb);
  const t = Date.now();
  if (DEBUG) console.log("sentNBState", t);
  /** @type {StateMessage} */
  const message = { type: "state", cells: cells, nbData: nbData, timestamp: t };
  if (changeType) message.changeType = changeType;
  NBStateMonitor.messaging.postMessage(message);
}

class NBStateMonitor {
  static monitors = new Map();  // notebook.uri -> NBStateMonitor
  static defaultOpts = {
    watch: false,  // watch for changes, otherwise only send state on renderer request
    contentOnly: false,  // send state if notebook structure changes, e.g. cells added or removed
    debug: false
  };
  static messaging = null;
  static defaultDebounceDelay = 600;
  
  /** @type {Set<string>} - Track renderer output IDs for this notebook to filter out changes */
  #uri;
  #opts;
  debounce = true;
  #debounceDelay = NBStateMonitor.defaultDebounceDelay;
  
  constructor(notebook, opts = {}) {
    this.#uri = notebook.uri.toString();
    this.#opts = { ...NBStateMonitor.defaultOpts, ...opts };
  }
  
  static get(notebook) { return this.monitors.get(notebook.uri.toString()); }
  static delete(notebook) { this.monitors.delete(notebook.uri.toString()); }
  static create(notebook, opts) {
    const monitor = new NBStateMonitor(notebook, opts);
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

  /** @param {{message: RendererStateMessage | RendererDeregisterMessage}} e */
  static onRendererMessage(e) {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor) return;
    /** @type {RendererStateMessage | RendererDeregisterMessage} */
    const nb = editor.notebook; const msg = e.message;
    if (DEBUG) console.log("Message from renderer");
    if (DEBUG) console.log(msg.type, 'from:', msg.outputId);
    const monitor = NBStateMonitor.get(nb) ?? NBStateMonitor.create(nb);
    if (msg.type === "deregister") {
      if (DEBUG) console.log("---- deregister", msg.outputId);
      if (!hasMimeOutputs(nb, MIME)) {
        NBStateMonitor.delete(nb);
        if (DEBUG) console.log("---- deleted monitor");
      }
      if (DEBUG) console.log("----"); return;
    }
    const nOpts = msg.opts;
    if (DEBUG) console.log('nOpst:', nOpts);
    if (DEBUG) console.log("----");
    if (nOpts.watch !== undefined) monitor.watch = nOpts.watch;
    if (nOpts.contentOnly !== undefined) monitor.contentOnly = nOpts.contentOnly;
    if (nOpts.debug !== undefined) DEBUG = nOpts.debug;
    if (!monitor.watch) {
      sentNBState(nb, msg);
    } else {
      if (msg.type === "getState") {
        monitor.oneShotDelay();  // reduce delay for renderer cell changes
      } else {  // updateState
        monitor.oneShotDelay();  // reduce delay for renderer cell changes
      }
      sentNBState(nb, msg);
    }
  }
  
  /** @param {vscode.NotebookDocumentChangeEvent} allEvts[] */
  _onChange(allEvts) {
    if (allEvts.length === 0 || !this.watch) return;
    const nb = allEvts[0].notebook;
    const cells = changedCells(nb, allEvts, this.contentOnly);
    if (!cells.size) { if (DEBUG) console.log("-------- no relevant changed cells"); return; };
    if (this.watch) {
      // assume this changes was triggered by a renderer cell change
      // if (cells.values().some(c => isRendererCell(nb, c))) this.oneShotDelay();
    }
    sentNBState(nb, "notebookUpdate");
  }

  static onChange = (() => {
    const debounceState = new WeakMap();

    return (event) => {
      const monitor = NBStateMonitor.get(event.notebook);
      if (!monitor || !monitor.watch) return;
      
      if (monitor.debounce) {
        let state = debounceState.get(monitor) ?? { events: [], timer: null, delay: monitor.debounceDelay };
        if (DEBUG) console.log("-------- d");
        
        state.events.push(event);
        clearTimeout(state.timer);
        
        state.timer = setTimeout(() => {
          const allEvts = state.events;
          if (allEvts.length === 0) return;
          debounceState.delete(monitor);
          if (!NBStateMonitor.get(allEvts[0].notebook)) return;  // deleted
          monitor.restoreDebounceDelay();
          monitor._onChange(allEvts);
        }, state.delay);
        
        debounceState.set(monitor, state);
        return;
      }
      
      monitor._onChange([event]);
    };
  })();

}

// ---- Extension life-cycle ----

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  if (DEBUG) console.log('Extension "nbinspect" is now active!');
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
