// This script runs in the notebook output webview
debugger;

/** @typedef {import('vscode-notebook-renderer').ActivationFunction} ActivationFunction */
/** @typedef {import('vscode-notebook-renderer').OutputItem} OutputItem */
/** @typedef {import('vscode-notebook-renderer').RenderContext} RenderContext */
/** @typedef {import('vscode-notebook-renderer').NotebookRendererScript} NotebookRendererScript */

/** @typedef {Object} StateMessage
 * @property {'state'} type
 * @property {'notebookUpdate' | 'initial'} changeType
 * @property {Array<CellData>} cells
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

/** @typedef {Object} Options
 * @property {boolean} feedback  // show feedback so user can see changes
 * @property {boolean} watch     // watch for changes
 */

const NBSTATE_FEEDBACK_CLS = 'notebook-state-feedback';
const NBSTATE_SCRIPT_ID = 'notebook-state-json';
const SUMMSTL = `
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

// ---- utils ----

function _truncate(str, maxLength = 100) {
  return str.length > maxLength ? str.substring(0, maxLength) + "..." : str;
}

const pickDefined = (obj, ...keys) => Object.fromEntries(
  keys.map(k => [k, obj?.[k]]).filter(([_, v]) => v !== undefined) // eslint-disable-line no-unused-vars
);

// ---- rendering ----

/** summary for debugging
 * @param {StateMessage}
 * @returns {string} HTML string
 */
function summaryHTML(message) {
  return message.cells.map((cell, idx) => {
    let src = cell.source;
    // source possibly has HTML content, sanitize it
    src = src.replace(/<[^>]*>?/gm, '');
    src = _truncate(JSON.stringify(src));
    return `
    <div class="cell-info">
      <strong>Cell ${idx}</strong> (${cell.cell_type})
      <div class="cell-text">Source: ${src}</div>
      ${cell.metadata ? `
        <div class="cell-metadata">Metadata: ${Object.keys(cell.metadata).join(', ')}</div>
      ` : ''}
      ${(cell.outputs?.length) ? `
        <div class="output-info">Outputs (${cell.outputs.length}):
          ${cell.outputs.map(out => `
            <div>Type: ${out.output_type}${out.data ? `
              <div>MIME types: ${Object.keys(out.data).join(', ')}</div>\n` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `}).join('');
}

/** feedback for debugging
 * @param {StateMessage} message
 * @param {Options} opts
 * @returns {string} HTML string
 */
function renderNBStateFeedback(message, opts) {
  if (!opts.feedback) return `
    <div class="${NBSTATE_FEEDBACK_CLS}">
      <div class="timestamp">Last updated: ${message.timestamp}</div>
    </div>
  `;
  const updateClass = message.changeType === "notebookUpdate" ? "update-flash" : "";
  return `
    <div class="${NBSTATE_FEEDBACK_CLS}">
      <div class="timestamp">Last updated: ${message.timestamp}</div>
      ${SUMMSTL}
      <details class="${updateClass}">
        <summary><strong>Cells:</strong></summary>
        ${summaryHTML(message)}
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
    doc.querySelector(`script#${NBSTATE_SCRIPT_ID}`) ||
    doc.body.appendChild(
      Object.assign(doc.createElement("script"), {
        id: NBSTATE_SCRIPT_ID,
        type: "application/json",
      })
    )
  );
}

/** Setup notebook state in the DOM
 * @param {StateMessage} message
 * @param {HTMLElement} element
 * @param {string} outputId
 * @param {Options} opts
 */
function setupNBState(message, element, outputId, opts) {
  const t = new Date().toLocaleTimeString();
  message.timestamp = t;
  // Update feedback in this output
  element.innerHTML = renderNBStateFeedback(message, opts);
  // Update state if we're the owner or first time
  const script = getStateScript();
  if (!script.dataset.owner) script.dataset.owner = outputId;
  if (script.dataset.owner === outputId) script.textContent = JSON.stringify(message);
}

class NBStateRenderer {
  static _defaultOpts = { feedback: true, watch: true };
  static _renderers = new Map();  // Track listeners, options per output
  
  static render(context, outputItem, element) {
    const feedbackItemId = outputItem.id;
    const opts = outputItem.json();
    console.log("output item", feedbackItemId, outputItem.mime, opts);
    const nOpts = pickDefined(opts, 'watch', 'feedback');

    let renderer = this._renderers.get(feedbackItemId);
    if (!renderer) {
      renderer = new this(context, element, feedbackItemId, nOpts);
      this._renderers.set(feedbackItemId, renderer);
    } else {
      renderer.opts = { ...renderer.opts, ...nOpts };
    }
    
    context.postMessage({ type: "getState", outputId: feedbackItemId, opts: nOpts });
    return renderer;
  }

  static delete(feedbackItemId) {
    const stateScript = getStateScript();
    if (stateScript) {  // If this was the owner, clear ownership
      if (stateScript.dataset.owner === feedbackItemId) delete stateScript.dataset.owner;
    }
    const renderer = this._renderers.get(feedbackItemId);
    if (renderer) {
      renderer.listener.dispose();
      this._renderers.delete(feedbackItemId);
    }
    // Check for remaining outputs after DOM update
    globalThis.requestAnimationFrame(() => {
      if (!globalThis.document.querySelectorAll(`.${NBSTATE_FEEDBACK_CLS}`).length) {
        stateScript?.remove();
      }
    });
  }

  constructor(context, feedbackEl, feedbackItemId, opts) {
    this.feedbackEl = feedbackEl;
    this.feedbackItemId = feedbackItemId;
    this.opts = { ...NBStateRenderer._defaultOpts, ...opts };
    this.listener = context.onDidReceiveMessage(this.onMessage.bind(this));
  }
  
  onMessage(message) {
    if (message.type === "state") {
      setupNBState(message, this.feedbackEl, this.feedbackItemId, this.opts);
    } else if (message.type === "error") {
      this.feedbackEl.innerHTML = `<div class="error">${message.message}</div>`;
    }
  }
}

/** @type {ActivationFunction} */
export function activate(context) {
  if (!context.postMessage) throw new Error("No postMessage function");

  return {
    /** @param {OutputItem} outputItem */
    /** @param {HTMLElement} element */
    renderOutputItem(outputItem, element) {
      try { NBStateRenderer.render(context, outputItem, element); }
      catch (error) {
        console.error("Error in renderer:", error);
        element.innerHTML = `<div class="error">Error: ${error.message}</div>`;
      }
    },
    disposeOutputItem(outputItemId) {
      NBStateRenderer.delete(outputItemId);
      context?.postMessage({ type: "deregister", outputId: outputItemId });
    }
  };
}
