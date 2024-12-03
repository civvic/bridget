// COMMANDER -----------------------------------------------------------------------------
function processNode(n) {
  if (!window.htmx) return;
  // n.setAttribute('ready', '');  // mark for observation, Faster than walking MutationObserver 
  //                               // results when receiving subtree (DOM swap, htmx, ajax, jquery).
  htmx.process(n);
  // console.log('Processed output cell', n.outerHTML);
  console.log('Processed output node', n);
}

async function htmxSetup(sels) {
  // if (!window.proc_htmx) await import('https://cdn.jsdelivr.net/gh/answerdotai/fasthtml-js@1.0.4/fasthtml.js');
  if (!window.htmx) {
      const { default: htmx } = await import('https://cdn.jsdelivr.net/npm/htmx.org@2.0.3/dist/htmx.esm.js');
      window.htmx = htmx;
  }
  if (window.htmx) {
      htmx.config.selfRequestsOnly = false;
      for (const sel of sels) {
          // htmx.process(globalThis.document.body);
          // Process only output cells.
          document.querySelectorAll(sel).forEach(el => processNode(el));
      }
  }
  return htmx;
}

function initializeObserver(sels) {
  if (!window.bridgetObserver) {
      console.log('bridgetObserver not found, creating');
      window.bridgetObserver ??= new MutationObserver(recs => { // Allow 1 observer.
          // console.log('MutationObserver triggered, records', recs.length);
          for (const r of recs) {
              if (r.addedNodes.length < 1 || !sels.some(sel => r.target.matches(sel))) continue;
              // console.log('record', r);
              for (const n of r.addedNodes) {
                  if (n.nodeType === 1) requestAnimationFrame(() => processNode(n))
              }
          }
      });
      window.bridgetObserver.observe(document.body, {childList: true, subtree: true});
  } else {
      console.log('bridgetObserver already exists, skipping');
  }
}

function on_msg(msg) {
  // debugger;
  console.log(`new message: ${JSON.stringify(msg)}`);
  const { cmd, args } = msg;
  if (cmd in htmx) {
      try {
          htmx[cmd](...(Array.isArray(args) ? args : Object.values(args)));
      } catch (e) {
          console.error(e);
      }
  } else {
      console.warn(`Unknown HTMX command: ${cmd}`);
  }
}

async function initializeCommander(sels) {
  await htmxSetup(sels);
  if (!window.htmx) console.warn('HTMX not loaded!');
  initializeObserver(sels);
  console.log('Commander initialized');
}
// -----------------------------------------------------------------------------

debugger;

// import xhook from 'https://unpkg.com/xhook@1.6.2/es/main.js';
// import htmx from 'https://cdn.jsdelivr.net/npm/htmx.org@2.0.3/dist/htmx.esm.js';

// ---- Utility functions

function getCurrentDateGMT() {
  return new Date().toUTCString();
}

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  // return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

class Bridget {
  #pending = {};
  constructor() {
    this.model = null;
  }

  on_request(request, callback) {
    if (!this.model) return;
    let req = { ...request, req_id: generateUUID() };
    delete req.xhr;
    delete req.upload;
    if (this.model.get('debug_req')) {
      console.log('Request:', JSON.stringify(req, null, 2));
    }
    this.#pending[req.req_id] = callback;
    this.model.set('request', req);
    this.model.save_changes();
  }

  response_changed() {
    if (!this.model) return;
    const response = this.model.get('response');
    let req_id = response?.req_id;
    if (this.model.get('debug_req')) {
      console.log('Response:', JSON.stringify(response, null, 2));
    }
    const callback = this.#pending?.[req_id];
    if (callback) {
      delete this.#pending[req_id];
      callback(response);
    }
  }  

  async setup_libraries({ css_scope_inline, surreal }) {
    const { default: xhook } = await import('https://unpkg.com/xhook@1.6.2/es/main.js');
    // if (css_scope_inline && !window.cssScopeCount) await import(css_scope_inline);
    // if (surreal && !window.me) await import(surreal);
    return { xhook };
  }

  async initialize({ model }) {
    debugger;
    if (window.$BRDGT) {
      console.log("There's a Bridget running: cleaning up.");
      window.$BRDGT._cleanup();
    };
    this.model = model;
    await initializeCommander(model.get('output_sels'));
    model.on('change:response', () => this.response_changed());
    model.on("msg:custom", on_msg);
    // const on_request = (request, callback) => this.on_request(request, callback);
    const on_request = this.on_request.bind(this);
    const { xhook } = await this.setup_libraries(this.model.get('libraries'));
    if (xhook) {
      xhook.before(on_request);
    }
    window.$BRDGT = this;
    console.log('Bridget initialized');
    return this._cleanup = () => {
      if (this.model) {
        xhook.removeEventListener('before', on_request);
        this.model = null;
        window.$BRDGT = null;
      }
      console.log('Bridget model destroyed');
    };
  }

  render({ model, el }) {
    el.innerHTML = `
      <h3>Bridget</h3>
    `;
    return () => {
      console.log('Bridget view unmounted');
    };
  }
}

export default async () => {
  const bridget = new Bridget();
  return {
    initialize: async (context) => await bridget.initialize(context),
    render: (context) => bridget.render(context),
  };
};
