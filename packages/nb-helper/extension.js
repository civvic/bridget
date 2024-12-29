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

let debounceTimer = null;

/** @type {Map<string, boolean>} - Track notebooks with active state outputs */
let monitors = new Map();  // notebook.uri -> true

/** @type {Map<string, Set<string>>} - Track state output IDs per notebook */
let stateOutputs = new Map(); // notebook.uri -> Set(outputId)

function setMonitor(notebook) { monitors.set(notebook.uri.toString(), true); }
function clearMonitor(notebook) { monitors.delete(notebook.uri.toString()); }
function getMonitor(notebook) { return monitors.get(notebook.uri.toString()); }

/**
 * Register a state output for a notebook
 * @param {vscode.NotebookDocument}
 * @param {string} outputId - The output's unique identifier
 */
function addStateOutput(notebook, outputId) {
  const uri = notebook.uri.toString();
  if (!stateOutputs.has(uri)) {
    stateOutputs.set(uri, new Set());
  }
  stateOutputs.get(uri).add(outputId);
}

/**
 * Remove a state output registration
 * @param {vscode.NotebookDocument}
 * @param {string} outputId - The output's unique identifier
 */
function removeStateOutput(notebook, outputId) {
  const uri = notebook.uri.toString();
  const outputs = stateOutputs.get(uri);
  if (outputs) {
    outputs.delete(outputId);
    if (outputs.size === 0) {
      stateOutputs.delete(uri);
    }
  }
}

/** @param {vscode.NotebookDocument} notebook */
function hasStateOutputs(notebook) {
	return notebook.getCells().some(
		/** @param {vscode.NotebookCell} cell */
		cell => 
			cell.outputs.some(output => 
					output.items.some(item => 
							item.mime === "application/x-notebook-state"
					)
			)
	);
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

function getMimeBundle(items) {
  return items.reduce((bundle, item) => {
    if (item.data) {
      bundle[item.mime] = bufferToString(item.data, item.mime);
    }
    return bundle;
  }, {});
}

// ---- State ----

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
  if (metadata?.metadata?.bridget?.skip) return undefined;
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

/**
 * Get current notebook state data
 * @returns {Object | null} Notebook cells data or null if no active editor
 */
function getCellsData() {
  const editor = vscode.window.activeNotebookEditor;
  if (!editor) return null;
  return editor.notebook.getCells().map(processCell);
}

// ---- Extension ----

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  console.log('Congratulations, your extension "nb-helper" is now active!');

  // Register debug command
  const disposable = vscode.commands.registerCommand(
    "nb-helper.getNoteContent",
    /** @returns {Promise<Object[] | void>} Cell data or void if no active notebook */
    async function () {
      const editor = vscode.window.activeNotebookEditor;

      if (!editor) {
        await vscode.window.showInformationMessage("No notebook is active");
        return;
      }

      const notebook = editor.notebook;
      const cells = notebook.getCells();

      const cellsData = cells.map((cell) => ({
        kind: cell.kind,
        value: cell.document.getText(),
        metadata: cell.metadata,
      }));

      console.log(`Found ${cells.length} cells:`, cellsData);
      vscode.window.showInformationMessage(`Found ${cells.length} cells`);

      return cellsData;
    }
  );

  // Setup renderer messaging
  /** @type {vscode.NotebookRendererMessaging} */
  const messaging = vscode.notebooks.createRendererMessaging("nb-helper-renderer");

  // Handle renderer messages
  messaging.onDidReceiveMessage(
    /** @param {{message: GetStateMessage | DeregisterMessage}} e */
    (e) => {
      console.log("Message from renderer:", e);
      const editor = vscode.window.activeNotebookEditor;
      if (!editor) return;

      if (e.message.type === "getState") {
        setMonitor(editor.notebook);
        addStateOutput(editor.notebook, e.message.outputId);
        const cells = getCellsData();
        messaging.postMessage({ type: "state", cells: cells });
      } else if (e.message.type === "deregister") {
        removeStateOutput(editor.notebook, e.message.outputItemId);
      }
    }
  );

  // Listen for notebook changes
  const notebookChangeListener = vscode.workspace.onDidChangeNotebookDocument(
    /** @param {vscode.NotebookDocumentChangeEvent} event */
    (event) => {
      const notebook = event.notebook;

      // Check if notebook is being monitored
      const monitor = getMonitor(notebook);
      if (!monitor) return; // No monitor for this notebook

      // Filter out changes that only affect state outputs
      /** @type {Set<string>} */
      const stateOutputIds = stateOutputs.get(notebook.uri.toString()) || new Set();
      const hasNonStateChanges = event.cellChanges.some((change) =>
        change.outputs?.some((output) => !stateOutputIds.has(output.id))
      );

      if (!hasNonStateChanges) return; // Skip if only state outputs changed

      // Stop monitoring if no state outputs remain
      if (!hasStateOutputs(notebook)) {
        clearMonitor(notebook);
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
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            /** @type {StateMessage} */
            const cells = getCellsData();
            messaging.postMessage({
              type: "state",
              cells: cells,
              changeType: "notebookUpdate",
            });
          }, 1000); // 1 second delay
          return;
        }

        const cells = getCellsData();
        /** @type {StateMessage} */
        messaging.postMessage({
          type: "state",
          cells: cells,
          changeType: "notebookUpdate",
        });
      }
    }
  );

  context.subscriptions.push(disposable, messaging, notebookChangeListener);
}

function deactivate() {
	monitors.clear();
	stateOutputs.clear();
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}
}

module.exports = {
	activate,
	deactivate
}