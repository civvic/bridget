// Import required JupyterLab modules
// debugger;
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin  } from '@jupyterlab/application';
import { ICommandPalette } from '@jupyterlab/apputils';
import {
  // Cell, // No longer needed here
  // CodeCell, // No longer needed here
  INotebookTools,
  INotebookTracker,
  NotebookPanel // Import NotebookPanel
} from '@jupyterlab/notebook';

import { debug } from './common/debug.js';
import { NotebookMonitor } from './notebookMonitor.js';

const log = debug('ext', 'darkgreen');

/**
 * The command IDs used by the notebook plugin.
 */
const CommandIDs = {
  fetchNotebookJson: 'nbinspect-lab:fetch-notebook-json'
};

function setupCommands(app, palette, tracker) {
  /**
   * Command to fetch the notebook JSON.
   * @type {string}
   */
  const command = CommandIDs.fetchNotebookJson;

  // Add the command
  app.commands.addCommand(command, {
    label: 'Fetch Notebook JSON',
    execute: () => {
      const currentNotebook = tracker.currentWidget?.content;
      if (currentNotebook?.model) {
        const notebookJSON = currentNotebook.model.toJSON();
        console.log('Notebook JSON:', notebookJSON);
      } else {
        console.error('No active notebook or model found.');
      }
    }
  });

  // Add the command to the context menu
  app.contextMenu.addItem({
    command,
    selector: '.jp-Notebook',
    rank: 0
  });

  // Add the command to the Command Palette
  palette.addItem({
    command,
    category: 'Notebook Operations'
  });

  // Add the command to the notebook tools menu.
  // notebookTools.addItem({ // <-- Temporarily comment this out
  //   command,
  //   selector: '.jp-Notebook',
  //   rank: 0
  // });
}

/**
 * Initialization data for the nbinspect-lab extension.
 * @type {import('@jupyterlab/application').JupyterFrontEndPlugin<void>}
 */
const plugin = {
  id: 'nbinspect-lab:plugin',
  description: 'Expose notebook state and add commands.',
  autoStart: true,
  requires: [ICommandPalette, INotebookTracker, INotebookTools],

  /**
   * Activate the extension.
   * @param {JupyterFrontEnd} app - The JupyterLab front-end application.
   * @param {ICommandPalette} palette - The command palette for JupyterLab.
   * @param {INotebookTracker} tracker - The notebook tracker for JupyterLab.
   * @param {INotebookTools} notebookTools - The notebook tools for JupyterLab.
   */
  activate: (app, palette, tracker, notebookTools) => {
    log('JupyterLab extension nbinspect-lab is activated!');

    setupCommands(app, palette, tracker);

    /** Attach a global method to `window` for fetching the notebook JSON.
     * @returns {Object|null} The notebook JSON, or `null` if no active notebook is found.
     */
    window.getNotebookJSON = () => {
      const currentNotebook = tracker.currentWidget?.content;
      if (currentNotebook?.model) {
        return currentNotebook.model.toJSON();
      } else {
        console.error('No active notebook or model found.');
        return null;
      }
    };

    // --- Monitor Management ---
    /** @type {NotebookMonitor | null} */
    let activeMonitor = null;

    /**
     * Handler for when the currently active notebook panel changes.
     * @param {INotebookTracker} sender
     * @param {NotebookPanel | null} panel
     */
    const onActiveNotebookChanged = (sender, panel) => {
      log('Active notebook changed.');

      // Dispose the previous monitor if it exists
      if (activeMonitor && !activeMonitor.isDisposed) {
        activeMonitor.dispose();
        activeMonitor = null;
      }

      // Create a new monitor for the new panel if it exists
      if (panel) {
        // Wait for the panel's context to be ready
        panel.context.ready.then(() => {
          if (!panel.isDisposed) {
            activeMonitor = new NotebookMonitor(panel);
          }
        });
      }
    };

    // Connect to the tracker's signals
    tracker.currentChanged.connect(onActiveNotebookChanged);
    log('Connected to notebook tracker signals');

    // Handle any notebook that might be active at startup
    if (tracker.currentWidget) {
      onActiveNotebookChanged(tracker, tracker.currentWidget);
    }
  }
};

export default plugin;
