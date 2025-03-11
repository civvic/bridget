import * as vscode from 'vscode';

import { debug } from './debug.mjs';
import { NBStateMonitor } from './stateMonitor.mjs';


const log = debug('nbinspect:ext', 'darkgreen');

/** @param {vscode.ExtensionContext} context */
export function activate(context) {
  log('Activating NBInspect extension');
  const messaging = vscode.notebooks.createRendererMessaging("nbinspect-renderer");
  NBStateMonitor.messaging = messaging;
  messaging.onDidReceiveMessage(NBStateMonitor.onRendererMessage);
  context.subscriptions.push(
    messaging,
    vscode.workspace.onDidChangeNotebookDocument(NBStateMonitor.onChange),  
    vscode.workspace.onDidCloseNotebookDocument(NBStateMonitor.onCloseNotebook),
    vscode.window.onDidChangeNotebookEditorSelection(NBStateMonitor.onChangeSelection),
    vscode.window.onDidChangeActiveNotebookEditor(NBStateMonitor.onChangeActiveEditor),
  );
  if (vscode.window.activeNotebookEditor) {
    NBStateMonitor.onChangeActiveEditor(vscode.window.activeNotebookEditor);
  }
}

export function deactivate() {
  NBStateMonitor.monitors.forEach( monitor => monitor.watch = false );
  NBStateMonitor.monitors.clear();
}
