/**
 * Server session tracking.
 * Each server restart generates a new session ID.
 * Clients can use this to detect server restarts and reset their state.
 */

const SESSION_KEY = Symbol.for("smart_home_server_session");

interface GlobalWithSession {
  [SESSION_KEY]?: string;
}

function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get the current server session ID.
 * This is generated once when the module is first loaded.
 */
export function getServerSessionId(): string {
  const globalObj = globalThis as GlobalWithSession;
  if (!globalObj[SESSION_KEY]) {
    globalObj[SESSION_KEY] = generateSessionId();
    console.log(`[Server] New session ID: ${globalObj[SESSION_KEY]}`);
  }
  return globalObj[SESSION_KEY];
}

