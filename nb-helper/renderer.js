// This script runs in the notebook output webview
debugger;

/** @typedef {import('vscode-notebook-renderer').ActivationFunction} ActivationFunction */
/** @typedef {import('vscode-notebook-renderer').OutputItem} OutputItem */
/** @typedef {import('vscode-notebook-renderer').RenderContext} RenderContext */
/** @typedef {import('vscode-notebook-renderer').NotebookRendererScript} NotebookRendererScript */

/** @typedef {Object} StateMessage
 * @property {'state'} type
 * @property {'notebookUpdate' | 'initial'} changeType
 * @property {Array<CellData>} data
 */

/** @typedef {Object} ErrorMessage
 * @property {'error'} type
 * @property {string} message
 */

/** @typedef {Object} DeregisterMessage
 * @property {'deregister'} type
 * @property {string} outputId
 */

/** @typedef {Object} CellData
 * @property {'code' | 'markdown' | 'raw'} cell_type
 * @property {string} source
 * @property {Object} [metadata]
 * @property {Array<OutputData>} [outputs]
 */ 

/** @typedef {Object} OutputData
 * @property {'stream' | 'display_data' | 'execute_result' | 'error'} output_type
 * @property {Object} [data]
 * @property {Object} [metadata]
 */

const _summ_stl = `
<style>
.update-flash { animation: flash 0.5s ease-out; }
@keyframes flash {
  0% { background-color: pink; }
  100% { background-color: transparent; }
  }
  .cell-info { margin-bottom: 1em; }
  .output-info { margin-left: 2em; }
  </style>
  `;
  
/** @param {string} str
 * @param {number} [maxLength=100]
 * @returns {string}
 */
function _truncate(str, maxLength = 100) {
  return str.length > maxLength ? str.substring(0, maxLength) + "..." : str;
}

/** summary for debugging
 * @param {StateMessage}
 * @returns {string} HTML string
 */
function _summaryHTML(message) {
  return message.data.map((cell, idx) => `
    <div class="cell-info">
      <strong>Cell ${idx}</strong> (${cell.cell_type})
      <div class="cell-text">
        Source: ${JSON.stringify(_truncate(cell.source))}
      </div>
      ${cell.metadata ? `
        <div class="cell-metadata">
          Metadata: ${Object.keys(cell.metadata).join(', ')}
        </div>
      ` : ''}
      ${(cell.outputs?.length) ? `
        <div class="output-info">
          Outputs (${cell.outputs.length}):
          ${cell.outputs.map(out => `
            <div>Type: ${out.output_type}
              ${out.data ? `
                <div>MIME types: ${Object.keys(out.data).join(', ')}</div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `).join('');
}

/** feedback for debugging
 * @param {StateMessage} message
 * @returns {string} HTML string
 */
function renderNBState_feedback(message) {
  const updateClass = message.changeType === "notebookUpdate" ? "update-flash" : "";
  return `
    <div class="notebook-state-feedback">
      <div class="timestamp">Last updated: ${message.timestamp}</div>
      ${_summ_stl}
      <details class="${updateClass}">
        <summary><strong>Cells:</strong></summary>
        ${_summaryHTML(message)}
      </details>
    </div>
  `;
}

/** Get or create the notebook state script element
 * @returns {HTMLScriptElement|null}
 */
function getStateScript() {
  const doc = globalThis.document;
  return (
    doc.querySelector("script#notebook-state-json") ||
    doc.body.appendChild(
      Object.assign(doc.createElement("script"), {
        id: "notebook-state-json",
        type: "application/json",
      })
    )
  );
}

/** Setup notebook state in the DOM
 * @param {StateMessage} message
 * @param {HTMLElement} element
 * @param {string} outputId
 */
function setupNBState(message, element, outputId) {
  const t = new Date().toLocaleTimeString();
  message.timestamp = t;

  // Update feedback in this output
  element.innerHTML = renderNBState_feedback(message);

  // Update state if we're the owner
  const stateScript = getStateScript();
  if (!stateScript.dataset.owner) {
    stateScript.dataset.owner = outputId;
  }
  if (stateScript.dataset.owner === outputId) {
    stateScript.textContent = JSON.stringify(message);
  }
}


/** Check if there are any state outputs left
 * @returns {boolean}
 */
function hasStateOutputs() {
  const doc = globalThis.document;
  return doc.querySelectorAll('.notebook-state-feedback').length > 0;
}

/** @type {ActivationFunction} */
export function activate(context) {
  // Track listeners per output
  const messageListeners = new Map();

  return {
    renderOutputItem(outputItem, element) {
      try {
        console.log("output item", outputItem.id, outputItem.mime, outputItem.json());

        if (context.postMessage) {
          const listener = context.onDidReceiveMessage((message) => {
            if (message.type === "error") {
              element.innerHTML = `<div class="error">${message.message}</div>`;
              return;
            }
            if (message.type === "state") setupNBState(message, element, outputItem.id);
          });
          messageListeners.set(outputItem.id, listener);

          setTimeout(() => {
            context.postMessage({ type: "getState", outputId: outputItem.id });
          }, 100);
        }

        element.innerHTML = `
            <div>Requesting notebook state...</div>
        `;
      } catch (error) {
        console.error("Error in renderer:", error);
        element.innerHTML = `<div class="error">Error: ${error.message}</div>`;
      }
    },

    disposeOutputItem(outputItemId) {
      const stateScript = getStateScript();
      if (stateScript) {
        // If this was the owner, clear ownership
        if (stateScript.dataset.owner === outputItemId) {
          delete stateScript.dataset.owner;
        }
      }
      if (context.postMessage) {
        context.postMessage({ type: "deregister", outputItemId });
      }

      // unsubscribe from state updates
      const listener = messageListeners.get(outputItemId);
      if (listener) {
        listener.dispose();
        messageListeners.delete(outputItemId);
      }

      // Check for remaining outputs after DOM update
      globalThis.requestAnimationFrame(() => {
        if (!hasStateOutputs()) {
          stateScript?.remove();
        }
      });
    },
  };
}
