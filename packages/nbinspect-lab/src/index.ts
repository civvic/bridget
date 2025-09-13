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

    // Map to track monitors for each document context (not panels!)
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
        const contextPath = panel.context.path;
        const newMonitor = monitors.get(contextPath);
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

    // Listen for notebook panel creation - but only to detect new contexts
    notebookTracker.widgetAdded.connect((sender, panel) => {
      void panel.context.ready.then(() => {
        const contextPath = panel.context.path;
        
        // Check if we already have a monitor for this document context
        if (!monitors.has(contextPath)) {
          console.log(`Creating monitor for new document: ${contextPath}`);
          
          // Create monitor for this document context
          const monitor = new NotebookMonitor(panel.context);
          monitors.set(contextPath, monitor);

          // Listen for context disposal (when document is closed completely)
          panel.context.disposed.connect(() => {
            console.log(`Document context disposed: ${contextPath}`);
            
            // If disposing the active monitor, clear active state
            if (currentActiveMonitor === monitor) {
              handleActiveNotebookChanged(null);
            }
            
            // Dispose monitor and clean up
            monitor.dispose();
            monitors.delete(contextPath);
          });
        } else {
          console.log(`Document ${contextPath} already has monitor - multiple views detected`);
        }

        // If this is the active notebook, make its monitor active
        if (notebookTracker.currentWidget === panel) {
          handleActiveNotebookChanged(panel);
        }
      });
    });

    // Listen for active notebook changes
    notebookTracker.currentChanged.connect((sender, panel) => {
      handleActiveNotebookChanged(panel);
    });

  }
};

export default plugin;
