// Import the common feedback renderer
import { renderNBStateFeedback } from '../../common/feedbackRenderer.js';

let DEBUG = true;
function log(...args) { if (DEBUG) console.log(...args); }
function logGroup(...args) { if (DEBUG) console.group(...args); }
function logGroupEnd() { if (DEBUG) console.groupEnd(); }
function logAll(...args) { 
  if (DEBUG && args.length > 0) {
    console.group(...(args.splice(0, 1)[0]));
    args.forEach(arg => console.log(...arg));
    console.groupEnd();
  } 
}

const NBSTATE_SCRIPT_ID = 'notebook-state-json';
const MSG_TYPE = {full: 'getState', diff: 'updateState', opts: 'updateOpts'};

// ---- utils ----

let count = 0;
function kounter() {
  return count++;
}

/** Pick defined properties from an object
 * @param {Object} obj
 * @param {...string} keys
 * @returns {Object}
 */
const pickDefined = (obj, ...keys) => Object.fromEntries(
  keys.map(k => [k, obj?.[k]]).filter(([_, v]) => v !== undefined) // eslint-disable-line no-unused-vars
);

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
  _defaultOpts = { feedback: true, hide: false, debug: false };
  opts;
  /** @type {Map<string, Output>} */
  outputs = new Map();  // Track outputs
  /** @type {Output|null} */
  #output = null;
  /** @type {StateMessage} */
  #NBState = null;
  /** @type {boolean} */
  #useScript = true;
  /** @type {Map<string, {resolve: (value: any) => void, reject: (reason?: any) => void, timeoutId: number}>} */
  #pendingResponses = new Map();  // reqId -> {resolve, reject, timeoutId}
  #observers = new Set();
  
  constructor(context, docId=null) {
    if (!context.postMessage) throw new Error("No postMessage function");
    this.context = context;
    this.docId = docId;
    this.opts = {...this._defaultOpts};
    // General listener for messages from the extension
    this.listener = context.onDidReceiveMessage(this.onMessage.bind(this));
    // Global variable for easy access to the renderer by others in the webview, i.e., widgets
    // globalThis.window.$Nb = {
    //   addStateObserver: (callback) => this.addStateObserver(callback),
    //   getNBState: () => this.getNBState(),
    //   update: (message) => this.update(message),
    //   aupdate: (message) => this.aupdate(message)
    // };
    globalThis.$Nb = this;
  }
  
  /** Get active output
   * @returns {Output|null} */
  get output() {
    return this.#output;
  }

  /** Set active output
   * @param {Output} output */
  set output(output) {
    log('set output', output?.itemId);
    this.deactivateOutput();
    this.#output = output;
    if (output) output.active = true;
  }

  /** Hide output
   * @param {Output} output */
  deactivateOutput() {
    const current = this.output;
    if (current) {
      current.active = false;
      current.el.innerHTML = '';
      log('deactivateOutput', current.itemId);
    }
  }

  /** @param {Output} output */
  addOutput(output) {
    this.output = output;
    this.outputs.set(output.itemId, output);
  }
  
  deleteOutput(itemId) {
    log('disposeOutputItem', itemId);
    const output = this.outputs.get(itemId);
    if (output) {
      this.outputs.delete(itemId);
      if (output === this.output) {
        this.output = null;
        this.output = [...this.outputs.values()].at(-1);
      }
    }
    if (this.outputs.size === 0) {
      this.output = null;
      /** @type {RendererDeregisterMessage} */
      const msg = { type: "deregister" };
      this.context.postMessage(msg);
    }
  }

  /** Add a callback to be called when the notebook state changes
   * @param {Function<StateChange[], NBData>} callback
   * @returns {Function} cleanup function */
  addStateObserver(callback) {
    this.#observers.add(callback);
    return () => this.#observers.delete(callback); // returns cleanup function
  }

  /** Get current notebook state
   * @returns {StateMessage|null} */
  get NBState() { return this.#NBState; }
  getNBState() { return this.#NBState; }

  /** Set notebook state
   * @param {StateMessage} message */
  set NBState(message) {
    const ts = `${message.timestamp}`, reqId = `${message.reqId}`;
    if (this.#pendingResponses.has(reqId)) {
      const {resolve, timeoutId} = this.#pendingResponses.get(reqId);
      clearTimeout(timeoutId);
      this.#pendingResponses.delete(reqId);
      resolve(message);
    }
    this.#NBState = message;
    this.#observers.forEach(cb => cb(message));
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
      update = `${this.message.timestamp}` !== ts;
    }
    if (DEBUG) {
      logGroup(`set NBState:${message.type} - update:${update}`);
      if (message.type === 'diffs') {
        log(`message ts: ${ts} changes: ${message.changes.length}`);
        message.changes.forEach((c, i) => {
          const added = c.added && c.added.length ? `added: ${c.added.map(c => c.idx).join(', ')}` : '';
          const removed = c.removed && c.removed.length ? `removed: ${c.removed.join(', ')}` : '';
          log(`    ${i}: ${added} ${removed} cells: ${c.cells.map(c => c.idx).join(', ')}`);
        });
      } else {
        log(`cells ${message.cells.map(c => c.idx).join(', ')}`);
      }
      logGroupEnd();
    }
  }
  
  /** Handle message from the extension
   * @param {StateMessage|DiffsMessage} msg 
   */
  onMessage(msg) {
    logGroup(Date.now(), `onMessage:${msg.changes?.length ?? msg.cells?.length}`);
    if (msg.origin !== this.docId) return;
    const output = this.output;
    const el = output ? output.el : null;
    if (msg.type === "state" || msg.type === "diffs") {
      if (el) el.innerHTML = renderNBStateFeedback(msg, this.opts);
      this.NBState = msg;
    } else if (msg.type === "error") {
      if (el) el.innerHTML = `<div class="error">${msg.message}</div>`;
    }
    logGroupEnd();
  }

  /** Called from elsewhere in the webview or other renderers to handle direct updates
   * @param {RendererStateMessage} message 
   * @returns {Promise<void>} */
  async aupdate(message) {
    if (message.origin && message.origin !== this.docId) return;
    const [opts] = this.#updateOpts(null, null, message);
    const reqId = message.reqId;
    // Create a promise that will resolve when we get a response
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.#pendingResponses.delete(reqId);
        reject(new Error("Timeout waiting for response"));
      }, 5000); // the extension shouldn't perform any long running operations, 1 second should be 
                // more than enough, but we'll play it safe
      
      this.#pendingResponses.set(reqId, {resolve, reject, timeoutId});
      this.#render({...opts, reqId: reqId});
    });
  }
  
  /** Called from elsewhere in the webview or other renderers to handle direct updates
   * @param {RendererStateMessage} message 
   */
  update(message) {
    if (message.origin && message.origin !== this.docId) return;
    this.#render(...this.#updateOpts(null, null, message));
  }
  
  #render(opts={}, itemId, mime) {
    const msgType = opts.update ? MSG_TYPE[opts.update] : 'updateState';
    /** @type {RendererStateMessage} */
    const msg = { type: msgType, reqId: opts.id ?? kounter(), opts: this.opts, origin: this.docId };
    this.context.postMessage(msg);
    if (DEBUG) logAll(
        [`${Date.now()} render`],
        // [`output:`, itemId, mime],
        [`opts: ${JSON.stringify(opts)}`]
      );
  }

  /** 
   * @param {OutputItem?} outputItem
   * @param {HTMLElement?} element
   * @param {MIMEMessage?} opts
   * @returns {[Options, string?, string?]} */
  #updateOpts(outputItem, element, opts) {
    if (element && this.docId) this.docId = element.ownerDocument.location.href;
    if (outputItem) {
      opts = outputItem.json();
      const itemId = outputItem.id;
      if (itemId && !this.outputs.get(itemId)) this.addOutput({ el: element, itemId: itemId });
    }
    if (opts) {
      if (opts.debug !== undefined) DEBUG = opts.debug;
      Object.assign(this.opts, pickDefined(opts, ...Object.keys(this._defaultOpts)));
    }
    return [opts, outputItem?.id, outputItem?.mime];
  }

  /** Called by the editor to display our MIME output
   * @param {OutputItem} outputItem 
   * @param {HTMLElement} element
   */
  render(outputItem, element) {
    this.#render(...this.#updateOpts(outputItem, element));
  }

}

/** @param {RendererContext} context */
export function activate(context) {
  const renderer = new NBStateRenderer(context, globalThis.document.location.href);
  return {
    renderOutputItem: renderer.render.bind(renderer),
    disposeOutputItem: renderer.deleteOutput.bind(renderer),
    update: (msg) => renderer.update(msg),
    aupdate: async (msg) => renderer.update(msg),
    getNBState: () => renderer.getNBState()
  }
}

/** 
 * @typedef {import('vscode-notebook-renderer').RendererContext} RendererContext 
 * @typedef {import('vscode-notebook-renderer').OutputItem} OutputItem 
 */

/** 
 * @typedef {import('./types.js').NBData} NBData
 * @typedef {import('./types.js').StateMessage} StateMessage
 * @typedef {import('./types.js').DiffsMessage} DiffsMessage
 * @typedef {import('./types.js').RendererStateMessage} RendererStateMessage
 * @typedef {import('./types.js').RendererDeregisterMessage} RendererDeregisterMessage
 */

/**
 * @typedef {Object} Options
 * @property {boolean?} feedback - Show feedback so user can see changes
 * @property {boolean?} hide - Hide the output (renderer)
 * @property {boolean?} debug - Show debug messages
 */

/** 
 * @typedef {Object} MIMEMessage
 * @property {string} id - ID of the message
 * @property {'full'|'diff'|'opts'|null} update - full or diff update or only options, default is diff
 * @property {boolean?} feedback - Show feedback so user can see changes
 * @property {boolean?} hide - Hide the output (renderer)
 * @property {boolean?} debug - Show debug messages
 */

/** 
 * @typedef {Object} Output
 * @property {HTMLElement} el
 * @property {string} itemId
 * @property {boolean} active
 */
