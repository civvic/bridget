import { Widget } from '@lumino/widgets';
import { INotebookTracker } from '@jupyterlab/notebook';
import { NotebookStateManager } from '../stateManager';
import type { DiffsMessage, StateMessage } from '../types';
// Import the common feedback renderer
import { renderStatusText } from '../common/feedbackRenderer.js';

const NBSTATE_STATUS_CLASS = 'jp-NotebookState-status';

/**
 * A widget for displaying notebook state in the status bar.
 */
export class NotebookStateStatusWidget extends Widget {
  private _stateManager: NotebookStateManager;
  private _notebookTracker: INotebookTracker;

  constructor(
    stateManager: NotebookStateManager,
    notebookTracker: INotebookTracker
  ) {
    super();
    this.addClass(NBSTATE_STATUS_CLASS);
    this.node.textContent = 'NBState: Ready';

    this._stateManager = stateManager;
    this._notebookTracker = notebookTracker;

    this._stateManager.stateChanged.connect(this._onStateChanged, this);
    this._notebookTracker.currentChanged.connect(this._onActiveNotebookChanged, this);

    this._onActiveNotebookChanged(); // Set initial state
  }

  /**
   * Handle state changes from the state manager.
   */
  private _onStateChanged(
    sender: NotebookStateManager,
    message: DiffsMessage | StateMessage | null
  ): void {
    if (!message || message.origin !== this._notebookTracker.currentWidget?.context.path) {
      return; // Ignore if message is for a non-active notebook
    }
    
    // Use the common feedback renderer for consistent status text
    this.node.textContent = renderStatusText(message);

    // Add a flash animation to indicate an update
    this.node.classList.add('jp-mod-highlighted');
    setTimeout(() => this.node.classList.remove('jp-mod-highlighted'), 800);
  }

  /**
   * Update the status when the active notebook changes.
   */
  private _onActiveNotebookChanged(): void {
    const current = this._notebookTracker.currentWidget;
    if (current) {
        this.node.textContent = `NBState: Monitoring ${current.context.path.split('/').pop()}`;
        this.show();
    } else {
        this.node.textContent = 'NBState: No active notebook';
        this.hide();
    }
  }

  dispose() {
    this._stateManager.stateChanged.disconnect(this._onStateChanged, this);
    this._notebookTracker.currentChanged.disconnect(this._onActiveNotebookChanged, this);
    super.dispose();
  }
} 