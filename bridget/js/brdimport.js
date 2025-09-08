// @ts-check
// js/brdimport.js

const brdimport = globalThis.brdimport || (function() {
'use strict'

/**
 * @param {string} str
 * @returns {str is "https://${string}" | "http://${string}"}
 */
function isHref(str) {
  return str.startsWith("http://") || str.startsWith("https://");
}

/** Load an ESM module.
 * @param {string} esm - URL string or inline JS string
 * @returns {Promise<LoadResult>}
 */
async function loadESM(esm) {
  if (isHref(esm)) return { mod: await import(esm), url: esm };  // @transform: ignore
  const url = URL.createObjectURL(new Blob([esm], { type: "text/javascript" }));
  try { return { mod: await import(url), url }; }  // @transform: ignore
  finally { URL.revokeObjectURL(url); }
}

/** @type {Record<string, ESModule>} */
const __modules = {};
let _invoke = null;
let logger = console;

/** @param {string} moduleName */
async function brdimport(moduleName, options) {
  if (__modules[moduleName]) return __modules[moduleName];
  if (logger === console && __modules['./bridge.js']) logger = __modules['./bridge.js']['bridge'].logger;
  let resolved = null, src = null, err = null;
  try {
    try {
      resolved = import.meta.resolve(moduleName);
      logger.log(`resolved: ${resolved}`);
    } catch (e) { logger.warn(`'import.meta.resolve' failed: ${e}`); }
    if (resolved) {
      const result = await loadESM(resolved);
      return result.mod;
    } else if (_invoke) {
      [src] = await _invoke("get_module", moduleName, {signal: AbortSignal.timeout(50e3)});
      logger.log(`src: ${src.slice(0, 100)}${src.length>100?'...':''}`);
      const result = await loadESM(src);
      __modules[moduleName] = result.mod;
      return result.mod;
    }
  } catch (e) { err = e; }
  if (!err) err = new TypeError(`Failed to fetch dynamically imported module: '${moduleName}'`);
  // logger.error(`brdimport failed: ${err}`);
  throw err;
}

brdimport.unload = (moduleName) => {
  delete __modules[moduleName];
};

brdimport.isLoaded = (moduleName) => {
  return __modules[moduleName] !== undefined;
};

brdimport.modules = () => {
  return Object.keys(__modules);
};

brdimport.setModule = (moduleName, mod) => {
  __modules[moduleName] = mod;
};

brdimport.getModule = (moduleName) => {
  return __modules[moduleName];
};

brdimport.init = (model, invoke, options) => {
  try {
    _invoke = invoke;
    globalThis.brdimport = brdimport;
    model.set('_loaded', true); model.save_changes();
    // model.on('change:_loaded', () => {
    //   if (!model.get('_loaded')) {
    //     _invoke = null;
    //   }
    // })
    return () => {
      _invoke = null;
      // model.off('change:_loaded');
      model.set('_loaded', false); model.save_changes();
    };
  } catch (e) {
    console.error('Error initializing brdimport', e);
  }
}

return brdimport;

})();

export { brdimport };

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
