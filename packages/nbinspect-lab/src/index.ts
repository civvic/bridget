// src/index.ts
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IStatusBar } from '@jupyterlab/statusbar';
import { INotebookTracker } from '@jupyterlab/notebook';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { NotebookMonitor } from './notebookMonitor.js';
import { NotebookStateStatusWidget } from './widgets/statusWidget.js';
import {
  MIME_TYPE,
  NotebookStateMimeRenderer
} from './widgets/mimeRenderer.js';
import type { NotebookPanel } from '@jupyterlab/notebook';

import { debug } from '../../common/debug.js';
const log = debug('nb:ext', 'blue');
const logError = debug('nb:ext:error', 'red');

/**
 * The plugin registration information.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: '@bridget/lab-inspect:plugin',
  description: 'A JupyterLab extension for notebook state monitoring.',
  autoStart: true,
  requires: [INotebookTracker, IRenderMimeRegistry],
  optional: [IStatusBar],
  activate: (
    app: JupyterFrontEnd,
    notebookTracker: INotebookTracker,
    rendermime: IRenderMimeRegistry,
    statusBar?: IStatusBar
  ) => {
    console.log('JupyterLab extension @bridget/lab-inspect is activated!');

    // Map to track monitors for each notebook
    const monitors = new Map<string, NotebookMonitor>();
    
    // Track currently active monitor
    let currentActiveMonitor: NotebookMonitor | null = null;

    // Create status widget only if status bar is available
    let statusWidget: NotebookStateStatusWidget | null = null;
    if (statusBar) {
      statusWidget = new NotebookStateStatusWidget();
      statusBar.registerStatusItem(plugin.id, {
        align: 'left',
        item: statusWidget,
        rank: 2
      });
      console.log('Status bar widget created');
    } else {
      console.log('Status bar not available - running without status widget (Notebook 7 mode)');
    }

    /**
     * Handle active notebook changes
     */
    const handleActiveNotebookChanged = (panel: NotebookPanel | null) => {
      // 1. Deactivate current monitor (if any)
      if (currentActiveMonitor) {
        currentActiveMonitor.setInactive();
        currentActiveMonitor = null;
      }
      
      // 2. Activate new monitor (if any)
      if (panel) {
        const newMonitor = monitors.get(panel.id);
        if (newMonitor) {
          newMonitor.setActive();
          currentActiveMonitor = newMonitor;
        }
      }
      
      // 3. Notify status widget (only if it exists)
      if (statusWidget) {
        statusWidget.onActiveNotebookChanged(panel, currentActiveMonitor);
      }
    };

    // Add the custom MIME type renderer factory
    rendermime.addFactory({
      safe: true,
      mimeTypes: [MIME_TYPE],
      createRenderer: options =>
        new NotebookStateMimeRenderer({
          ...options,
          // No stateManager needed - renderer will use window.$Nb
        })
    });

    // Listen for notebook creation
    notebookTracker.widgetAdded.connect((sender, panel) => {
      const id = panel.id;
      console.log(`Notebook added, waiting for context to be ready: ${id}`);

      void panel.context.ready.then(() => {
        console.log(`Notebook context ready: ${id}`);
        
        // Create monitor for this notebook (no stateManager needed)
        const monitor = new NotebookMonitor(panel);
        monitors.set(id, monitor);

        // If this is the first/only notebook, make it active
        if (monitors.size === 1 || notebookTracker.currentWidget === panel) {
          handleActiveNotebookChanged(panel);
        }

        // Listen for this specific panel's disposal
        panel.disposed.connect(() => {
          console.log(`Notebook disposed: ${id}`);

          // If disposing the active monitor, clear active state
          if (currentActiveMonitor === monitor) {
            handleActiveNotebookChanged(null);
          }

          // Dispose monitor for this notebook
          monitor.dispose();
          monitors.delete(id);
        });
      });
    });

    // Listen for active notebook changes
    notebookTracker.currentChanged.connect((sender, panel) => {
      handleActiveNotebookChanged(panel);
    });

    // Clean up on app shutdown
    app.restored.then(() => {
      console.log('Lab inspect extension: App restored');
    });
  }
};

export default plugin;
