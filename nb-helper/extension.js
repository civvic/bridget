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

/**
 * Get current notebook state data
 * @returns {Object | null} Notebook cells data or null if no active editor
 */
function getCellsData() {
	const editor = vscode.window.activeNotebookEditor;
	if (!editor) return null;
	return editor.notebook.getCells().map((cell) => ({
		kind: cell.kind,
		index: cell.index,
		text: cell.document.getText(),
		outputs: cell.outputs.map((output) => ({
			id: output.id,
			items: output.items.map((item) => ({
				mime: item.mime,
			})),
		})),
	}));
}

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
        const state = getCellsData();
        messaging.postMessage({ type: "state", data: state });
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
            const state = getCellsData();
            messaging.postMessage({
              type: "state",
              data: state,
              changeType: "notebookUpdate",
            });
          }, 1000); // 1 second delay
          return;
        }

        const state = getCellsData();
        /** @type {StateMessage} */
        messaging.postMessage({
          type: "state",
          data: state,
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