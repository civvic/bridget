debugger;

// import xhook from 'https://unpkg.com/xhook@1.6.2/es/main.js';
// import htmx from 'https://cdn.jsdelivr.net/npm/htmx.org@2.0.3/dist/htmx.esm.js';

// ---- Utility functions

// Global sentinel
if (typeof window._$BRDGT === 'undefined') {
  window._$BRDGT = null;
}

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

// ---- Mutation observers to setup HTMX of new output cells

const targetNode = document.body;
// const outputCellSelectors = ['.output_container>.output', '.output_html'];
// Got to observe also .output_html for inner output cells mutations
// const MUTATION_TIMEOUT = 50; // milliseconds to wait for additional mutations

function processNode(n) {
  if (!window.htmx) return;
  // n.setAttribute('ready', '');  // mark for observation, Faster than walking MutationObserver 
  //                               // results when receiving subtree (DOM swap, htmx, ajax, jquery).
  htmx.process(n);
  // console.log('Processed output cell', n.outerHTML);
  console.log('Processed output node', n);
}


function initializeObserver(target, sels) {
  const observer = new MutationObserver(recs => {
    // console.log('MutationObserver triggered, records', recs.length);
    for (const r of recs) {
      if (r.addedNodes.length < 1 || !sels.some(sel => r.target.matches(sel))) continue;
      // console.log('record', r);
      for (const n of r.addedNodes) {
        if (n.nodeType === 1) requestAnimationFrame(() => processNode(n))
      }
    }
  });
  observer.observe(target, { childList: true, subtree: true });
  console.log('Main observer initialized');
  return observer;
}

// Manages HTMX initialization in notebook output cells
// Observes DOM for new cells and processes them with HTMX
// Provides cleanup on widget destruction
class BridgetObserver {
  cleanup = null;
  initialized = false;
  setupObserver(sels) {
    const outputObserver = initializeObserver(targetNode, sels);
    this.initialized = true;
    console.log('BridgetObserver initialized');
    this.cleanup = () => {
      outputObserver.disconnect();
      this.initialized = false;
      this.cleanup = null;
      console.log('BridgetObserver destroyed');
    }
  }

  async setup(sels) {
      // await htmxSetup();
      this.setupObserver(sels);
  }
}

// Manages request/response cycle
// Handles widget lifecycle
// Processes HTMX commands
class Bridget {
  #pending = {};
  constructor() {
    this.model = null;
    // this.el = null;
    this.server = null;
  }

  on_request(request, callback) {
    if (!this.model) return;
    // request.headers['Test-Header'] = 'awesome/file';
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
    // debugger;
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

  msg_handler(msg) {
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

  async setup_libraries({ css_scope_inline, surreal }) {
    const { default: xhook } = await import('https://unpkg.com/xhook@1.6.2/es/main.js');
    // if (css_scope_inline && !window.cssScopeCount) await import(css_scope_inline);
    // if (surreal && !window.me) await import(surreal);
    return { xhook };
  }

  async initializeServer() {
    this.server = new BridgetObserver();
    await this.server.setup(this.model.get('htmx_sels'));
  }

  async initialize({ model }) {
    debugger;
    if (window._$BRDGT) {
      console.log("There's a Bridget running: cleaning up.");
      window._$BRDGT._cleanup();
    };
    this.model = model;
    const on_request = (request, callback) => this.on_request(request, callback);
    model.on('change:response', () => this.response_changed());
    model.on("msg:custom", msg => this.msg_handler(msg));
    if (this.model.get('htmx')) {
      await this.initializeServer();
    }
    const { xhook } = await this.setup_libraries(this.model.get('libraries'));
    if (this.server) {
      xhook.before(on_request);
    }
    await htmxSetup(this.model.get('htmx_sels'));
    if (!window.htmx) {
      console.warn('HTMX not loaded!');
    }
    window._$BRDGT = this;
    console.log('Bridget initialized with server', this.server);
    return this._cleanup = () => {
      if (this.server) {
        xhook.removeEventListener('before', on_request);
        this.server.cleanup();
        this.server = this.model = null;
        window._$BRDGT = null;
      }
      console.log('Bridget model destroyed');
    };
  }

  render({ model, el }) {
    // this.el = el;
    // el.innerHTML = `
    //   <h3>Bridget</h3>
    //   <div>Value: <span id="value">${model.get("value")}</span></div>
    //   <button id="increment">Increment</button>
    // `;
    el.innerHTML = `
      <h3>Bridget</h3>
    `;

    // const valueSpan = el.querySelector('#value');
    // const incrementBtn = el.querySelector('#increment');
    // const btnClicker = () => {
    //   model.set('value', model.get('value') + 1);
    //   model.save_changes();
    // };

    // incrementBtn.addEventListener('click', btnClicker);
    // model.on('change:value', () => {
    //   valueSpan.textContent = model.get('value');
    // });
    return () => {
      // incrementBtn.removeEventListener('click', btnClicker);
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
