import { Widget } from '@lumino/widgets';
import type { NotebookPanel } from '@jupyterlab/notebook';
import type { NotebookMonitor } from '../notebookMonitor';
import type { DiffsMessage, StateMessage } from '../types';
// Import the common feedback renderer
import { renderStatusText } from '../../../common/feedbackRenderer.js';

const NBSTATE_STATUS_CLASS = 'jp-NotebookState-status';

/**
 * A widget for displaying notebook state in the status bar.
 */
export class NotebookStateStatusWidget extends Widget {
  private _stateChangedDisconnect: (() => void) | null = null;

  constructor() {
    super();
    this.addClass(NBSTATE_STATUS_CLASS);
    this.node.textContent = 'NBState: Ready';
    this._updateDisplay(null); // Set initial state
  }

  /**
   * Called by the plugin when the active notebook changes.
   * @param panel - The new active notebook panel (or null if none)
   * @param currentMonitor - The current active monitor (or null if none)
   */
  public onActiveNotebookChanged(
    panel: NotebookPanel | null,
    currentMonitor: NotebookMonitor | null
  ): void {
    // Disconnect from previous monitor
    if (this._stateChangedDisconnect) {
      this._stateChangedDisconnect();
      this._stateChangedDisconnect = null;
    }

    if (currentMonitor) {
      // Connect to this monitor's state changes
      currentMonitor.stateChanged.connect(this._onStateChanged, this);
      
      // Store disconnect function
      this._stateChangedDisconnect = () => {
        currentMonitor.stateChanged.disconnect(this._onStateChanged, this);
      };
    }
    
    this._updateDisplay(panel);
  }

  /**
   * Handle state changes from the active monitor.
   */
  private _onStateChanged(sender: NotebookMonitor, message: DiffsMessage | StateMessage): void {
    const statusText = renderStatusText(message);
    const span = this.node.querySelector('.jp-StatusBar-TextItem') as HTMLElement;
    if (span) {
      span.textContent = statusText;
      span.title = statusText;
    }
    
    // Add flash animation
    this.node.classList.add('jp-mod-highlighted');
    setTimeout(() => this.node.classList.remove('jp-mod-highlighted'), 800);
  }

  /**
   * Update the display based on the current active notebook.
   */
  private _updateDisplay(panel: NotebookPanel | null): void {
    const text = panel 
      ? `NBState: Monitoring ${panel.context.path.split('/').pop()}`
      : 'NBState: No active notebook';
    
    // Create proper status bar structure
    this.node.innerHTML = `<span class="jp-StatusBar-TextItem" title="${text}" tabindex="0">${text}</span>`;
    
    if (panel) {
      this.show();
    } else {
      this.hide();
    }
  }

  /**
   * Dispose of the status widget.
   */
  dispose(): void {
    // Disconnect from current monitor
    if (this._stateChangedDisconnect) {
      this._stateChangedDisconnect();
      this._stateChangedDisconnect = null;
    }
    super.dispose();
  }
}
