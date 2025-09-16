// src/sessionManager.ts
import { debug } from '../../common/debug.js';

/**
 * Generic session manager that stores arbitrary session data.
 * Doesn't know about the contents - that's up to the clients.
 */
export class SessionManager<T = any> {
  private _sessions = new Map<string, T>();

  /**
   * Get all active session IDs
   */
  public getActiveSessions(): string[] {
    return Array.from(this._sessions.keys());
  }
  
  /**
   * Get session data for the given session ID
   */
  public getSession(sessionId: string): T | undefined {
    const session = this._sessions.get(sessionId);
    if (session) {
      // log(`Retrieved existing session: ${sessionId}`);
    }
    return session;
  }

  /**
   * Set/update session data for the given session ID
   */
  public setSession(sessionId: string, sessionData: T): void {
    const isNew = !this._sessions.has(sessionId);
    this._sessions.set(sessionId, sessionData);
    // log(`${isNew ? 'Created' : 'Updated'} session: ${sessionId}`);
  }

  /**
   * Check if a session exists
   */
  public hasSession(sessionId: string): boolean {
    return this._sessions.has(sessionId);
  }

  /**
   * Rename a session when file path changes
   */
    public renameSession(oldSessionId: string, newSessionId: string): void {
      const session = this._sessions.get(oldSessionId);
      if (session) {
        this._sessions.set(newSessionId, session);
        this._sessions.delete(oldSessionId);
        // log(`Renamed session: ${oldSessionId} → ${newSessionId}`);
      }
    }
  
  /**
   * Clear session (called on kernel restart/shutdown)
   */
  public clearSession(sessionId: string): void {
    if (this._sessions.has(sessionId)) {
      this._sessions.delete(sessionId);
    }
  }
}
