// debugger;
import * as vscode from 'vscode';  // eslint-disable-line no-unused-vars
// import debug from 'debug';

import { debug, truncate } from './utils.js';
import { ChangeCollator } from './changeCollator.js';
// import { processCell } from './cellProcessor.js';
import { processCell } from './nbformatHelpers.js';
import { Bridged } from './bridged.js';
import { hasNBMimeOutput, MIME } from './utils.js';

const log = debug('nbinspect:monitor', 'darkblue');

/**
 * @typedef {Object} NBData
 * @property {number} cellCount
 * @property {Object|undefined} metadata
 * @property {string|undefined} notebookType
 * @property {string|undefined} notebookUri
 */

/**
 * @typedef {Object} StateMessage
 * @property {'state'} type - Message type identifier
 * @property {string} origin - Notebook URI
 * @property {number} timestamp - Timestamp of the state message
 * @property {StateCell[]} cells - state cells
 * @property {NBData} NBData - Notebook metadata
 * @property {'notebookUpdate'|undefined} [changeType] - Type of change that triggered update
 * @property {string|undefined} [outputId] - ID of the output requesting state
 * @property {string|undefined} [reqid] - ID of the request
 */

/**
 * @typedef {Object} StateDiffMessage
 * @property {'stateDiff'} type - Message type identifier
 * @property {string} origin - Notebook URI
 * @property {number} timestamp - Timestamp of the message
 * @property {Object<number, StateCell>|undefined} changed - changed cells
 * @property {number[]|undefined} added - cell indices of added cells
 * @property {number[]|undefined} removed - cell indices of removed cells
 * @property {NBData|undefined} NBData - Notebook metadata
 */

/**
 * @typedef {Object} RendererStateMessage
 * @property {'getState' | 'updateState'} type - Message type identifier
 * @property {string} outputId - ID of the output requesting state
 * @property {string} reqid - ID of the request
 * @property {Object} opts - Options for the renderer
 * @property {string} origin - Origin of the request (window)
 */

/**
 * @typedef {Object} RendererDeregisterMessage
 * @property {'deregister'} type - Message type identifier
 * @property {string} outputId - ID of the output requesting state
 */

/** 
 * @typedef {import('./changeCollator').Added} Added
 * @typedef {import('./changeCollator').Removed} Removed
 */

export class NBStateMonitor {
  /** @type {Map<string, NBStateMonitor>} - notebook.uri -> NBStateMonitor */
  static monitors = new Map();
  static messaging = null;

  #origin;  // renderer origin (document.origin, webview)
  #lastTs = 0;
  #changeTracker;

  static defaultOpts = {
    watch: false,  // watch for changes, otherwise only send state on renderer request
    // contentOnly: false,  // send state if notebook structure changes, e.g. cells added or removed
    debug: false
  };
  static defaultDebounceDelay = 600;
  static shortDebounceDelay = 100;
  static restoreDebounceDelay = 1000;
  // static defaultThrottleInterval = 200;  // 5 times per second (1000ms / 5)
  
  /** @type {vscode.NotebookDocument} */
  nb;
  active = false;
  renderer = false;
  #opts;  // options
  /** @type {BridgeNBEventsFilter} */
  #filterer;  // filter events
  /** @type {Map<string, Bridged>} - bridged.id -> Bridged */
  bridged = new Map();
  debounce = true;
  #debounceDelay = NBStateMonitor.defaultDebounceDelay;
  #pendingMessages = [];
  // /** @type {number[]} - cell indices of updates to send */
  // #pending = [];

  // #throttleTimer = null;
  // #throttleInterval;
  // #throttleActive = false;

  constructor(notebook, opts = {}) {
    this.nb = notebook;
    this.#origin = notebook.uri.toString();
    this.#opts = { ...NBStateMonitor.defaultOpts, ...opts };
    // this.#filterer = new BridgeNBEventsFilter(notebook);
    // this.#pendingMessage = null;
    this.#changeTracker = { collator: new ChangeCollator(), timer: null, delay: this.debounceDelay };
    // this.#throttleInterval = opts.throttleInterval ?? NBStateMonitor.defaultThrottleInterval;
  }

  static get(notebook) { return NBStateMonitor.monitors.get(notebook.uri.toString()); }
  static delete(notebook) { this.monitors.delete(notebook.uri.toString()); }
  static create(notebook, opts={}, active=false) {
    const monitor = new NBStateMonitor(notebook, opts);
    NBStateMonitor.monitors.set(notebook.uri.toString(), monitor);
    if (active) monitor.setActive();
    return monitor;
  }

  setActive() {
    if (!this.active) {
      this.nb.getCells().forEach(cell => Bridged.bridgedOf(cell));
      this.active = true;
    }
  }
  
  get debounceDelay() { 
    return this.#debounceDelay;
  }
  restoreDebounceDelay() {
    this.#debounceDelay = NBStateMonitor.defaultDebounceDelay;
  }
  oneShotDelay(delay = NBStateMonitor.shortDebounceDelay) {
    this.#debounceDelay = delay;
    setTimeout(() => {
      this.restoreDebounceDelay();
    }, NBStateMonitor.restoreDebounceDelay);
  }

  get watch() { return this.#opts.watch; }
  set watch(flag) { this.#opts.watch = flag; }
  // get contentOnly() { return this.#opts.contentOnly; }
  // set contentOnly(flag) { this.#opts.contentOnly = flag; }

  // startThrottle() {
  //   if (this.#throttleActive) return;
  //   this.#throttleActive = true;
  //   this.#throttleTimer = setInterval(() => {
  //     this.processNextPending();
  //   }, this.#throttleInterval);
  // }

  // stopThrottle() {
  //   if (!this.#throttleActive) return;
  //   clearInterval(this.#throttleTimer);
  //   this.#throttleTimer = null;
  //   this.#throttleActive = false;
  // }

  // processNextPending() {
  //   if (this.#pending.length === 0) {
  //     this.stopThrottle();
  //     return;
  //   }
  //   const cellIdxs = this.#pending.splice(0, this.#pending.length);
  //   if (DEBUG) console.log(`Processing pending cell ${cellIndex}`);
  //   this.sentNBStateDiff(cellIdxs);
  // }

  addPendingMessage(message) {
    if (this.#pendingMessages.length > this.nb.cellCount/4) {
      this.#pendingMessages.length = 0;
    } else {
      this.#pendingMessages.push(message);
    }
  }

  /** Send a state message.
   * @param {RendererMessage | null} reqMsg
   * @param {'notebookUpdate' | undefined} changeType
   */
  async sentNBState(reqMsg, changeType) {
    const nb = this.nb;
    const cells = nb.getCells().map(processCell);
    const nbData = { cellCount: nb.cellCount, metadata: nb.metadata, 
      notebookType: nb.notebookType, notebookUri: this.#origin };
    const ts = this.#lastTs = Date.now();
    log(">>>> sentNBState", ts);
    /** @type {StateMessage} */
    NBStateMonitor.messaging.postMessage({ type: "state", timestamp: ts, origin: reqMsg.origin, 
      cells: cells, nbData: nbData, changeType: changeType, 
      outputId: reqMsg.outputId, reqid: reqMsg.reqid });
  }

  /** Send a state diff message with changed, added or removed cells.
   * @param {number[]} changed - Cell indices of changed cells
   * @param {Added[]} added - Cell indices of added cells
   * @param {Removed[]} removed - Cell indices of removed cells
   */
  sentNBStateDiff(changed, added, removed) {
    if (!this.#lastTs) return this.sentNBState({ origin: this.renderer }, "notebookUpdate");
    const nb = this.nb;
    changed = changed.map(idx => processCell(nb.cellAt(idx)));
    added = added.flatMap(({cellIdxs}) => cellIdxs.map(idx => {
      const cell = nb.cellAt(idx);
      Bridged.bridgedOf(cell);
      return processCell(cell)}));
    removed = removed.flatMap((r) => Array.from({length: r.end - r.start}, (_, i) => i + r.start));
    const ts = this.#lastTs = Date.now();
    log(">>>> NBStateDiff", 
      changed.length > 0 ? `changed: [${[...changed.map(c => c.idx)]}]` : '', 
      added.length > 0 ? `added: [${[...added.map(c => c.idx)]}]` : '', 
      removed.length > 0 ? `removed: [${removed}]` : '', 
      'ts:', ts);
    const message = { type: "stateDiff", timestamp: ts, origin: this.renderer, 
      changed, added, removed, nbData: { cellCount: nb.cellCount } }
    if (this.watch/*  || hasRenderer(message) */) {
      /** @type {StateDiffMessage} */
      NBStateMonitor.messaging.postMessage(message);
      log(">>>> sent >>>>");
    } else {
      this.addPendingMessage(message);
      log(">>>> pending");
    }
  }

  /** 
   * @param {vscode.NotebookEditor} editor
   * @param {{message: RendererStateMessage | RendererDeregisterMessage}} message
   */
  static onRendererMessage({ editor, message }) {
    const nOpts = message.opts;
    if (nOpts && nOpts.debug !== undefined) {
      // nOpts.debug ? debug.enable('nbinspect:*') : debug.disable();
      log.enabled = Boolean(nOpts.debug);
    }
    const nb = editor.notebook;
    const monitor = NBStateMonitor.get(nb);
    log(`---- Message from renderer @${monitor.#origin}:`);
    const { type, outputId, reqid, origin } = message;
    log(`---- ${JSON.stringify({ type, outputId, reqid })}`);
    if (!monitor.renderer) {  // first renderer message
      monitor.renderer = origin;
      monitor.#lastTs = 0;
      log(`---- renderer: ${truncate(origin)}`);
    }
    monitor.setActive();
    if (message.type === "deregister") {
      // monitor.active = false;
      log("---- deregister");
      if (!hasNBMimeOutput(nb, MIME)) {
        NBStateMonitor.delete(nb);
        log("---- deleted monitor", monitor.nb.uri.toString());
      }
      log("----"); return; 
    }
    log('---- nOpts:', nOpts);
    log('---- waiting for changes...');
    if (nOpts.watch !== undefined) monitor.watch = nOpts.watch;
    // if (nOpts.contentOnly !== undefined) monitor.contentOnly = nOpts.contentOnly;
    if (nOpts.debug !== undefined) monitor.#opts.debug = nOpts.debug;
    // if (!monitor.watch) {
    //   // monitor.sentNBState(message);
    // } else {
    // monitor.#pendingMessage = message;
    // setTimeout(() => {
    //   console.log("**** pending: ", monitor.#pendingMessage);
    // }, 1000);
    
    if (message.type === "getState") {
      monitor.#lastTs = 0;
      monitor.oneShotDelay();  // reduce delay for renderer cell changes
      // monitor.sentNBState(message);
    } else {  // updateState
      monitor.oneShotDelay();  // reduce delay for renderer cell changes
      // monitor.sentNBState(message);
    }
    // monitor.sentNBState(message);
    // }
  }
  
  static onCloseNotebook(nb) {
    const monitor = NBStateMonitor.get(nb);
    if (monitor) NBStateMonitor.delete(nb);
  }

  // /** @param {ChangeCollator} chs */
  // changed(chs, relevant=false) {
  //   if (DEBUG) {
  //     chs.summary();
  //     console.log("**** relevant: ", relevant);
  //     console.log("**** pending: ", this.#pendingMessage);
  //   };
  //   if (chs.added) chs.added.forEach(cell => Bridged.bridgedOf(cell));
  //   if (chs.removed) {
  //     chs.removed.forEach(cell => {
  //       const brd = this.bridged.get(Bridged.brdId(cell));
  //       if (brd && brd.cell.index === -1) this.bridged.delete(brd.id);
  //     });
  //   }
  //   if (relevant || (this.watch && this.#filterer.filter(chs))) {
  //     this.sentNBState(this.#pendingMessage || { origin: this.#origin }, "notebookUpdate");
  //   }
  //   this.#pendingMessage = null;
  // }

  static onChange/* _new */(event) {
    const nb = event.notebook;
    const monitor = NBStateMonitor.get(nb) ?? NBStateMonitor.create(nb, {}, true);
    const tracker = monitor.#changeTracker;
    console.log(".......... d");
    clearTimeout(tracker.timer);
    tracker.collator.addEvent(event);
    if (event.cellChanges.length === 1 && event.cellChanges[0].document) {
      tracker.delay = NBStateMonitor.defaultDebounceDelay;
    }
    tracker.timer = setTimeout(() => {
      if (!NBStateMonitor.get(monitor.nb)) return;  // monitor deleted
      monitor.restoreDebounceDelay();
      tracker.delay = NBStateMonitor.shortDebounceDelay;
      const chs = tracker.collator.getAll();
      // tracker.collator.showCellChanges(tracker.collator.events);
      if (chs) {
        monitor.sentNBStateDiff(...chs);
        if (log.enabled) {
          if (tracker.collator.size === 0) {
            console.log("     ____ empty collator ____\n");
          } else {
            console.log("     ____ pending changes ____");
            tracker.collator.summary();
            console.log();
          }
        }
      } else {
        // console.log("     checking document changes...\n");
        // if (tracker.collator.hasDocumentChanges) {
        //   console.log("     document changes\n");
        // }
      }
    }, tracker.delay);
  }

  // static onChange_old = (() => {
  //   const debounceState = new WeakMap();

  //   return (event) => {
  //     const monitor = NBStateMonitor.get(event.notebook) ?? 
  //                     NBStateMonitor.create(event.notebook);
  //     // start monitoring only after first renderer message
  //     if (!monitor || (!monitor.active && !DEBUG)) return;
      
  //     if (monitor.debounce) {
  //       let state = debounceState.get(monitor) ?? { 
  //         collator: new ChangeCollator(), timer: null, delay: monitor.debounceDelay, 
  //         nb: event.notebook, relevant: null };
  //       if (DEBUG) console.log(".......... d");
          
  //       clearTimeout(state.timer);
  //       state.collator.addEvent(event);

  //       // if (event.cellChanges && state.relevant === null && (
  //       //     event.cellChanges.some(ch => hasTransientOutput(ch)) ||
  //       //     event.cellChanges.some(ch => hasMimeOutput(ch, MIME))
  //       //   )) {
  //       //     state.relevant = true;
  //       //     state.delay = monitor.shortDebounceDelay;
  //       // }
              
  //       state.timer = setTimeout(() => {
  //         if (!NBStateMonitor.get(state.nb)) return;  // monitor deleted
  //         monitor.restoreDebounceDelay();
  //         debounceState.delete(monitor);
  //         if (DEBUG) {
  //           state.collator.summary();
  //           if (!monitor.active) return
  //         }
  //         if (state.collator.events.length === 0) return;
  //         if (!monitor.watch && !state.relevant) return;
  //         monitor.changed(state.collator, state.relevant);
  //       }, state.delay);
        
  //       debounceState.set(monitor, state);
  //       return;
  //     }
      
  //     monitor.changed(new ChangeCollator([event]));
  //   };
  // })();

}
