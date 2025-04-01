// import { debug } from '../../packages/nbinspect-vscode/src/debug.mjs';

// use fasthtml-js

if (!window.$Brd) {
  
  window.$Brd = (function () { 
    'use strict';

    /** 
     * @typedef {string} TagName - HTML element tag name
     * @typedef {Object} Attributes - HTML element attributes
     * @typedef {string|Node|FTLink} Child
     * @typedef {Child|Array<Child>} Children */

    /** FastCore XML object representation
     * @typedef {[TagName, Children?, Attributes?]} FTLink
     * @description Array format from FastCore's FT (XML) object:
     * - Position 0: Tag name (e.g., 'script', 'link', 'style')
     * - Position 1: Single Child or array of Children (optional)
     * - Position 2: Attributes object (optional, default {})
     */

    /** Map of FastCore links
     * @typedef {Object.<string, FTLink>} FTLinks
     */

    /**
     * @typedef {Object} ESModule
     * @property {*} [default] - Default export
     * @property {Object.<string, *>} - Named exports
     */

    /**
     * @typedef {Object} LoadResult
     * @property {ESModule} mod
     * @property {string} url
     */

    const logger = {
      log: debug('brd'),
      error: debug('brd:error'),
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
    
    const uuid = _uuidGen();

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
     * @returns {Promise<{success: Array<{name: string}>, failed: Array<{name: string, error: string}>}>}
     */
    async function loadESMs(modules) {
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
    async function loadLink([tag, children=[], attrs={}], name='') {
      const doc = document;
      name = name || attrs.id || attrs.src;
      if (
        (attrs.id && doc.querySelector(`#${attrs.id}`)) ||
        (tag === "script" && attrs.src && doc.querySelector(`script[src="${attrs.src}"]`))
      ) {
          logger.log(`${tag} "${name}" already loaded`);
          return;
      }
      const txt = children.filter(Boolean).reduce((acc, child) => 
        acc + (typeof child === 'string' ? child : ''), '');
      const el = window.$E 
          ? $E(tag, attrs, children)
          : Object.assign(doc.createElement(tag), attrs, {textContent: txt});
      if (tag === "script") {
        if (attrs.src) {
          await new Promise((resolve, reject) => {
            el.onload = () => {
              logger.log(`Loaded "${name}" script: ${attrs.src}`);
              resolve();
            };
            el.onerror = (err) => {
              const e = new Error(`Failed to load script "${name}": ${e}`);
              logger.error(e);
              reject(e);
            };
            doc.head.appendChild(el);
          });
        } else { // Inline script
          await new Promise((resolve, reject) => {
            const prevHandler = window.onerror;
            window.onerror = (msg, url, lineNo, columnNo, error) => {
              window.onerror = prevHandler;
              logger.error(`Error in inline script "${name}":`, msg);
              doc.head.removeChild(el);
              reject(error || new Error(msg));
              return true;  // prevent the error from showing in console
            };
            doc.head.appendChild(el);
            // Give it a tick to execute and potentially error
            setTimeout(() => {
              window.onerror = prevHandler;
              resolve();
            }, 0);
        });
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
          await loadLink(link, name);
          success.push(name);
        } catch (err) {
          failed.push({ name, error: err.message });
        }
      }
      return { success, failed };
    }

    function processNode(n) {
      if (!window.htmx) return;
      // n.setAttribute('ready', '');  // mark for observation, Faster than walking MutationObserver 
      //                               // results when receiving subtree (DOM swap, htmx, ajax, jquery).
      htmx.process(n);
      logger.log('Processed output node', n);
    }
    
    async function htmxSetup(sels) {
      if (!window.htmx) {
          const { default: htmx } = await import('https://cdn.jsdelivr.net/npm/htmx.org@2.0.3/dist/htmx.esm.js');
          window.htmx = htmx;
      }
      if (window.htmx) {
          htmx.config.selfRequestsOnly = false;
          for (const sel of sels) {
              document.querySelectorAll(sel).forEach(el => processNode(el));
          }
      }
      return htmx;
    }
    
    return {
      debug,
      logger,
      uuid,
      is_href,
      loadESM,
      loadESMs,
      loadLink,
      loadLinks,
      processNode,
      htmxSetup
    };
        
  })();

  // Add fasthtml-style aliases
  window.$L = $Brd.loadLink;
  window.$Ls = $Brd.loadLinks;
  window.htmxSetup = $Brd.htmxSetup;

}
