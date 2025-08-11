import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IStatusBar } from '@jupyterlab/statusbar';
import { INotebookTracker } from '@jupyterlab/notebook';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { NotebookStateManager } from './stateManager.js';
import { NotebookMonitor } from './notebookMonitor.js';
import { NotebookStateStatusWidget } from './widgets/statusWidget.js';
import {
  MIME_TYPE,
  NotebookStateMimeRenderer
} from './widgets/mimeRenderer.js';
import type { NBStateAPI, DiffsMessage, StateMessage } from './types.js';

/**
 * The plugin registration information.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: '@bridget/lab-inspect:plugin',
  description: 'A JupyterLab extension for notebook state monitoring.',
  autoStart: true,
  requires: [INotebookTracker, IStatusBar, IRenderMimeRegistry],
  activate: (
    app: JupyterFrontEnd,
    notebookTracker: INotebookTracker,
    statusBar: IStatusBar,
    rendermime: IRenderMimeRegistry
  ) => {
    console.log('JupyterLab extension @bridget/lab-inspect is activated!');

    const stateManager = new NotebookStateManager();
    
    // Create global API similar to VSCode extension's $Ren
    const nbStateAPI: NBStateAPI = {
      addStateObserver: (callback: (state: DiffsMessage | StateMessage) => void) => {
        return stateManager.addStateObserver(callback);
      },
      getNBState: () => {
        return stateManager.currentState;
      },
      update: (message: any) => {
        // For compatibility with VSCode widgets, but not used in Lab
        console.log('NBState API update called (Lab extension):', message);
      }
    };
    
    // Make the API globally accessible for widgets and other components
    (window as any).$Ren = nbStateAPI;
    // Also make the state manager available (for internal use)
    (window as any).$NotebookState = stateManager;

    // Add the custom MIME type renderer.
    rendermime.addFactory({
      safe: true,
      mimeTypes: [MIME_TYPE],
      createRenderer: options =>
        new NotebookStateMimeRenderer({
          ...options,
          stateManager
        })
    });

    // Create and add the status bar widget
    const statusWidget = new NotebookStateStatusWidget(
      stateManager,
      notebookTracker
    );
    statusBar.registerStatusItem(plugin.id, {
      align: 'left',
      item: statusWidget,
      rank: 2
    });

    // Map to track monitors for each notebook
    const monitors = new Map<string, NotebookMonitor>();

    // Listen for notebook creation
    notebookTracker.widgetAdded.connect((sender, panel) => {
      const id = panel.id;
      console.log(`Notebook added, waiting for context to be ready: ${id}`);

      void panel.context.ready.then(() => {
        console.log(`Notebook context ready: ${id}`);
        // Create monitor for this notebook, passing the state manager
        const monitor = new NotebookMonitor(panel, stateManager);
        monitors.set(id, monitor);

        // Listen for this specific panel's disposal
        panel.disposed.connect(() => {
          console.log(`Notebook disposed: ${id}`);

          // Dispose monitor for this notebook
          const monitor = monitors.get(id);
          if (monitor) {
            monitor.dispose();
            monitors.delete(id);
          }
        });
      });
    });

    // Clean up on app shutdown
    app.restored.then(() => {
      console.log('Lab inspect extension: App restored');
    });
  }
};

export default plugin; 