// @ts-check
// bridge.js

// NOTE: `loadLink` uses `$E` from `fasthtml-js`, ensure it's loaded before, or use a different function.
// I like using fasthtml links in python, keep it here for now.

// ========== common/debug.js ==========

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

function basicFmt(ts, ns, color, msg) {
  return [`${ts}${ns?` ${ns}`:''} ${msg}\n`];
}

function htmlFmt(ts, ns, color, msg) {
  return [`<span class="ts">${ts}</span><span class="ns" style="color: ${color}">${ns?` ${ns}`:''}</span> ${msg}<br>`];
}

const FMTS = {
  consoleFmt,
  basicFmt,
  htmlFmt,
};


/**
 * @typedef {Object} DebugMessageConfig
 * @property {string} [color]
 * @property {string} [fmt]
 */

/**
 * @param {string} namespace 
 * @param {DebugMessageConfig} cfg 
 * @param {Function} sink 
 * @returns {Function}
 */
function debugFactory(namespace, cfg, sink, parent='brd') {
  let prevTime;
  function debug(...args) {
    if (!debugFactory.enabled || !debug.enabled) return;
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
    const parentDebug = debugFactory.nss.get(parent);
    const color = debug.cfg?.color  ?? parentDebug.cfg.color ?? selectColor(namespace);
    const fmt = FMTS[debug.cfg?.fmt ?? parentDebug.cfg.fmt] ?? FMTS.consoleFmt;
    (debug.sink ?? parentDebug.sink)(...fmt(ts, namespace, color, msg));
  }
  debug.useColors = true;
  debug.cfg = cfg;
  debug.sink = sink;// ?? defaultSink;
  debug.reset = () => {
    prevTime = 0;
    return debug;
  };
  debug.namespace = namespace;
  debugFactory.nss.set(namespace, debug);
  debug.enabled = true;
  return debug;
}

debugFactory.nss = new Map();
debugFactory.enable = (namespace, enabled=true) => {
  if (!namespace) {
    debugFactory.enabled = enabled;
    namespace = '*';
  }
  if (namespace.includes('*')) {
    const rx = new RegExp(`^${namespace.replace(/\*/g, '.*')}$`);
    for (const [ns, debugFn] of debugFactory.nss) if (rx.test(ns)) debugFn.enabled = enabled;
  } else {
    const debugFn = debugFactory.nss.get(namespace);
    if (debugFn) debugFn.enabled = enabled;
  }
}
debugFactory.enabled = true;
const debug = debugFactory;

const defaultSink = console.info.bind(console);

// ==================== load ====================

/**
 * @param {string} str
 * @returns {str is "https://${string}" | "http://${string}"}
 */
function isHref(str) {
  return str.startsWith("http://") || str.startsWith("https://");
}

/** Load an ESM module from href or inline string (data URL).
 * @param {string} esm - URL string or inline string
 * @returns {Promise<LoadResult>}
 */
async function loadESM(esm) {
  if (isHref(esm)) return { mod: await import(esm), url: esm };  // @transform: ignore
  const url = URL.createObjectURL(new Blob([esm], { type: "text/javascript" }));
  try { return { mod: await import(url), url }; }  // @transform: ignore
  finally { URL.revokeObjectURL(url); }
}

/** Load multiple ES modules sequentially
 * @param {Object.<string, string>} modules - URLs or inline module strings
 * @returns {Promise<{success: Array<{name: string, module: LoadResult}>, failed: Array<{name: string, error: string}>}>}
 */
async function loadESMs(modules, reload=false, cache=true) {
  const success = [], failed = [];
  for (const [name, esm] of Object.entries(modules)) {
    if (cache && bridge.import.isLoaded(name) && !reload) {
      success.push({ name, module: { mod: bridge.import.getModule(name), url: '' } });
      bridge.logger.log(`'${name}' already loaded`);
      continue;
    }
    try {
      const result = await bridge.loadESM(esm);
      success.push({ name, module: result });
      if (cache) bridge.import.setModule(name, result.mod);
    } catch (err) {
      failed.push({ name, error: err.message });
    }
  }
  return { success, failed };
}

/** Load a FastCore FTlink
 * @param {FTLink} link - fastcore FTlink
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
 * @returns {Promise<{success: Array<{name: string}>, failed: Array<{name: string, error: string}>}>}
 */
async function loadLinks(links) {
  const success = [], failed = [];
  for (const [name, link] of Object.entries(links)) {
    try {
      await bridge.loadLink(link, name);
      success.push({ name });
    } catch (err) {
      failed.push({ name, error: err.message });
    }
  }
  return { success, failed };
}

// Add some fasthtml-style aliases
globalThis.$L = loadLink;
globalThis.$Ls = loadLinks;

// ==================== bridge ====================

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

const uuid = _uuidGen();

/** Load plugins (as ES modules)
 * @param {Object.<string, string>} modules - Names to ES module source strings
 * @returns {Promise<{success: Array<{name: string}>, failed: Array<{name: string, error: string}>}>}
 */
async function loadPlugins(modules) {
  const { success, failed } = await bridge.loadESMs(modules, true);
  success.forEach(({ name, module }) => {
    bridge.addPlugin({ name, fn: module.mod?.default });
  });
  return { success, failed };
}

const msgHub = new Map();
let _model = null;
let _invoke = null;
const cleanupCbs = new Map();

function cleanup() {
  Array.from(cleanupCbs.values()).reverse().forEach(fn => fn());
  cleanupCbs.clear();
}

/** 
 * @param { {name: string, fn: Function}[]} plugins - Array of plugins to initialize
 */
function addPlugin(...plugins) {
  plugins.forEach(async ({name, fn}) => {
    try {
      if (cleanupCbs.has(name)) {
        cleanupCbs.get(name)();
        cleanupCbs.delete(name);
      }
      const res = fn ? await fn(bridge) ?? [] : [];
      const [cb, api={}] = res instanceof Function ? [res] : res;
      bridge[name] = {...api};
      if (cb) cleanupCbs.set(name, cb);
      bridge.logger.log(`'${name}' plugin initialized`);
      if (bridge.model) bridge.model.send({ ctx: name, kind: 'init', info: 'initialized' });
    } catch (err) {
      const errMsg = `Error initializing plugin '${name}': ${err}`;
      bridge.logger.error(errMsg);
      if (bridge.model) bridge.model.send({ ctx: name, kind: 'init', info: errMsg });
    }
  });
}

function handleMsg(msg) {
  const fn = msgHub.get(msg.ctx);
  if (fn) fn(msg);
}

/** @param {string} ctx @param {Function} fn */
function on(ctx, fn) {
  msgHub.set(ctx, fn);
  bridge.model?.send({ ctx: ctx, kind: 'info', info: 'model-set' });
  bridge.logger.log(`'${ctx}' connected!`);
}

/** @param {string} ctx */
function off(ctx) {
  msgHub.delete(ctx);
  bridge.model?.send({ ctx: ctx, kind: 'info', info: 'model-unset' });
  bridge.logger.log(`'${ctx}' disconnected!`);
}

async function getProp(ctx, name, timeout=50e3) {
  // return _invoke ? await _invoke('get_prop', { ctx, name }, {signal: AbortSignal.timeout(50e3)}) : undefined;
  const signal = AbortSignal.timeout(timeout);
  return _invoke('get_prop', { ctx, name }, { signal })
  .then(([value]) => {
    return value;
  })
  .catch((err) => {
    bridge.logger.error(`Error getting property '${name}' from '${ctx}': ${err.message}`);
    return undefined;
  });
}

/** @returns {import("@anywidget/types").AnyModel|undefined|null} */
function getModel() {
  return _model;
}

function closeModel() {
  if (_model) {
    try {
      cleanup();
      _model.off("msg:custom", handleMsg);
    } catch (err) {
      bridge.logger.error(`Error cleaning up bridge: ${err.message}`);
    }
    // model probably closed in python-land
    // _model.send({ ctx: _model.get('ctx_name'), kind: 'info', info: 'model-unset' });
    _model = null;
    _invoke = null;
    bridge.logger.log('Bridge closed.');
  }
}

/** @param {import("@anywidget/types").AnyModel|undefined|null} model*/
function setModel(model, invoke=null) {
  if (model) {
    closeModel();
    _model = model;
    _invoke = invoke;
    model.on("msg:custom", handleMsg);
    bridge.logger.log('Bridge opened.');
    addPlugin(...modelPlugins.map(name => ({ name, fn: defaultPlugins[name] })));
    return;
  }
  closeModel();
}

// ==================== plugins ====================

// ========== logging ==========

const LEVELS = {
  INFO: 'INFO',
  ERROR: 'ERROR',
};

const defaultConfig = {
  ns: 'brd',
  color: 'light-dark(gray, lightgray)',
  fmt: 'consoleFmt',
  tsDelta: true,
  INFO: {},
  ERROR: {
    color: 'red',
  },
  WARN: {
    color: 'LightSalmon',
  },
}

function createLogger(config, sink) {
  const ns = config.ns;
  const parent = this && (ns !== this.config.ns) ? this.config.ns : undefined;
  const lgr = {
    close: function close() {
      loggers.delete(ns);
      [this.log.namespace, this.error.namespace].forEach((ns) => debugFactory.nss.delete(ns));
    },
    update: function update(config, sink) {
      config = config ?? this.config;
      sink = sink ?? this.log?.sink;
      const cfg = {color:config?.INFO?.color ?? config?.color, fmt:config?.INFO?.fmt ?? config?.fmt};
      const cfgError = {color:config?.ERROR?.color ?? config?.color, fmt:config?.ERROR?.fmt ?? config?.fmt};
      const cfgWarn = {color:config?.WARN?.color ?? config?.color, fmt:config?.WARN?.fmt ?? config?.fmt};
      this.log = debug(cfg?.INFO?.ns || ns, cfg, sink, parent?.ns);
      this.error = debug(`${cfg?.ERROR?.ns || `${ns}:error`}`, cfgError, sink, parent?.ns);
      this.warn = debug(`${cfg?.WARN?.ns || `${ns}:warn`}`, cfgWarn, sink, parent?.ns);
      this.config = config;
    },
    create: createLogger,
    config:config,
    parent,
  };
  lgr.update(config, sink);
  loggers.set(ns, lgr);
  return lgr;
}

const loggers = new Map();
let logger = createLogger(defaultConfig, defaultSink);
const defaultLogger = logger;

// ========== bridge ==========

async function initializeBridge(bridge) {
  const ctx = bridge.model.get('ctx_name');

  async function onBridgeMsg(msg) {
    const txt = JSON.stringify(msg);
    bridge.logger.log(`new message: ${txt.slice(0, 100)}${txt.length>100?'...':''}`);
    const { cmd, args={}, msg_id } = msg;
    if (cmd === 'remove') {
      bridge.logger.log('Disconnecting Bridge...');
      // delete /** @type {Bridges} */ (globalThis.$Brds).bridge;
    } else if (cmd === 'echo') {
      bridge.logger.log('Echoing...');
      bridge.model.send({ ctx: ctx, kind: 'info', info: `echo: ${args}`, msg_id });
    } else if (cmd === 'debug') {
      bridge.logger.log(`Setting debug traces of ${args.debug_ctx} to ${args.enabled}`);
      debug.enable(args.debug_ctx || '*', args.enabled);
    }
  }

  bridge.on(ctx, onBridgeMsg);
  bridge.model.send({ ctx, kind: 'info', info: 'loaded' });
  return () => {
    bridge.off(ctx);
  }
}

// ========== loader ==========

async function initializeLoader(bridge) {
  const ctx = 'loader';
  const logger = bridge.logger.create({ ns: ctx, color: 'gold', ERROR: defaultConfig.ERROR, WARN: defaultConfig.WARN });
  
  const cmdMap = {
    'load': 'loadESMs',
    'loadLinks': 'loadLinks',
    'loadPlugins': 'loadPlugins',
  };

  async function onLoaderMsg(msg) {
    const txt = JSON.stringify(msg);
    logger.log(`new message: ${txt.slice(0, 100)}${txt.length>100?'...':''}`);
    const { cmd, args=[], reload=false, cache=true, msg_id } = msg;
    const fn = cmdMap[cmd];
    if (!fn || typeof bridge[fn] !== 'function') {
      logger.error(`Unknown command: ${cmd}`);
      bridge.model.send({ ctx, kind: 'error', error: `Unknown command: ${cmd}`, msg_id });
      return;
    }
    const { success, failed } = await bridge[fn](args, reload, cache);
    bridge.model.send({ ctx, kind: cmd, 
      success: success.map( ({ name }) => name), failed: failed, msg_id });
  }

  bridge.on(ctx, onLoaderMsg);
  return () => {
    bridge.off(ctx);
  }
}

// ========== htmx ==========

/** Process a node with htmx
 * @param {Element} el - element to process
 * @returns {Promise<void>}
 */
async function processNode(el) {
  if (!globalThis.htmx) return;
  globalThis.htmx.process(el);
  const s = el.outerHTML.slice(0, 100).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  bridge.logger.log(`Processed output node: <code>${s}${s.length>100?'...':''}</code>`);
}

async function initializeHTMX(bridge) {
  const ctx = 'htmx';
  
  /** Setup htmx
   * @param {string[]} sels - Array of selectors
   * @returns {Promise<htmx|undefined>}
   */
  async function htmxSetup(sels=[], url='https://cdn.jsdelivr.net/npm/htmx.org@2.0.6/dist/htmx.esm.js') {
    if (!globalThis.htmx) {
      const { default: htmx } = await import(url);
      globalThis.htmx = htmx;
      bridge.htmx.loaded = true;
      bridge.logger.log('HTMX loaded');
    }
    const htmx = globalThis.htmx;
    if (htmx) {
      htmx.config.selfRequestsOnly = false;
      for (const sel of sels) {
        document.querySelectorAll(sel).forEach(async el => await processNode(el));
      }
    }
    return htmx;
  }

  async function onHTMXMsg(msg) {
    const { cmd, args=[], msg_id } = msg;
    if (cmd === 'setup') {
      await htmxSetup(...args);
      bridge.model.send({ ctx, kind: 'info', info: 'setup', msg_id });
    }
  }

  bridge.on(ctx, onHTMXMsg);
  return [  // return cleanup fn and API object
    () => { bridge.off(ctx); },
    { setup: htmxSetup, loaded: false, processNode },
  ];
}

// ========== fasthtmljs ==========

async function fasthtmljsSetup() {
  const url = 'https://cdn.jsdelivr.net/gh/answerdotai/fasthtml-js@1.0.12/fasthtml.js';
  await bridge.loadLink(["script", [], { src: url }], 'fasthtmljs');
}

const modelPlugins = [  // associated with the widget model (i.e., send/receive kernel msgs)
  'brd',
  'loader',
  'htmx'
];

const defaultPlugins = { 
  logging: null,
  brd: initializeBridge,
  htmx: initializeHTMX,
  fasthtmljs: fasthtmljsSetup,
  loader: initializeLoader,
};


// ==================== public API ====================

const bridge = {
  uuid,
  // is_href,
  get logger() { return logger },
  set logger(lgr) { logger = lgr ?? defaultLogger },
  loadESM,
  loadESMs,
  loadLink,
  loadLinks,
  // @ts-ignore
  import: brdimport,
  loadPlugins,
  addPlugin,
  get model() { return _model },
  get invoke() { return _invoke },
  setModel,
  on,
  off,
  get: async (ctx, name) => getProp(ctx, name),
  // ===== plugins
  logging: { 
    loaded: true, 
    debug,
    // FMTS,
    createLogger,
    get logger() { return logger },
    resetLogger() { logger = defaultLogger },
    get loggers() { return loggers },
  },
}

// ==================== setup ====================

bridge.addPlugin(
  { name: 'fasthtmljs', fn: fasthtmljsSetup },  // Warning: this'll hit `jsdelivr`, can be slow
                                                // but possibly python-land needs to load stuff inmediately;
                                                // consider getting rid of fasthtmljs dependency (only use $E)
);  

// ==================== globals ====================

// /** @type {Bridges} */ (globalThis.$Brds) ??=  {};
// globalThis.$Brds.bridge = bridge;
globalThis.bridge = bridge;
// globalThis.htmxSetup = htmxSetup;


async function initBridge(model, invoke) {
  // As the bridge maintains state, if there's a prev model, we skip the new model altogether. 
  // This probably means python-bridge hasn't closed the bridge properly or some other weird error.
  if (bridge.model) {
    bridge.logger.error('Bridge already initialized. Try to close the existing bridge first.');
    bridge.setModel(null);
  }
  const { bcanvas } = await globalThis.brdimport('./bcanvas.js');
  // /** @type {Bridges} */ (globalThis.$Brds).bcanvas?.setupLoggers(model.get('logger_config'));
  bcanvas.setupLoggers(model.get('logger_config'));
  bridge.setModel(model, invoke);
  model.on('change:logger_config', () => bcanvas.updateConfig(model.get('logger_config')));
  return () => bridge.setModel(null);
}

// export { bridge, brdimport, initBridge };
export { bridge, initBridge };

/**
 * @typedef Bridges - anywidget model holders
 * @prop {Object} [bridge] - the bridge object
 * @prop {Object} [bcanvas] - the bridge canvas object (mainly for logging)
 */

// /**
//  * @typedef Model
//  * @prop {string} ctx_name - the name of the context
//  */

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
