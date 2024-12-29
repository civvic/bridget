import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { INotebookTracker } from '@jupyterlab/notebook';

import { ICommandPalette } from '@jupyterlab/apputils'; // Import for the palette

/**
 * Initialization data for the nbinspect-lab extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'nbinspect-lab:plugin',
  description: 'Expose notebook state and add commands.',
  autoStart: true,
  requires: [INotebookTracker, ICommandPalette],
  activate: (
    app: JupyterFrontEnd,
    notebookTracker: INotebookTracker,
    palette: ICommandPalette
  ) => {
    console.log('JupyterLab extension nbinspect-lab is activated!');

    // Add a command to fetch notebook JSON
    const command = 'nbinspect-lab:fetch-notebook-json';
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
      category: 'Notebook Operations' // Customize the category name
    });

    // Attach a global method to window for fetching the current notebook JSON
    (window as any).getNotebookJSON = () => {
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
