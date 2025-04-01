// @ts-check

let logger = {
  log: (...o) => console.log(...o),
  error: (...o) => console.error(...o),
};

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

export const uuid = _uuidGen()()

/**
 * @param {string} str
 * @returns {str is "https://${string}" | "http://${string}"}
 */
export function is_href(str) {
  return str.startsWith("http://") || str.startsWith("https://");
}

/** Load an ESM module from href or inline string (data URL).
 * @param {string} esm - URL string or inline string
 * @returns {Promise<LoadResult>}
 */
export async function loadESM(esm) {
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
export async function loadESMs(modules) {
  const success = [], failed = [];
  for (const [name, esm] of Object.entries(modules)) {
    try {
      const result = await loadESM(esm);
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
export async function loadLink(link, name='') {
  const [tag, children=[], attrs={}] = link;
  const doc = document;
  name = attrs.id || attrs.src || name;
  if (
    (attrs.id && doc.querySelector(`#${attrs.id}`)) ||
    (tag === "script" && attrs.src && doc.querySelector(`script[src="${attrs.src}"]`))
  ) {
      logger.log(`${tag} "${name}" already loaded`);
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
          logger.log(`Loaded "${name}" script: ${attrs.src}`);
          resolve();
        };
        el.onerror = (err) => {
          const e = new Error(`Failed to load script "${name}": ${err}`);
          logger.error(e);
          reject(e);
        };
        doc.head.appendChild(el);
      }));
    } else { // Inline script
      await /** @type {Promise<void>} */(new Promise((resolve, reject) => {
        const prevHandler = window.onerror;
        window.onerror = (msg, url, lineNo, columnNo, error) => {
          window.onerror = prevHandler;
          logger.error(`Error in inline script "${name}":`, msg);
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
export async function loadLinks(links) {
  const success = [], failed = [];
  for (const [name, link] of Object.entries(links)) {
    try {
      await loadLink(link, name);
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
export async function processNode(n) {
  if (!globalThis.htmx) return;
  // n.setAttribute('ready', '');  // mark for observation, Faster than walking MutationObserver 
  //                               // results when receiving subtree (DOM swap, htmx, ajax, jquery).
  globalThis.htmx.process(n);
  logger.log('Processed output node', n);
}

/** Setup htmx
 * @param {string[]} sels - Array of selectors
 * @returns {Promise<htmx|undefined>}
 */
export async function htmxSetup(sels) {
  let htmx = globalThis.htmx;
  if (!htmx) {
      // @ts-ignore
      const { default: htmx } = await import('https://cdn.jsdelivr.net/npm/htmx.org@2.0.3/dist/htmx.esm.js');
      globalThis.htmx = htmx;
  }
  if (htmx) {
      htmx.config.selfRequestsOnly = false;
      for (const sel of sels) {
          document.querySelectorAll(sel).forEach(el => processNode(el));
      }
  }
  return htmx;
}

// Add fasthtml-style aliases
globalThis.$L = loadLink;
globalThis.$Ls = loadLinks;
globalThis.htmxSetup = htmxSetup;

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
