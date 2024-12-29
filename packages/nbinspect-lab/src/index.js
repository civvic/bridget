// Import required JupyterLab modules
import { INotebookTracker } from '@jupyterlab/notebook';
import { ICommandPalette } from '@jupyterlab/apputils';

/**
 * Initialization data for the nbinspect-lab extension.
 * @type {import('@jupyterlab/application').JupyterFrontEndPlugin<void>}
 */
const plugin = {
  id: 'nbinspect-lab:plugin',
  description: 'Expose notebook state and add commands.',
  autoStart: true,
  requires: [INotebookTracker, ICommandPalette],

  /**
   * Activate the extension.
   * @param {JupyterFrontEnd} app - The JupyterLab front-end application.
   * @param {INotebookTracker} notebookTracker - Tracks the state of notebooks.
   * @param {ICommandPalette} palette - The command palette for JupyterLab.
   */
  activate: (app, notebookTracker, palette) => {
    console.log('JupyterLab extension nbinspect-lab is activated!');

    /**
     * Command to fetch the notebook JSON.
     * @type {string}
     */
    const command = 'nbinspect-lab:fetch-notebook-json';

    // Add the command
    app.commands.addCommand(command, {
      label: 'Fetch Notebook JSON',
      execute: () => {
        const currentNotebook = notebookTracker.currentWidget?.content;
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

    /**
     * Attach a global method to `window` for fetching the notebook JSON.
     * @returns {Object|null} The notebook JSON, or `null` if no active notebook is found.
     */
    window.getNotebookJSON = () => {
      const currentNotebook = notebookTracker.currentWidget?.content;
      if (currentNotebook?.model) {
        return currentNotebook.model.toJSON();
      } else {
        console.error('No active notebook or model found.');
        return null;
      }
    };
  }
};

export default plugin;
