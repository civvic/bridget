import { Widget } from '@lumino/widgets';
import type { IRenderMime } from '@jupyterlab/rendermime';
import type { NotebookStateManager } from '../stateManager';
import type { JSONObject } from '@lumino/coreutils';
// Import the common feedback renderer
import { renderNBStateFeedback } from '../common/feedbackRenderer.js';
import { debug } from '../common/debug.js';

export const MIME_TYPE = 'application/x-notebook-state';

/**
 * A custom renderer for the 'application/x-notebook-state' MIME type.
 * It handles configuration messages from Python and displays rich feedback.
 */
export class NotebookStateMimeRenderer
  extends Widget
  implements IRenderMime.IRenderer
{
  private _mimeType: string;
  private _stateManager: NotebookStateManager;
  private _options: any = { feedback: true, hide: false, debug: false };

  constructor(options: {
    mimeType: string;
    stateManager: NotebookStateManager;
  }) {
    super();
    this._mimeType = options.mimeType;
    this._stateManager = options.stateManager;
    
    // Set up initial display
    this.node.innerHTML = '<div>NBState Renderer: Waiting for data...</div>';
    
    // Listen for state changes to display feedback
    this._stateManager.stateChanged.connect(this._onStateChanged, this);
  }

  /**
   * Handle state changes from the state manager.
   */
  private _onStateChanged(
    sender: NotebookStateManager,
    message: any
  ): void {
    if (message && this._options.feedback) {
      // Use the common feedback renderer to display rich feedback
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
      
      // Update display with current state if available
      const currentState = this._stateManager.currentState;
      if (currentState) {
        const feedbackHTML = renderNBStateFeedback(currentState, this._options);
        this.node.innerHTML = feedbackHTML;
      }
      // if (currentState && this._options.feedback) {
      //   const feedbackHTML = renderNBStateFeedback(currentState, this._options);
      //   this.node.innerHTML = feedbackHTML;
      // } else {
      //   this.node.innerHTML = `
      //     <div>
      //       <h4>NBState Configuration Updated</h4>
      //       <p>Options: ${JSON.stringify(this._options, null, 2)}</p>
      //       ${this._options.feedback ? '<p>Feedback enabled - waiting for notebook changes...</p>' : '<p>Feedback disabled</p>'}
      //     </div>
      //   `;
      // }
    }

    return Promise.resolve();
  }

  /**
   * Dispose of the renderer.
   */
  dispose(): void {
    this._stateManager.stateChanged.disconnect(this._onStateChanged, this);
    super.dispose();
  }
} 