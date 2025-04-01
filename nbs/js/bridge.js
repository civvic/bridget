// @ts-check

// NOTE: `loadLink` uses `$E` from `fasthtml-js`, ensure it's loaded before us, or use a different function.
// But as I like using fasthtml links in python, keeping it here for now.

const bridge = globalThis.$Brd || (function() {
  'use strict'

  // const colors = [6, 2, 3, 4, 5, 1];
  const colors = [
    '#0000CC','#0000FF','#0033CC','#0033FF','#0066CC','#0066FF','#0099CC','#0099FF',
    '#00CC00','#00CC33','#00CC66','#00CC99','#00CCCC','#00CCFF','#3300CC','#3300FF',
    '#3333CC','#3333FF','#3366CC','#3366FF','#3399CC','#3399FF','#33CC00','#33CC33',
    '#33CC66','#33CC99','#33CCCC','#33CCFF','#6600CC','#6600FF','#6633CC','#6633FF',
    '#66CC00','#66CC33','#9900CC','#9900FF','#9933CC','#9933FF','#99CC00','#99CC33',
    '#CC0000','#CC0033','#CC0066','#CC0099','#CC00CC','#CC00FF','#CC3300','#CC3333',
    '#CC3366','#CC3399','#CC33CC','#CC33FF','#CC6600','#CC6633','#CC9900','#CC9933',
    '#CCCC00','#CCCC33','#FF0000','#FF0033','#FF0066','#FF0099','#FF00CC','#FF00FF',
    '#FF3300','#FF3333','#FF3366','#FF3399','#FF33CC','#FF33FF','#FF6600','#FF6633',
    '#FF9900','#FF9933','#FFCC00','#FFCC33'
  ];

  function selectColor(namespace) {
    let hash = 0;
    for (let i = 0; i < namespace.length; i++) {
      hash = ((hash << 5) - hash) + namespace.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return colors[Math.abs(hash) % colors.length];
  }

  function consoleFmt(ts, ns, color, msg) {
    // console.log(`%c${curr}${ns} %s`, `color: #${debug.color.toString(16).padStart(6, '0')}`, msg);
    return [`%c${ts}${ns?` ${ns}`:''} \x1B[1;94m${msg}\x1B[m`, `color: ${color}`];
  }

  function debugFactory(namespace, color, fmt, sink) {
    let prevTime;
    function debug(...args) {
      if (!debugFactory.enabled) return;
      const curr = Number(new Date());
      const ms = curr - (prevTime || curr);
      // @ts-ignore
      debug.diff = ms, debug.prev = prevTime, debug.curr = curr, prevTime = curr;
      const msg = args.reduce((acc, arg) => {
        if (typeof arg === "string") return acc + (acc.length > 0 ? " " : "") + arg;
        return acc + (acc.length > 0 ? ' ' : '') + JSON.stringify(arg);
      }, '');
      // @ts-ignore
      const ts = (debug.prev && ms < 1000 ? `+${ms}` : `${curr}`).padStart(13, '\u00A0');
      debug.sink(...debug.fmt(ts, namespace, debug.color, msg));
    }
    debug.enabled = true;
    debug.namespace = namespace;
    debug.useColors = true;
    debug.color = color ?? selectColor(namespace);
    debug.sink = sink ?? defaultSink;
    debug.fmt = fmt ?? consoleFmt;
    debug.reset = () => {
      prevTime = 0;
      return debug;
    };
    return debug;
  }

  debugFactory.nss = new Map([['brd', {}]]);
  debugFactory.enable = (namespace) => { debugFactory.enabled = true; }
  debugFactory.disable = () => { debugFactory.enabled = false; }
  debugFactory.enabled = true;
  const debug = debugFactory;

  const defaultSink = console.info.bind(console);
  // const defaultLogger = {
  //   log: debug('brd', 'light-dark(gray, lightgray)'),
  //   error: debug('brd:error', 'red'),
  // };

  const defaultConfig = {
    ns: 'brd',
    color: 'light-dark(gray, lightgray)',
    fmt: 'consoleFmt',
    tsDelta: true,
    INFO: {
      level: 'INFO',
    },
    ERROR: {
      level: 'ERROR',
      color: 'red',
    },
  }

  const FMTS = {
    consoleFmt,
  };
  
  const LEVELS = {
    INFO: 'INFO',
    ERROR: 'ERROR',
  };
  
  function createLogger(config, sink) {
    const cfg = this?.cfg || {};
    Object.entries(config).forEach(([key, value]) => {
      cfg[key] = key in LEVELS ? { ...cfg[key], ...value } : value;
    });
    sink = sink ?? this?.sink;
    const lgr = {
      log: debug(cfg.INFO?.ns || cfg.ns, cfg.INFO?.color || cfg.color, FMTS[cfg.INFO?.fmt || cfg.fmt], sink),
      error: debug(`${cfg.ERROR?.ns || `${cfg.ns}:error`}`, 
        cfg.ERROR?.color || cfg.color, FMTS[cfg.ERROR?.fmt || cfg.fmt], sink),
      cfg,
      sink,
      FMTS,
    };
    lgr.config = createLogger.bind(lgr);
    return lgr;
  }

  let logger = createLogger(defaultConfig, defaultSink);
  const defaultLogger = logger;

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
  
  const uuid = _uuidGen()();

  /**
   * @param {string} str
   * @returns {str is "https://${string}" | "http://${string}"}
   */
  function is_href(str) {
    return str.startsWith("http://") || str.startsWith("https://");
  }
  
  /** Load an ESM module from href or inline string (data URL).
   * @param {string} esm - URL string or inline string
   * @returns {Promise<LoadResult>}
   */
  async function loadESM(esm) {
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
  async function loadESMs(modules) {
    const success = [], failed = [];
    for (const [name, esm] of Object.entries(modules)) {
      try {
        const result = await bridge.loadESM(esm);
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
  async function loadLink(link, name='') {
    const [tag, children=[], attrs={}] = link;
    const doc = document;
    name = attrs.id || attrs.src || name;
    if (
      (attrs.id && doc.querySelector(`#${attrs.id}`)) ||
      (tag === "script" && attrs.src && doc.querySelector(`script[src="${attrs.src}"]`))
    ) {
        bridge.logger.log(`${tag} "${name}" already loaded`);
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
            bridge.logger.log(`Loaded "${name}" script: ${attrs.src}`);
            resolve();
          };
          el.onerror = (err) => {
            const e = new Error(`Failed to load script "${name}": ${err}`);
            bridge.logger.error(e);
            reject(e);
          };
          doc.head.appendChild(el);
        }));
      } else { // Inline script
        await /** @type {Promise<void>} */(new Promise((resolve, reject) => {
          const prevHandler = window.onerror;
          window.onerror = (msg, url, lineNo, columnNo, error) => {
            window.onerror = prevHandler;
            bridge.logger.error(`Error in inline script "${name}":`, msg);
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
  async function loadLinks(links) {
    const success = [], failed = [];
    for (const [name, link] of Object.entries(links)) {
      try {
        await bridge.loadLink(link, name);
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
  async function processNode(n) {
    if (!globalThis.htmx) return;
    // n.setAttribute('ready', '');  // mark for observation, Faster than walking MutationObserver 
    //                               // results when receiving subtree (DOM swap, htmx, ajax, jquery).
    globalThis.htmx.process(n);
    bridge.logger.log('Processed output node', n);
  }
  
  /** Setup htmx
   * @param {string[]} sels - Array of selectors
   * @returns {Promise<htmx|undefined>}
   */
  async function htmxSetup(sels) {
    let htmx = globalThis.htmx;
    if (!htmx) {
      // @ts-ignore
      const { default: htmx } = await import('https://cdn.jsdelivr.net/npm/htmx.org@2.0.3/dist/htmx.esm.js');
      globalThis.htmx = htmx;
      bridge.loaded.htmx = true;
      bridge.logger.log('HTMX loaded');
    }
    if (htmx) {
      htmx.config.selfRequestsOnly = false;
      for (const sel of sels) {
        document.querySelectorAll(sel).forEach(el => bridge.processNode(el));
      }
    }
    return htmx;
  }

  async function fasthtmljsSetup() {
    const url = 'https://cdn.jsdelivr.net/gh/answerdotai/fasthtml-js@1.0.12/fasthtml.js';
    bridge.loadLink(["script", [], { src: url }], 'fasthtmljs')
    .then(() => { bridge.loaded.fasthtmljs = true; })
    .catch(err => { bridge.loaded.fasthtmljs = false; });
  }
  
  const msgHub = new Map();
  let _model = undefined;
  const cleanupCbs = [];

  function handleMsg(msg) {
    const fn = msgHub.get(msg.ctx);
    if (fn) fn(msg);
  }

  /** @param {string} ctx @param {Function} fn */
  function on(ctx, fn) {
    msgHub.set(ctx, fn);
  }
  
  /** @param {string} ctx */
  function off(ctx) {
    msgHub.delete(ctx);
  }
  
  function cleanup() {
    cleanupCbs.forEach(fn => fn());
    cleanupCbs.length = 0;
  }

  /** 
   * @param {Function[]} plugins - Array of plugins to initialize
   */
  function addPlugin(...plugins) {
    cleanupCbs.push(...plugins.map(plugin => plugin(bridge.model)));
  }

  /** @returns {import("@anywidget/types").AnyModel<Model>|undefined} */
  function getModel() {
    return _model;
  }

  /** @param {import("@anywidget/types").AnyModel<Model>|undefined} model*/
  function setModel(model) {
    if (model) {
      if (_model) {
        _model.off("msg:custom", handleMsg);
        bridge.logger.log('Bridge closed.');
      }
      _model = model;
      model.on("msg:custom", handleMsg);
      model.send({ ctx: model.get('ctx_name'), kind: 'info', info: 'model-setup' });
      bridge.logger.log('Bridge opened.');
      return;
    }
    if (_model) {
      _model.off("msg:custom", handleMsg); 
      bridge.logger.log('Bridge closed.');
      // model probably closed in python-land
      // _model.send({ ctx: _model.get('ctx_name'), kind: 'info', info: 'model-unset' });
      _model = null;
    }
    cleanup();
  }

  const bridge = {
    debug,
    get logger() { return logger },
    set logger(lgr) { logger = lgr ?? defaultLogger },
    uuid,
    is_href,
    loadESM,
    loadESMs,
    loadLink,
    loadLinks,
    processNode,
    htmxSetup,
    loaded: { fasthtmljs: false, htmx: false },
    get model() { return getModel() },
    set model(model) { setModel(model) },
    on,
    off,
  }
  
  setTimeout(() => {
    fasthtmljsSetup();
    // htmxSetup(['body']);
  }, 0.1);

  // @ts-ignore
  if (!globalThis.bridge) globalThis.bridge = bridge;
  // Add some fasthtml-style aliases
  globalThis.$Brd = bridge;
  globalThis.$L = bridge.loadLink;
  globalThis.$Ls = bridge.loadLinks;
  globalThis.htmxSetup = bridge.htmxSetup;

  return /** @type {any} */ (bridge);
})()

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

export { bridge };
