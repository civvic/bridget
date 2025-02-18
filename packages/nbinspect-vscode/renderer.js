debugger;

let DEBUG = false;

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
  // opts is an object {feedback: true, watch: true, contentOnly: true, debug: false}; convert to HTML
  const optsShow = Object.entries(opts).map(
    ([k, v]) => `<b>${k}</b>: <span style="color:${v?'green':'red'}">${v}</span>`).join(' ');
  if (!opts.feedback) return `
    <div class="${NBSTATE_FEEDBACK_CLS}">
      <div class="timestamp">Last updated: ${ts} - ${optsShow}</div>
    </div>
  `;
  const updateClass = "update-flash";
  return `
    <div class="${NBSTATE_FEEDBACK_CLS}">
      <div class="timestamp">Last updated: ${ts} - ${optsShow}</div>
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

class NBStateRenderer {
  /** @type {RendererContext} */
  context;
  /** @type {string} docId - renderer document id */
  docId;
  /** @type {Disposable} - listener for messages from the extension */
  listener;
  /** @type {Options} */
  _defaultOpts = { feedback: true, watch: false,  contentOnly: false, debug: false };
  opts;
  /** @type {Map<string, Output>} */
  _outputs = new Map();  // Track outputs
  /** @type {Output|null} */
  _output = null;
  /** @type {StateMessage|null} */
  NBState = null;
  /** @type {boolean} */
  #useScript = true;
  
  constructor(context, docId=null) {
    if (!context.postMessage) throw new Error("No postMessage function");
    this.context = context;
    this.docId = docId;
    this.opts = {...this._defaultOpts};
    this.listener = context.onDidReceiveMessage(this.onMessage.bind(this));
    globalThis.$Ren = this;
  }
  
  /** Get active output
   * @returns {Output|null} */
  getOutput() {
    return this._output;
  }

  /** Set active output
   * @param {Output} output */
  setOutput(output) {
    this.deactivateOutput();
    this._output = output;
    if (output) output.active = true;
  }

  /** Hide output
   * @param {Output} output */
  deactivateOutput() {
    const current = this.getOutput();
    if (current) {
      current.active = false;
      current.el.innerHTML = '';
      // current.el.style.display = 'none';
      // this._outputs.delete(current.itemId);
    }
  }

  /** @param {Output} output */
  addOutput(output) {
    this.setOutput(output);
    this._outputs.set(output.itemId, output);
  }
  
  deleteOutput(itemId) {
    if (DEBUG) console.log('disposeOutputItem', itemId);
    // const stateScript = getStateScript();
    // if (stateScript) {  // If this was the owner, clear ownership
    //   if (stateScript.dataset.rid === itemId) delete stateScript.dataset.rid;
    // }
    const output = this._outputs.get(itemId);
    if (output) {
      if (output === this.getOutput()) this._output = null;
      this._outputs.delete(itemId);
      this.setOutput([...this._outputs.values()].at(-1));
    }
    // Check for remaining outputs after DOM update
    // globalThis.requestAnimationFrame(() => {
    //   if (!globalThis.document.querySelectorAll(`.${NBSTATE_FEEDBACK_CLS}`).length) {
    //     stateScript?.remove();
    //   }
    // });
    /** @type {RendererDeregisterMessage} */
    const msg = { type: "deregister", outputId: itemId };
    this.context.postMessage(msg);
  }

  /** Get current notebook state
   * @returns {ExtensionMessage|null} */
  getNBState() { return this.NBState; }

  /** Set notebook state
   * @param {ExtensionMessage} message */
  setNBState(message) {
    this.NBState = message;
    const ts = `${message.timestamp}`, reqid = `${message.reqid}`;
    let d = null, update = false;
    if (this.#useScript) {
      // Update state if ts doesn't match
      const script = getStateScript(), d = script.dataset;
      update =  !d.ts || // first time
                !(d.ts === ts);
      if (update) {
        d.ts = ts;
        script.textContent = JSON.stringify(message);
      }
    } else {
      update = `${this.NBState.timestamp}` !== ts;
    }
    if (DEBUG) {
      console.group('setupNBState');
      console.log('outputId:', message.outputId);
      console.log('message reqid/ts:', reqid, ts);
      console.log('script', JSON.stringify(d), ' - update:', update);
      console.groupEnd();
    }
  }
  
  /** Handle direct updates
   * @param {StateMessage} message */
  update(message) {
    if (message.origin && message.origin !== this.docId) return;
    this.render(null, null, message);
  }
  
  /** Handle message from the extension
   * @param {ExtensionMessage} message */
  onMessage(message) {
    if (message.origin !== this.docId) return;
    let output = this._outputs.get(message.outputId);
    if (!output || !output.active) output = this.getOutput();
    const el = output ? output.el : null;
    if (message.type === "state") {
      if (el) el.innerHTML = renderNBStateFeedback(message, this.opts);
      this.setNBState(message);
    } else if (message.type === "error") {
      if (el) el.innerHTML = `<div class="error">${message.message}</div>`;
    }
  }

  updateOpts(opts) {
    if (opts.debug !== undefined) DEBUG = opts.debug;
    Object.assign(this.opts, pickDefined(opts, ...Object.keys(this._defaultOpts)));
  }

  /** Called to display our MIME output
   * @param {OutputItem} outputItem 
   * @param {HTMLElement} element
   */
  render(outputItem, element, opts={}) {
    if (!this.docId) this.docId = element.ownerDocument.location.href;
    if (outputItem) opts = outputItem.json();
    const itemId = outputItem ? outputItem.id : null;
    this.updateOpts(opts);
    if (DEBUG) {
      console.group("render");
      console.log("output itemId", itemId);
      console.log(outputItem ? outputItem.mime : 'no outputItem', opts);
      console.groupEnd();
    }
    if (itemId && !this._outputs.get(itemId)) this.addOutput({ el: element, itemId });
    const msgType = opts.update ? 'updateState' : 'getState';
    /** @type {RendererStateMessage} */
    const msg = { type: msgType, outputId: itemId, reqid: opts.id, opts: this.opts, origin: this.docId };
    this.context.postMessage(msg);
  }  

}

/** @param {RendererContext} context */
export function activate(context) {
  const renderer = new NBStateRenderer(context, globalThis.document.location.href);
  return {
    renderOutputItem: renderer.render.bind(renderer),
    disposeOutputItem: renderer.deleteOutput.bind(renderer)
  }
}

/** @typedef {import('vscode-notebook-renderer').RendererContext} RendererContext */
/** @typedef {import('vscode-notebook-renderer').OutputItem} OutputItem */

/**
 * @typedef {Object} ExtensionMessage
 * @property {'state'|'error'} type - Message type identifier
 * @property {Object} cells - Notebook cells
 * @property {Object} NBData - Notebook metadata
 * @property {number} timestamp - Timestamp of the state message
 * @property {'notebookUpdate'} [changeType] - Type of change that triggered update
 * @property {string} [origin] - Origin of the change (window.origin, webview)
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
 * @property {string} origin - Origin of the request (window)
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

/** 
 * @typedef {Object} Output
 * @property {HTMLElement} el
 * @property {string} itemId
 * @property {boolean} active
 */
