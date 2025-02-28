import * as vscode from 'vscode';
// import debug from 'debug';
// debug.enable('nbinspect:*');
// debug.log = console.info.bind(console);
// const log = debug('nbinspect:ext');

import { debug as debug2 } from './utils.js';
import { NBStateMonitor } from './stateMonitor.js';
// import { getType } from './utils.js';


const log = debug2('nbinspect:ext', 'darkgreen');

/** @param {vscode.ExtensionContext} context */
export function activate(context) {
  log('Activating NBInspect extension');
  // (debug.inspectOpts ??= {}).hideDate ??= !!process.env.DEBUG_HIDE_DATE;
  // debug.inspectOpts.hideDate = true;
  // debug.inspectOpts.colors = true;
  // log(debug.inspectOpts);
  const messaging = vscode.notebooks.createRendererMessaging("nbinspect-renderer");
  NBStateMonitor.messaging = messaging;
  messaging.onDidReceiveMessage(NBStateMonitor.onRendererMessage);
  context.subscriptions.push(
    messaging,
    vscode.workspace.onDidChangeNotebookDocument(NBStateMonitor.onChange),  
    vscode.workspace.onDidCloseNotebookDocument(NBStateMonitor.onCloseNotebook)
  );
}

export function deactivate() {
  NBStateMonitor.monitors.forEach( monitor => monitor.watch = false );
  NBStateMonitor.monitors.clear();
}
