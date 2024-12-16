// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

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

// ---- State ----

function bufferToString(data) {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return data;
}

function getOutputMetadata(output) {
  const metadata = {};
  if (output.metadata?.outputType) metadata.outputType = output.metadata.outputType;
  if (output.metadata?.metadata && Object.keys(output.metadata.metadata).length > 0) {
      metadata.metadata = output.metadata.metadata;
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function getTypeSpecificFields(output) {
  const type = getOutputType(output);
  switch(type) {
      case 'stream':
          return {
              name: output.items[0].mime.includes('stderr') ? 'stderr' : 'stdout',
              text: bufferToString(output.items[0].data)
          };
      case 'error':
          const errorData = output.items[0].data;
          const fields = { ename: errorData.name, evalue: errorData.message };
          if (errorData.stack) fields.traceback = errorData.stack.split('\n');
          return fields;
          // case 'execute_result':
          //   return output.metadata?.executionCount !== undefined ? 
          //       { execution_count: output.metadata.executionCount } : 
          //       {};
        default:
            return {};
  }
}

function getOutputType(output) {
  if (output.items.some(item => 
      item.mime === 'application/vnd.code.notebook.error')) {
      return 'error';
  }
  if (output.items.some(item => 
      item.mime === 'application/vnd.code.notebook.stdout' ||
      item.mime === 'application/vnd.code.notebook.stderr')) {
      return 'stream';
  }
  if (output.metadata?.executionCount !== undefined) return 'execute_result';
  return 'display_data';
}

function processOutput(output) {
  const result = { output_type: getOutputType(output), data: getMimeBundle(output.items) };
  const metadata = getOutputMetadata(output);
  if (metadata && Object.keys(metadata).length > 0) result.metadata = metadata;
  return {...result, ...getTypeSpecificFields(output)};
}

function getMimeBundle(items) {
  return items.reduce((bundle, item) => {
      if (item.data) bundle[item.mime] = bufferToString(item.data);
      return bundle;
  }, {});
}

function getCellMetadata(cell) {
  const metadata = {};
  if (cell.metadata.tags?.length > 0) metadata.tags = cell.metadata.tags;
  if (cell.metadata.jupyter) metadata.jupyter = cell.metadata.jupyter;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

// function getCellType(cell) {
//   switch (cell.kind) {
//       case vscode.NotebookCellKind.Markup:  // 1
//           return 'markdown';
//       case vscode.NotebookCellKind.Code:    // 2
//           return 'code';
//       default:
//           return 'raw';  // Rarely used, but included for completeness
//   }
// }
function getCellType(cell) {
  return cell.kind;  // Already numeric: 1 for Markup, 2 for Code
}

function processCell(cell) {
  const cellData = { cell_type: getCellType(cell), source: cell.document.getText() };
  const metadata = getCellMetadata(cell);
  if (metadata) cellData.metadata = metadata;
  if (cell.kind === vscode.NotebookCellKind.Code && cell.outputs.length > 0) {
      cellData.outputs = cell.outputs.map(processOutput);
  }
  return cellData;
}

function getCellsData() {
  const editor = vscode.window.activeNotebookEditor;
  if (!editor) return null;
  return editor.notebook.getCells().map(processCell);
}

/**
 * Get current notebook state data
 * @returns {Object | null} Notebook cells data or null if no active editor
 */
// function getCellsData_old() {
// 	const editor = vscode.window.activeNotebookEditor;
// 	if (!editor) return null;
// 	return editor.notebook.getCells().map((cell) => ({
// 		kind: cell.kind,
// 		index: cell.index,
// 		text: cell.document.getText(),
// 		outputs: cell.outputs.map((output) => ({
// 			id: output.id,
// 			items: output.items.map((item) => ({
// 				mime: item.mime,
// 			})),
// 		})),
// 	}));
// }

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