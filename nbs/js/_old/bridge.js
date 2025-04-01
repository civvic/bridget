

// Some utils used by Bridget.
// Global `window.$Brd` holds an instance of Bridge; though is supposed to be a singleton, it's not enforced.

import { debug } from '../../packages/nbinspect-vscode/src/debug.mjs';

// If need to use fasthtml-js, you can load it in JS- or Python-land:
// loadESM('https://cdn.jsdelivr.net/gh/answerdotai/fasthtml-js@1.0.12/fasthtml.js');

function _uuidGen() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return () => crypto.randomUUID();
  }
  // Fallback for older environments
  return () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  // return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

/**
 * @param {string} str
 * @returns {str is "https://${string}" | "http://${string}"}
 */
function is_href(str) {
  return str.startsWith("http://") || str.startsWith("https://");
}

export class Bridge {
  static debug = debug;
  static defaultLogger = {
    log: debug('brd'),
    error: debug('brd:error'),
  };
  constructor() {
    this.logger = Bridge.defaultLogger;
    this.uuid = _uuidGen()();
    /** @type {Map<string, Function>} */
    this.msgHub = new Map();
    this._model = undefined;
  }

  /** Load an ESM module from href or inline string (data URL).
   * @param {string} esm - URL string or inline string
   * @returns {Promise<LoadResult>}
   */
  async loadESM(esm) {
    if (is_href(esm)) {
      return {
        mod: await import(/* webpackIgnore: true */ esm),
        url: esm,
      };
    }
    const url = URL.createObjectURL(new Blob([esm], { type: "text/javascript" }));
    try {
      const mod = await import(/* webpackIgnore: true */ url);
      return { mod, url };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Load multiple ES modules sequentially
   * @param {Object.<string, string>} modules - URLs or inline module strings
   * @returns {Promise<{success: Array<string>, failed: Array<{name: string, error: string}>}>}
   */
  async loadESMs(modules) {
    const success = [], failed = [];
    for (const [name, esm] of Object.entries(modules)) {
      try {
        const result = await this.loadESM(esm);
        success.push(name);
      } catch (err) {
        failed.push({ name, error: err.message });
      }
    }
    return { success, failed };
  }

  /** Load a FastCore FTlink
   * @param {FTLink} link - FastCore FTlink
   * @param {string} [name] - Name of the link
   * @returns {Promise<void>}
   */
  async loadLink(link, name='') {
    const [tag, children=[], attrs={}] = link;
    const doc = document;
    name = attrs.id || attrs.src || name;
    if (
      (attrs.id && doc.querySelector(`#${attrs.id}`)) ||
      (tag === "script" && attrs.src && doc.querySelector(`script[src="${attrs.src}"]`))
    ) {
        this.logger.log(`${tag} "${name}" already loaded`);
        return;
    }
    const txt = children.filter(Boolean).reduce((acc, child) => 
      acc + (typeof child === 'string' ? child : ''), '');
    const el = globalThis.$E 
        ? globalThis.$E(tag, attrs, children)
        : Object.assign(doc.createElement(tag), attrs, {textContent: txt});
    if (tag === "script") {
      if (attrs.src) {
        await /** @type {Promise<void>} */(new Promise((resolve, reject) => {
          el.onload = () => {
            this.logger.log(`Loaded "${name}" script: ${attrs.src}`);
            resolve();
          };
          el.onerror = (err) => {
            const e = new Error(`Failed to load script "${name}": ${err}`);
            this.logger.error(e);
            reject(e);
          };
          doc.head.appendChild(el);
        }));
      } else { // Inline script
        await /** @type {Promise<void>} */(new Promise((resolve, reject) => {
          const prevHandler = window.onerror;
          window.onerror = (msg, url, lineNo, columnNo, error) => {
            window.onerror = prevHandler;
            this.logger.error(`Error in inline script "${name}":`, msg);
            doc.head.removeChild(el);
            reject(error || (typeof msg === 'string' ? new Error(msg) : msg));
            return true;  // prevent the error from showing in console
          };
          doc.head.appendChild(el);
          // Give it a tick to execute and potentially error
          setTimeout(() => {
            window.onerror = prevHandler;
            resolve();
          }, 0);
        }));
      }
    } else {
      doc.head.appendChild(el);
    }
  }

  /** Add FastCore FTlinks to loading queue and start processing
   * @param {Object.<string, FTLink>} links - Object of names to FastCore link definitions
   * @returns {Promise<{success: Array<string>, failed: Array<{name: string, error: string}>}>}
   */
  async loadLinks(links) {
    const success = [], failed = [];
    for (const [name, link] of Object.entries(links)) {
      try {
        await this.loadLink(link, name);
        success.push(name);
      } catch (err) {
        failed.push({ name, error: err.message });
      }
    }
    return { success, failed };
  }

  /** Process a node with htmx
   * @param {Node} n - Node to process
   * @returns {Promise<void>}
   */
  async processNode(n) {
    if (!globalThis.htmx) return;
    // n.setAttribute('ready', '');  // mark for observation, Faster than walking MutationObserver 
    //                               // results when receiving subtree (DOM swap, htmx, ajax, jquery).
    globalThis.htmx.process(n);
    this.logger.log('Processed output node', n);
  }
  
  /** Setup htmx
   * @param {string[]} sels - Array of selectors
   * @returns {Promise<htmx|undefined>}
   */
  async htmxSetup(sels) {
    let htmx = globalThis.htmx;
    if (!htmx) {
        // @ts-ignore
        const { default: htmx } = await import('https://cdn.jsdelivr.net/npm/htmx.org@2.0.3/dist/htmx.esm.js');
        globalThis.htmx = htmx;
    }
    if (htmx) {
        htmx.config.selfRequestsOnly = false;
        for (const sel of sels) {
            document.querySelectorAll(sel).forEach(el => this.processNode(el));
        }
    }
    return htmx;
  }

  handleMsg(msg) {
    const fn = this.msgHub.get(msg.ctx);
    if (fn) fn(msg);
  }

  /** 
   * @param {import("@anywidget/types").AnyModel<Model>} model 
   * @param {Function[]} plugins - Array of plugins to initialize
   * @returns {Function} - Cleanup function
   */
  initBridge(model, ...plugins) {
    this.model = model;
    this.logger.log('Bridge initialized.');
    model.send({ ctx: model.get('ctx_name'), kind: 'info', info: 'initialized' });
    const cleanupCbs = plugins.map(plugin => plugin(model));
    return () => {
      cleanupCbs.forEach(fn => fn());
      this.cleanup();
      this.logger.log('Bridge cleanup.');
    }
  }

  /** @returns {import("@anywidget/types").AnyModel<Model>|undefined} */
  get model() {
    return this._model;
  }

  /** @param {import("@anywidget/types").AnyModel<Model>|undefined} model*/
  set model(model) {
    if (this._model) this._model.off("msg:custom", this.handleMsg.bind(this));
    this._model = model;
    if (model) model.on("msg:custom", this.handleMsg.bind(this));
  }

  cleanup() {
    // return () => { 
    //   cleanup.forEach(fn => fn());
    this.model = undefined;
  }

  /** @param {string} ctx @param {Function} fn */
  on(ctx, fn) {
    this.msgHub.set(ctx, fn);
  }
  
  /** @param {string} ctx */
  off(ctx) {
    this.msgHub.delete(ctx);
  }
  
}

export const bridge = new Bridge();
globalThis.$Brd = bridge;

// Add fasthtml-style aliases
globalThis.$L = bridge.loadLink.bind(bridge);
globalThis.$Ls = bridge.loadLinks.bind(bridge);
globalThis.htmxSetup = bridge.htmxSetup.bind(bridge);

/**
 * @typedef Model
 * @prop {string} ctx_name - the name of the context
 */

/** 
 * @typedef {string} TagName - HTML element tag name
 * @typedef {Object} Attributes - HTML element attributes
 * @typedef {string|Node|FTLink} Child
 * @typedef {Array<Child>} Children */

/** FastCore XML object representation
 * @typedef {[TagName, Children?, Attributes?]} FTLink
 * @description Array format from FastCore's FT (XML) object:
 * - Position 0: Tag name (e.g., 'script', 'link', 'style')
 * - Position 1: array of Children (optional)
 * - Position 2: Attributes object (optional)
 */

/** Map of FastCore links
 * @typedef {Object.<string, FTLink>} FTLinks
 */

/**
 * @typedef {Object} ESModule
 * @property {*} [default] - Default export
 * @property {Object.<string, *>} namedExports - Named exports
 */

/**
 * @typedef {Object} LoadResult
 * @property {ESModule} mod
 * @property {string} url
 */
