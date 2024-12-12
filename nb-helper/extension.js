// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

// ---- Utils ----

let debounceTimer = null;

let monitors = new Map();  // notebook.uri -> true

function setMonitor(notebook) {
    monitors.set(notebook.uri.toString(), true);
}

function clearMonitor(notebook) {
    monitors.delete(notebook.uri.toString());
}

function getMonitor(notebook) {
    return monitors.get(notebook.uri.toString());
}

// Helper to check if any cell has state outputs
function hasStateOutputs(notebook) {
	return notebook.getCells().some(cell => 
			cell.outputs.some(output => 
					output.items.some(item => 
							item.mime === "application/x-notebook-state"
					)
			)
	);
}

// Helper function to get cells data
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

// This method is called when the extension is activated
// The extension is activated the very first time the command is executed
/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	console.log('Congratulations, your extension "nb-helper" is now active!');

	// For debugging
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand("nb-helper.getNoteContent", async function () {
    const editor = vscode.window.activeNotebookEditor;

    if (!editor) {
      await vscode.window.showInformationMessage("No notebook is active");
      return;
    }

    const notebook = editor.notebook;
    const cells = notebook.getCells();

    // Convert cells to a simpler format
    const cellsData = cells.map((cell) => ({
      kind: cell.kind,
      value: cell.document.getText(),
      metadata: cell.metadata,
    }));

    // Add console.log for debugging
    console.log(`Found ${cells.length} cells:`, cellsData);

    vscode.window.showInformationMessage(`Found ${cells.length} cells`);

    return cellsData;
  });

  // Create messaging for our renderer
  const messaging = vscode.notebooks.createRendererMessaging('nb-helper-renderer');
    
	// Listen for messages from renderer
	messaging.onDidReceiveMessage((e) => {
    console.log("Message from renderer:", e);
    if (e.message.type === "getState") {
      const editor = vscode.window.activeNotebookEditor;
      if (editor) {
        setMonitor(editor.notebook);
        const state = getCellsData();
        messaging.postMessage({ type: "state", data: state });
      }
    }
  });

	const notebookChangeListener = vscode.workspace.onDidChangeNotebookDocument((event) => {
    const notebook = event.notebook;

    // Get monitor for this notebook
    const monitor = getMonitor(notebook);
    if (!monitor) return; // No monitor for this notebook

    if (!hasStateOutputs(notebook)) {
      clearMonitor(notebook);
      return;
    }

    // Check what actually changed
    const hasContentChanges = event.contentChanges.length > 0;
    const hasCellChanges = event.cellChanges.some(
      (change) =>
        // change.executionSummary || // Cell was executed
        change.document || // Cell content changed
        change.metadata || // Cell metadata changed
        change.outputs // Cell outputs changed
    );
    if (hasContentChanges || hasCellChanges) {
      // If change is only document content, debounce
      const isOnlyContentChange = event.cellChanges.every(
        (change) => change.document && !change.outputs
      );

      if (isOnlyContentChange) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
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
      messaging.postMessage({
        type: "state",
        data: state,
        changeType: "notebookUpdate",
      });
    }
  });

	context.subscriptions.push(disposable, messaging, notebookChangeListener);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
