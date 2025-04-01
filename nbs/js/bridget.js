// import { getObserverManager } from './observer.js';
// import { initializeCommander, on_commander_msg } from './commander.js';

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
  constructor(model) {
    this.model = model;
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
    if (window.$BRDGT) {
      console.log("There's a Bridget running: cleaning up.");
      throw new Error("There's a Bridget running: cleaning up.");
      // window.$BRDGT._cleanup();
    };
    this.model = model;
    await initializeCommander(model.get('output_sels'));
    model.on('change:response', () => this.response_changed());
    model.on("msg:custom", on_commander_msg);
    const on_request = this.on_request.bind(this);
    const { xhook } = await this.setup_libraries(this.model.get('libraries'));
    if (xhook) xhook.before(on_request);
    window.$BRDGT = this;
    console.log('Bridget initialized');
    model.send({ kind: 'info', info: 'initialized' });
    return this._cleanup = () => {
      if (this.model) {
        xhook.removeEventListener('before', on_request);
        this.model = null;
        window.$BRDGT = null;
      }
      console.log('Bridget model destroyed');
    };
  }

  // render({ model, el }) {
  //   el.innerHTML = `
  //     <h3>Bridget</h3>
  //   `;
  //   return () => {
  //     console.log('Bridget view unmounted');
  //   };
  // }

}

