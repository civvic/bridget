// The module 'vscode' contains the VS Code extensibility API



// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const crypto = require('crypto');

/**
 * @typedef {Object} StateMessage
 * @property {'state'} type - Message type identifier
 * @property {Object} data - Notebook state data
 * @property {'notebookUpdate'} [changeType] - Type of change that triggered update
 */

/**
 * @typedef {Object} GetStateMessage
 * @property {'getState'} type - Message type identifier
 * @property {string} outputId - ID of the output requesting state
 */

/**
 * @typedef {Object} DeregisterMessage 
 * @property {'deregister'} type - Message type identifier
 * @property {string} outputItemId - ID of the output being removed
 */

// ---- Utils ----

function delIfEmpty(obj, key) {
  if (obj[key] && Object.keys(obj[key]).length === 0) delete obj[key];
}

// ---- Notebook State monitoring ----

const NBSTATE_MIME = 'application/x-notebook-state';
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

// /**
//  * Get current notebook state data
//  * @returns {Object | null} Notebook cells data or null if no active editor
//  */
// function getCellsData() {
//   const editor = vscode.window.activeNotebookEditor;
//   if (!editor) return null;
//   return editor.notebook.getCells().map(processCell);
// }

class NBStateMonitor {
  static monitors = new Map();  // notebook.uri -> NBStateMonitor
  static defaultOpts = { watch: true };
  static messaging = null;

  /** @type {Set<string>} - Track state output IDs for this notebook */
  #stateOutputs = new Set();
  #debounceTimer = null;
  #uri;
  #opts;

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

  addStateOutput(outputId) { this.#stateOutputs.add(outputId); }
  removeStateOutput(outputId) { this.#stateOutputs.delete(outputId); }
  hasStateOutput(outputId) { return this.#stateOutputs.has(outputId); }

  get isEmpty() { return this.#stateOutputs.size === 0; }

  get debounceTimer() { return this.#debounceTimer; }
  set debounceTimer(timer) {
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = timer;
  }

  static hasStateFeedbackOutputs(notebook) {
    return notebook.getCells().some(
      /** @param {vscode.NotebookCell} cell */
      cell => cell.outputs.some(output => output.items.some(item => 
        item.mime === NBSTATE_MIME)));
  }

  static getCellsData(notebook) {
    return notebook.getCells().map(processCell);
  }

  /** @param {{message: GetStateMessage | DeregisterMessage}} e */
  static onRendererMessage(e) {
    console.log("Message from renderer:", e);
    const editor = vscode.window.activeNotebookEditor;
    if (!editor) return;
    const monitor = NBStateMonitor.get(editor.notebook) ?? NBStateMonitor.create(editor.notebook);
    const nOpts = e.message.opts;
    if (nOpts) {
      if (nOpts.watch !== undefined) monitor.#opts.watch = nOpts.watch;
    }
    if (e.message.type === "getState") {
      monitor.addStateOutput(e.message.outputId);
      const cells = NBStateMonitor.getCellsData(editor.notebook);
      NBStateMonitor.messaging.postMessage({ type: "state", cells: cells });
    } else if (e.message.type === "deregister") {
      monitor.removeStateOutput(e.message.outputId);
      if (monitor.isEmpty) NBStateMonitor.delete(editor.notebook);
    }
  }

  /** @param {vscode.NotebookDocumentChangeEvent} event */
  static onNotebookDocumentChange(event) {
    const notebook = event.notebook;
    const monitor = NBStateMonitor.get(notebook);
    if (!monitor || !monitor.#opts.watch) return;

    // Filter out changes that only affect feedback outputs
    const hasNonStateChanges = event.cellChanges.some((change) =>
      change.outputs?.some((output) => !monitor.hasStateOutput(output.id))
    );

    if (!hasNonStateChanges) return; // Skip if only state outputs changed

    // Stop monitoring if no state outputs remain
    if (!NBStateMonitor.hasStateFeedbackOutputs(notebook)) {
      NBStateMonitor.delete(notebook);
      return;
    }

    // Process notebook changes
    const hasContentChanges = event.contentChanges.length > 0;
    const hasCellChanges = event.cellChanges.some(
      /** @param {vscode.NotebookCellChangeEvent} change */
      (change) =>
        // change.executionSummary || // Cell was executed
        change.document || // Cell content changed
        change.metadata || // Cell metadata changed
        change.outputs // Cell outputs changed
    );

    if (hasContentChanges || hasCellChanges) {
      // Debounce content-only changes
      const isOnlyContentChange = event.cellChanges.every(
        (change) => change.document && !change.outputs
      );

      if (isOnlyContentChange) {
        if (monitor.debounceTimer) clearTimeout(monitor.debounceTimer);
        monitor.debounceTimer = setTimeout(() => {
          /** @type {StateMessage} */
          const cells = NBStateMonitor.getCellsData(notebook);
          NBStateMonitor.messaging.postMessage({
            type: "state",
            cells: cells,
            changeType: "notebookUpdate",
          });
        }, 1000); // 1 second delay
        return;
      }
      if (monitor.debounceTimer) {
        clearTimeout(monitor.debounceTimer);
        monitor.debounceTimer = null;
      }
      // is change in one of our feedback elements?
      const changedCells = event.cellChanges.filter(
        change => change.outputs?.some(output => output.items?.some(item => item.mime !== NBSTATE_MIME))
      );
      if (changedCells.length > 0) {
        const cells = NBStateMonitor.getCellsData(notebook);
        /** @type {StateMessage} */
        NBStateMonitor.messaging.postMessage({
          type: "state",
          cells: cells,
          changeType: "notebookUpdate",
        });
      }
    }
  }

}

// ---- Extension life-cycle ----

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  console.log('Congratulations, your extension "nb-helper" is now active!');
  const messaging = vscode.notebooks.createRendererMessaging("nb-helper-renderer");
  NBStateMonitor.messaging = messaging;
  messaging.onDidReceiveMessage(NBStateMonitor.onRendererMessage);
  const listener = vscode.workspace.onDidChangeNotebookDocument(NBStateMonitor.onNotebookDocumentChange);
  context.subscriptions.push(messaging, listener);
}

function deactivate() {
  NBStateMonitor.monitors.forEach(monitor => {
    if (monitor.debounceTimer) clearTimeout(monitor.debounceTimer);
  });
  NBStateMonitor.monitors.clear();
}

module.exports = { activate, deactivate };
