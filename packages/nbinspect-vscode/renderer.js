// This script runs in the notebook output webview
debugger;

/** @typedef {import('vscode-notebook-renderer').RendererContext} RendererContext */
/** @typedef {import('vscode-notebook-renderer').OutputItem} OutputItem */
/**
 * @typedef {Object} ExtensionMessage
 * @property {'state'|'error'} type - Message type identifier
 * @property {Object} cells - Notebook cells
 * @property {Object} NBData - Notebook metadata
 * @property {number} timestamp - Timestamp of the state message
 * @property {'notebookUpdate'} [changeType] - Type of change that triggered update
 * @property {string} [outputId] - ID of the output requesting state
 * @property {string} [reqid] - ID of the request
 * @property {string} [message] - Error message
 */

/**
 * @typedef {Object} Options
 * @property {boolean} feedback - Show feedback so user can see changes
 * @property {boolean} watch - Watch for changes (extension)
 * @property {boolean} contentOnly - Only estructural changes (extension)
 */

/**
 * @typedef {Object} StateMessage
 * @property {'getState'} type - Message type identifier
 * @property {string} outputId - ID of the output requesting state
 * @property {string} reqid - ID of the request
 * @property {Options} opts - Options for the renderer
 */

/** 
 * @typedef {Object} DeregisterMessage
 * @property {'deregister'} type - Message type identifier
 * @property {string} outputId - ID of the output requesting the action
 */

/** 
 * @typedef {Object} CellData
 * @property {'code' | 'markdown' | 'raw'} cell_type
 * @property {string} source
 * @property {Object} [metadata]
 * @property {Array<OutputData>} [outputs]
 */ 

/** 
 * @typedef {Object} OutputData
 * @property {'stream' | 'display_data' | 'execute_result' | 'error'} output_type
 * @property {Object} [data]
 * @property {Object} [metadata]
 */

let DEBUG = true;

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
const TSFMT = { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 };
const timeFormatter = new Intl.DateTimeFormat(undefined, TSFMT);

// ---- utils ----

function _truncate(str, maxLength = 100) {
  return str.length > maxLength ? str.substring(0, maxLength) + "..." : str;
}

/** Pick defined properties from an object
 * @param {Object} obj
 * @param {...string} keys
 * @returns {Object}
 */
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
  // message.timestamp is a number, convert to Date
  const t = new Date(message.timestamp);
  const ts = timeFormatter.format(t);
  if (!opts.feedback) return `
    <div class="${NBSTATE_FEEDBACK_CLS}">
      <div class="timestamp">Last updated: ${ts}</div>
    </div>
  `;
  const updateClass = "update-flash";
  return `
    <div class="${NBSTATE_FEEDBACK_CLS}">
      <div class="timestamp">Last updated: ${ts}</div>
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
 * @param {ExtensionMessage} message
 * @param {HTMLElement} element
 * @param {string} outputId
 * @param {Options} opts
 */
function setupNBState(message, element, outputId, opts) {
  element.innerHTML = renderNBStateFeedback(message, opts);
  // Update state if ts doesn't match
  const script = getStateScript(); const d = script.dataset;
  const ts = `${message.timestamp}`; const reqid = `${message.reqid}`;
  const update =  !d.ts || // first time
                  !(d.ts === ts);
  if (DEBUG) {
    console.group('setupNBState');
    console.log('outputId:', outputId);
    console.log('message reqid/ts:', reqid, ts);
    console.log('script', JSON.stringify(d), ' - update:', update);
    console.groupEnd();
  }
  if (update) {
    d.ts = ts;
    script.textContent = JSON.stringify(message);
  }
}

class NBStateRenderer {
  /** @type {Options} */
  static _defaultOpts = { feedback: true, watch: false,  contentOnly: true, debug: false };
  static _renderers = new Map();  // Track listeners, options per output
  
  /**
   * @param {RendererContext} context
   * @param {HTMLElement} feedbackEl
   * @param {string} feedbackItemId
   * @param {Options} opts
   */
  constructor(context, feedbackEl, feedbackItemId, opts) {
    this.feedbackEl = feedbackEl;
    this.feedbackItemId = feedbackItemId;
    this.opts = { ...NBStateRenderer._defaultOpts, ...opts };
    this.listener = context.onDidReceiveMessage(this.onMessage.bind(this));
  }
  
  static delete(feedbackItemId) {
    const stateScript = getStateScript();
    // if (stateScript) {  // If this was the owner, clear ownership
    //   if (stateScript.dataset.rid === feedbackItemId) delete stateScript.dataset.rid;
    // }
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

  static render(context, outputItem, element) {
    const feedbackItemId = outputItem.id;
    const opts = outputItem.json();
    const reqid = opts.id
    const update = opts.update
    if (opts.debug !== undefined) DEBUG = opts.debug;
    if (DEBUG) {
      console.group("render");
      console.log("feedbackItemId", feedbackItemId);
      console.log(outputItem.mime, opts);
      console.groupEnd();
    }
    const nOpts = pickDefined(opts, ...Object.keys(this._defaultOpts));
    
    let renderer = this._renderers.get(feedbackItemId);
    if (!renderer) {
      renderer = new this(context, element, feedbackItemId, nOpts);
      this._renderers.set(feedbackItemId, renderer);
    } else {
      renderer.opts = { ...renderer.opts, ...nOpts };
    }  
    const msgType = update ? 'updateState' : 'getState';
    /** @type {RendererStateMessage} */
    const msg = { type: msgType, outputId: feedbackItemId, reqid: reqid, opts: nOpts };
    context.postMessage(msg);
    return renderer;
  }  

  /** @param {ExtensionMessage} message */
  onMessage(message) {
    if (message.type === "state") {
      setupNBState(message, this.feedbackEl, this.feedbackItemId, this.opts);
    } else if (message.type === "error") {
      this.feedbackEl.innerHTML = `<div class="error">${message.message}</div>`;
    }
  }

}

/** @param {RendererContext} context */
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
      if (DEBUG) console.log('disposeOutputItem', outputItemId);
      NBStateRenderer.delete(outputItemId);
      /** @type {RendererDeregisterMessage} */
      const msg = { type: "deregister", outputId: outputItemId };
      context?.postMessage(msg);
    }
  };
}
