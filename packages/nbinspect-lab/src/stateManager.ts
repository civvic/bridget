import { ISignal, Signal } from '@lumino/signaling';
import type { DiffsMessage, StateMessage } from './types';

/**
 * Manages the state of a notebook and emits signals when it changes.
 * This allows other parts of the extension to observe notebook state.
 */
export class NotebookStateManager {
  private _stateChanged = new Signal<this, DiffsMessage | StateMessage>(this);
  private _currentState: DiffsMessage | StateMessage | null = null;

  /**
   * A signal emitted when the notebook state changes.
   */
  get stateChanged(): ISignal<this, DiffsMessage | StateMessage> {
    return this._stateChanged;
  }

  /**
   * The current state of the notebook.
   */
  get currentState(): DiffsMessage | StateMessage | null {
    return this._currentState;
  }

  /**
   * Updates the state and emits a change signal.
   * @param message - The new state or diff message.
   */
  public updateState(message: DiffsMessage | StateMessage): void {
    this._currentState = message;
    this._stateChanged.emit(message);
  }

  /**
   * Provides a way for other components (e.g., Python widgets) to
   * subscribe to state changes.
   * @param callback - The function to call when the state changes.
   * @returns A function to unsubscribe the callback.
   */
  public addStateObserver(
    callback: (state: DiffsMessage | StateMessage) => void
  ): () => void {
    const slot = (sender: this, state: DiffsMessage | StateMessage) =>
      callback(state);
    this._stateChanged.connect(slot);
    return () => this._stateChanged.disconnect(slot);
  }
} 