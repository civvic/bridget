import { Widget } from '@lumino/widgets';
import type { IRenderMime } from '@jupyterlab/rendermime';
import type { JSONObject } from '@lumino/coreutils';
// Import the common feedback renderer
import { renderNBStateFeedback } from '../../../common/feedbackRenderer.js';
import { debug } from '../../../common/debug.js';
import type { DiffsMessage, StateMessage, MIMEMessage } from '../types';

export const MIME_TYPE = 'application/x-notebook-state+json';

/**
 * A custom renderer for the 'application/x-notebook-state+json' MIME type.
 * It handles configuration messages from Python and displays rich feedback.
 */
export class NotebookStateMimeRenderer
  extends Widget
  implements IRenderMime.IRenderer
{
  private _mimeType: string;
  private _options: any = { feedback: true, hide: false, debug: true };
  private _stateObserverDisconnect: (() => void) | null = null;

  constructor(options: {
    mimeType: string;
  }) {
    super();
    this._mimeType = options.mimeType;
    // Set up initial display
    this.node.innerHTML = '<div>NBState Renderer: Waiting for data...</div>';
    // Subscribe to state changes via window.$Nb (like Python widgets do)
    this._subscribeToStateChanges();
  }

  /**
   * Subscribe to state changes using the global $Nb API
   */
  private _subscribeToStateChanges(): void {
    // Check if $Nb is available (active notebook monitor sets it up)
    const $Nb = (window as any).$Nb;
    if ($Nb && $Nb.addStateObserver) {
      this._stateObserverDisconnect = $Nb.addStateObserver(
        (state: DiffsMessage | StateMessage) => {
          this._onStateChanged(state);
        }
      );
    } else {
      // $Nb not available yet, try again later
      setTimeout(() => this._subscribeToStateChanges(), 100);
    }
  }

  /**
   * Handle state changes from the active notebook's monitor
   */
  private _onStateChanged(message: DiffsMessage | StateMessage): void {
    if (message) {
      const feedbackHTML = renderNBStateFeedback(message, this._options);
      this.node.innerHTML = feedbackHTML;
    }
  }

  /**
   * Render the mime model.
   * @param model - The mime model to render.
   * @returns A promise that resolves when rendering is complete.
   */
  renderModel(model: IRenderMime.IMimeModel): Promise<void> {
    const data = model.data[this._mimeType] as JSONObject;
    if (data) {
      debug.enabled && console.log('Received data for custom MIME renderer:', data);
      // Handle configuration from Python
      if (typeof data.feedback === 'boolean') {
        this._options.feedback = data.feedback;
      }
      if (typeof data.hide === 'boolean') {
        this._options.hide = data.hide;
      }
      if (typeof data.debug === 'boolean') {
        this._options.debug = data.debug;
        debug.enable('nb:*', this._options.debug);
      }
      if (typeof data.update === 'string') {
        if (data.update === 'full') {
          const $Nb = (window as any).$Nb;
            if ($Nb && $Nb.update) {
              $Nb.update(data);
            }
        }
      }
      // Note: don't render current state here to avoid double rendering
      // _onStateChanged will handle it when state changes of this cell occur
    }
    return Promise.resolve();
  }

  dispose(): void {
    if (this._stateObserverDisconnect) {
      this._stateObserverDisconnect();
      this._stateObserverDisconnect = null;
    }
    super.dispose();
  }
}
