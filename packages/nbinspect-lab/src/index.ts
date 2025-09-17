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
import { SessionManager } from './sessionManager.js';
import type { SessionState } from './types.js';
import { IRecentsManager } from '@jupyterlab/docmanager';

import { debug } from '../../common/debug.js';
const log = debug('nb:ext', 'blue');
const logError = debug('nb:ext:error', 'red');

/**
 * Wait for kernel to be in a ready state before creating monitor
 */
async function waitForKernelReady(panel: NotebookPanel): Promise<string | null> {
  const sessionContext = panel.sessionContext;
  if (!sessionContext) return null;
  if (sessionContext.kernelDisplayStatus === 'idle') {
    return sessionContext.session?.kernel?.id || null;
  }
  return new Promise((resolve) => {
    const onStatusChanged = () => {
      if (sessionContext.kernelDisplayStatus === 'idle') {
        sessionContext.statusChanged.disconnect(onStatusChanged);
        resolve(sessionContext.session?.kernel?.id || null);
      }
    };
    sessionContext.statusChanged.connect(onStatusChanged);
  });
}

/**
 * Handle changes in the recents manager to detect file renames (not working, Lab has bugs)
 */
function handleRecentsChanged(
  sessionManager: SessionManager<SessionState>,
  recentsManager: IRecentsManager,
): void {
  const activeSessions = sessionManager.getActiveSessions();
  if (activeSessions.length === 0) return;
  const recentPaths = new Set([
    ...recentsManager.recentlyOpened.map(r => r.path),
    ...recentsManager.recentlyClosed.map(r => r.path)
  ]);
  const orphanedSessions = activeSessions.filter(sessionId => !recentPaths.has(sessionId));
  if (orphanedSessions.length === 0) return;
  log(`Found ${orphanedSessions.length} orphaned sessions: ${orphanedSessions.join(', ')}`);
  orphanedSessions.forEach(oldPath => {
    sessionManager.clearSession(oldPath);
  });
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: '@bridget/lab-inspect:plugin',
  description: 'A JupyterLab extension for notebook state monitoring.',
  autoStart: true,
  requires: [INotebookTracker, IRenderMimeRegistry],
  optional: [IStatusBar, IRecentsManager],
  activate: (
    app: JupyterFrontEnd,
    notebookTracker: INotebookTracker,
    rendermime: IRenderMimeRegistry,
    statusBar?: IStatusBar,
    recentsManager?: IRecentsManager
  ) => {
    console.log('JupyterLab extension @bridget/lab-inspect is activated!');
    const sessionManager = new SessionManager<SessionState>();

    if (recentsManager) {
      recentsManager.changed.connect(() => {
        handleRecentsChanged(sessionManager, recentsManager);
      });
    }

    // Map to track monitors for each document context (not panels!)
    const monitors = new Map<string, NotebookMonitor>();
    let currentActiveMonitor: NotebookMonitor | null = null;

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

    const handleActiveNotebookChanged = (panel: NotebookPanel | null) => {
      if (currentActiveMonitor) {
        currentActiveMonitor.setInactive();
        currentActiveMonitor = null;
      }
      if (panel) {
        const contextPath = panel.context.path;
        const newMonitor = monitors.get(contextPath);
        if (newMonitor) {
          newMonitor.setActive();
          currentActiveMonitor = newMonitor;
        }
      }
      if (statusWidget) {
        statusWidget.onActiveNotebookChanged(panel, currentActiveMonitor);
      }
    };

    // Add the custom MIME type renderer factory
    rendermime.addFactory({
      safe: true,
      mimeTypes: [MIME_TYPE],
      createRenderer: options =>
        new NotebookStateMimeRenderer({ ...options })
    });

    async function createMonitorForPanel(panel: NotebookPanel) {
      const contextPath = panel.context.path;
      if (!monitors.has(contextPath)) {
        log(`=== SESSION: Creating monitor for new document: ${contextPath} ===`);
        // const kernelId = await waitForKernelReady(panel);
        // if (!kernelId) {
        //   log(`=== SESSION: No kernel found for document: ${contextPath} ===`);
        // }
        const monitor = new NotebookMonitor(panel.context, sessionManager);
        monitors.set(contextPath, monitor);
        log(`Monitor attached to document "${contextPath}" (session: "${monitor.sessionId}")`);
        panel.context.disposed.connect(() => {
          log(`=== SESSION: Document context disposed: ${contextPath} ===`);
          if (currentActiveMonitor === monitor) {
            handleActiveNotebookChanged(null);
          }
          monitor.dispose();
          if (monitors.get(contextPath) === monitor) {
            monitors.delete(contextPath);
          }
          log(`=== SESSION: Monitor disposed and removed for: ${contextPath} ===`);
        });
        log(`=== SESSION: Monitor created and registered for: ${contextPath} ===`);
      } else {
        log(`Document ${contextPath} already has monitor - multiple views detected`);
      }
      // Handle activation if this is current widget
      if (notebookTracker.currentWidget === panel) {
        handleActiveNotebookChanged(panel);
      }
    }

    // Listen for notebook panel creation to detect new contexts
    notebookTracker.widgetAdded.connect((sender, panel) => {
      const contextPath = panel.context.path;
      log(`Widget added for: ${contextPath}`);

      void panel.context.ready.then(() => {
        if (panel.isDisposed || panel.context.isDisposed || !panel.context.isReady) {
          log(`Skip monitor creation (disposed/not ready): ${contextPath}`);
          return;
        }
        createMonitorForPanel(panel);
      }).catch(error => {
        logError(`Context ready rejected for: ${contextPath}`, error);
        // Do not create a monitor on reject; Notebook may be routing to a stable panel next.
      });
    });
    
    // void app.restored.then(() => {
    //   log('App restored; scanning existing notebook panels');
    //   notebookTracker.forEach(panel => {
    //     if (!panel.isDisposed) {
    //       if (panel.context.isReady) createMonitorForPanel(panel);
    //       else void panel.context.ready.then(() => {
    //         if (!panel.isDisposed && !panel.context.isDisposed) createMonitorForPanel(panel);
    //       });
    //     }
    //   });
    //   handleActiveNotebookChanged(notebookTracker.currentWidget);
    // });

    notebookTracker.currentChanged.connect((sender, panel) => {
      handleActiveNotebookChanged(panel);
    });

  }
};

export default plugin;
