import { truncate } from './utils.js';
import { debug } from '../../common/debug.js';
import { ChangeCollatorVSCode, eventSummary } from './changeCollatorVSCode.js';
import { processCell } from './nbformatHelpers.js';
import { Bridged } from './bridged.js';
// import { hasNBMimeOutput, MIME } from './utils.js';

const log = debug('nbinspect:monitor', 'darkblue');

/** 
 * @typedef {import('vscode').NotebookEditor} NotebookEditor 
 * @typedef {import('vscode').NotebookDocument} NotebookDocument
 * @typedef {import('vscode').NotebookEditorSelectionChangeEvent} NotebookEditorSelectionChangeEvent
 * @typedef {import('vscode').NotebookDocumentChangeEvent} NotebookDocumentChangeEvent
 */

/** 
 * @typedef {import('./changeCollator.js').Added} Added
 * @typedef {import('./changeCollator.js').Removed} Removed
 * @typedef {import('./changeCollator.js').CellIdxs} CellIdxs
 * @typedef {import('./changeCollator.js').Diff} Diff
 */

/** 
 * @typedef {import('./types.js').NBData} NBData
 * @typedef {import('./types.js').StateMessage} StateMessage
 * @typedef {import('./types.js').DiffsMessage} DiffsMessage
 * @typedef {import('./types.js').RendererStateMessage} RendererStateMessage
 * @typedef {import('./types.js').RendererDeregisterMessage} RendererDeregisterMessage
 */

export class NBStateMonitor {
  /** @type {Map<string, NBStateMonitor>} - notebook.uri -> NBStateMonitor */
  static monitors = new Map();
  static messaging = null;

  #lastTs = 0;
  #changeTracker;

  static defaultOpts = {
    watch: true,  // watch for changes, otherwise only send state on renderer request
    debug: false
  };
  static defaultDebounceDelay = 600;
  static shortDebounceDelay = 200;
  static restoreDebounceDelay = 1000;
  
  /** @type {NotebookDocument} */
  nb;
  #renderer = null;  // renderer associated with this notebook: origin (document.origin, webview)
  #opts;  // options
  /** @type {BridgeNBEventsFilter} */
  #filterer;  // filter events
  /** @type {Map<string, Bridged>} - bridged.id -> Bridged */
  bridged = new Map();
  debounce = true;
  #debounceDelay = NBStateMonitor.defaultDebounceDelay;
  /** @type {StateChange[]} - pending state changes */
  #pending = [];
  /** @type {RendererStateMessage|null} - pending renderer messages */
  #pendingRendererMessage = null;
  #pendingDocChanges = new Set();
  // #pendingDocChangesTimer = null;
  #prevSel = null;

  constructor(notebook, opts = {}) {
    this.nb = notebook;
    this.#opts = { ...NBStateMonitor.defaultOpts, ...opts };
    // this.#filterer = new BridgeNBEventsFilter(notebook);
    this.#changeTracker = { collator: new ChangeCollatorVSCode(notebook), timer: null, delay: this.debounceDelay };
    // this.#throttleInterval = opts.throttleInterval ?? NBStateMonitor.defaultThrottleInterval;
  }

  static get(notebook) { return NBStateMonitor.monitors.get(notebook); }
  static delete(notebook) { this.monitors.delete(notebook); }
  static create(notebook, opts={}) {
    const monitor = new NBStateMonitor(notebook, opts);
    NBStateMonitor.monitors.set(notebook, monitor);
    monitor.nb.getCells().forEach(cell => Bridged.bridgedOf(cell));
    return monitor;
  }
  static from(editor) {
    let monitor;
    if (editor) {
      const nb = editor.notebook;
      monitor = NBStateMonitor.get(nb);
      if (!monitor) {
        monitor = NBStateMonitor.create(nb, {});
        monitor.#prevSel = editor.selections;
      }
    }
    return monitor;
  }

  static onCloseNotebook(nb) {
    NBStateMonitor.delete(NBStateMonitor.get(nb));
  }

  // onDidChangeActiveNotebookEditor
  static onChangeActiveEditor(editor) {
    const monitor = NBStateMonitor.from(editor);
    log(`onChangeActiveEditor: ${monitor ? `...${monitor.nb.uri.toString().slice(-20)}` : null}`);
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

  get renderer() { return this.#renderer; }
  set renderer(origin) {
    this.#renderer = origin;
    this.#lastTs = 0;
    log(`---- renderer: ${truncate(origin)}`);
  }
  
  /** Send a message with the current state.
   * @param {RendererMessage | null} reqMsg
   */
  async #sentNBState(reqMsg) {
    log.reset()(">>>> #sentNBState");
    const ts = Date.now();
    this.#pending.length = 0;
    this.#lastTs = ts;
    const nb = this.nb;
    // const changes = [{cells: nb.getCells().map(processCell), cellCount: nb.cellCount}]
    const cells = nb.getCells().map(processCell)
    const nbData = { cellCount: nb.cellCount, metadata: nb.metadata, 
      notebookType: nb.notebookType, notebookUri: this.nb.uri.toString() };
    /** @type {StateMessage} */
    const message = { type: "state", timestamp: ts, origin: reqMsg?.origin || this.renderer, 
      cells, nbData, reqId: reqMsg?.reqId }
    NBStateMonitor.messaging.postMessage(message);
    log(">>>> ", this.renderer ? '' : '(no renderer)');
  }

  /** Send a message with changes since last state message.
   * @param {Diff[]} diffs
   * @returns {StateChange[]}
   */
  #getNBStateChanges(diffs) {
    const nb = this.nb;
    return diffs.map(([changed, added, removed, cellCount]) => {
      changed = changed.map(idx => processCell(nb.cellAt(idx)));
      added = added.flatMap(({cellIdxs}) => cellIdxs.map(idx => {
        const cell = nb.cellAt(idx);
        return processCell(cell)})
      );
      removed = removed.flatMap((r) => Array.from({length: r.end - r.start}, (_, i) => i + r.start));
      log(`diff`, 
        changed.length > 0 ? `changed: [${[...changed.map(c => c.idx)]}]` : '', 
        added.length > 0 ? `added: [${[...added.map(c => c.idx)]}]` : '', 
        removed.length > 0 ? `removed: [${removed}]` : '', 
        `cellCount: ${cellCount}`
      );
      return { cells: changed, added: added, removed: removed, cellCount: cellCount };
    });
  }

  /** Send or queue state changes.
   * @param {Diff[]} diffs
   */
  sentNBState(diffs) {
    log(">>>> sentNBState:");
    const reqMsg = this.#pendingRendererMessage;
    this.#pendingRendererMessage = null;
    if (!this.renderer && reqMsg) this.renderer = reqMsg.origin;
    if (/* diffs.length &&  */this.#lastTs) {
      const ts = this.#lastTs = Date.now();
      if ((diffs.length+this.#pending.length) < this.nb.cellCount/2) {
        const changes = this.#getNBStateChanges(diffs);
        if (changes.length > 0) {
          /* if (this.watch) { */
            /** @type {DiffsMessage} */
            const msg = { type: "diffs", timestamp: ts, origin: this.renderer, 
              changes: this.#pending.concat(changes), 
              nbData: { cellCount: this.nb.cellCount }, reqId: reqMsg?.reqId }
            this.#pending.length = 0;
            NBStateMonitor.messaging.postMessage(msg);
            log.reset()(">>>> sent >>>>", this.renderer ? '' : '(no renderer)');
            return;
          /* } */
          this.#pending.push(...changes);
          log(">>>> pending", this.#pending.length);
          return;
        } else {
          log(">>>> no changes");
        }
        return;
      }
    }
    this.#sentNBState(reqMsg);
  }

  /** 
   * @param {NotebookEditor} editor
   * @param {{message: RendererStateMessage | RendererDeregisterMessage}} message
   */
  static onRendererMessage({ editor, message }) {
    const nOpts = message.opts;
    if (nOpts && nOpts.debug !== undefined) {
      nOpts.debug ? debug.enable('nbinspect:*') : debug.disable();
    }
    const nb = editor.notebook;
    const monitor = NBStateMonitor.get(nb);
    log.reset()(`---- Message from renderer @${monitor.nb.uri.toString()}:`);
    const { type, reqId, origin } = message;
    log(`---- ${JSON.stringify({ type, reqId })}`);

    if (message.type === "deregister") {
      // monitor.active = false;
      // log("---- deregister");
      // if (!hasNBMimeOutput(nb, MIME)) {
      //   NBStateMonitor.delete(nb);
      //   log("---- deleted monitor", monitor.nb.uri.toString());
      // }
      // log("----");
      return;
    }

    log('---- nOpts:', nOpts);
    let first = false;
    if (!monitor.renderer) {  // first renderer message
      monitor.renderer = origin;
      first = true;
    }
    monitor.active = true;
    if (monitor.#changeTracker.collator.isEmpty) {  // direct message
      if (message.type === "getState") {  // will send full state
        monitor.#sentNBState(message);
      } else if (message.type === "updateOpts") {  // do nothing
        monitor.#pendingRendererMessage = message;
      } else {                           // will send pending diffs
        monitor.#pendingRendererMessage = message;
        monitor.sentNBState([]);
      }
      return;
    }
    log('---- waiting for changes...');
    if (nOpts.watch !== undefined) monitor.watch = nOpts.watch;
    if (nOpts.debug !== undefined) monitor.#opts.debug = nOpts.debug;
    
    monitor.#pendingRendererMessage = message;
    if (first || message.type === "getState") {
      monitor.#lastTs = 0;
    } else {
    }
    monitor.oneShotDelay();  // reduce delay for renderer cell changes
  }
  
  /**
   * @param {NotebookEditorSelectionChangeEvent} event
   */
  // static onChangeSelection(event) {
  //   const monitor = NBStateMonitor.get(event.notebookEditor.notebook);
  //   // log(`onChangeSelection: ...${monitor.nb.uri.toString().slice(-20)} - selected: ${selected}`);
  //   if (monitor.#pendingDocChangesTimer) {
  //     monitor.#pendingDocChangesTimer = clearTimeout(monitor.#pendingDocChangesTimer);
  //   }
  //   if (monitor.#pendingDocChanges.size > 0) {
  //     // collate changes
  //     let docChanges = Array.from(monitor.#pendingDocChanges);
  //     log(`onChangeSelection: pendingDocChanges: [${docChanges}]`);
  //     const collator = monitor.#changeTracker.collator;
  //     collator.setDocumentChanges(docChanges);
  //     // wait a little while to see if there are more changes (onChange... will clear the timer)
  //     monitor.#pendingDocChangesTimer = setTimeout(() => {
  //       monitor.#pendingDocChangesTimer = null;
  //       docChanges = Array.from(monitor.#pendingDocChanges);
  //       monitor.#pendingDocChanges.clear();
  //       monitor.sentNBState([[docChanges, [], [], monitor.nb.cellCount]]);
  //     }, 1000);
  //   }
  //   const selected = event.selections.map(s => s.start);
  //   monitor.#prevSel = selected;
  // }
  static onChangeSelection(event) {
    const monitor = NBStateMonitor.get(event.notebookEditor.notebook);
    // log(`onChangeSelection: ...${monitor.nb.uri.toString().slice(-20)} - selected: ${selected}`);
    if (monitor.#pendingDocChanges.size > 0) {
      log(`onChangeSelection: pendingDocChanges: [${[...monitor.#pendingDocChanges]}]`);
      const collator = monitor.#changeTracker.collator;
      const docChanges = Array.from(monitor.#pendingDocChanges);
      monitor.#pendingDocChanges.clear();
      if (collator.isEmpty) {  // sent directly, don't queue
        monitor.sentNBState([[docChanges, [], [], monitor.nb.cellCount]]);
      } else {
        collator.setDocumentChanges(docChanges);
      }
    }
    monitor.#prevSel = event.selections.map(s => s.start);
  }

  /**
   * @param {NotebookDocumentChangeEvent} event
   */
  static onChange(event) {
    try {
      const monitor = NBStateMonitor.get(event.notebook)/*  ?? NBStateMonitor.create(nb, {}) */;
      const tracker = monitor.#changeTracker;
      clearTimeout(tracker.timer);
      if (event.cellChanges.length === 1 && event.cellChanges[0].document) {
        // skip bare document changes
        monitor.#pendingDocChanges.add(event.cellChanges[0].cell.index);
        console.log(".......... d")
        return;
      }
      if (debug.enabled) {
        // console.log(".......... e");
        log('.......... e:', eventSummary(event));
      }
      // monitor.#pendingDocChangesTimer = clearTimeout(monitor.#pendingDocChangesTimer);
      const collator = tracker.collator;
      collator.addEvent(event);
      // const iniDelay = tracker.delay;
      // if (event.cellChanges.length === 1 && event.cellChanges[0].document) {
      //   tracker.delay = NBStateMonitor.defaultDebounceDelay * 2;  // give it a chance to settle
      // } else {
      //   tracker.delay = iniDelay;
      // }
      tracker.timer = setTimeout(() => {
        tracker.timer = null;
        if (!NBStateMonitor.get(event.notebook)) return;  // monitor deleted
        monitor.restoreDebounceDelay();
        tracker.delay = NBStateMonitor.shortDebounceDelay;
        if (collator.hasDiffs) {
          if (debug.enabled) collator.showSummary();
          const diffs = collator.getDiffs();
          monitor.sentNBState(diffs);
          // log('____ to sentNBState');
          if (!collator.isEmpty) collator.cleanup();
          if (debug.enabled) {
            if (collator.isEmpty) {
              console.log("     ____ empty collator ____\n");
            } else {
              console.log("     ____ pending changes ____");
              collator.summary();
              console.log();
            }
          }
        }
      }, tracker.delay);
    } catch (e) {
      log('---- onChange error:', e);
    }
  }

}
