/**
 * Daemon client module
 * Handles communication with the browser-daemon process
 */

const net = require('net');
const fs = require('fs');

const DEFAULT_SOCKET_PATH = '/tmp/browser-daemon.sock';

/**
 * Check if daemon is running
 * @param {string} socketPath - Path to Unix socket
 * @returns {boolean} True if daemon is running
 */
function isDaemonRunning(socketPath = DEFAULT_SOCKET_PATH) {
  if (!fs.existsSync(socketPath)) {
    return false;
  }

  // Try to connect to verify it's actually running
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);

    socket.on('connect', () => {
      socket.end();
      resolve(true);
    });

    socket.on('error', () => {
      // Socket file exists but daemon isn't running
      // Clean up stale socket
      try {
        fs.unlinkSync(socketPath);
      } catch (e) {
        // Ignore cleanup errors
      }
      resolve(false);
    });

    // Timeout after 1 second
    setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1000);
  });
}

/**
 * Check if daemon is running (sync version)
 * Only checks if socket file exists, doesn't verify connectivity
 * @param {string} socketPath - Path to Unix socket
 * @returns {boolean} True if socket file exists
 */
function isDaemonRunningSync(socketPath = DEFAULT_SOCKET_PATH) {
  return fs.existsSync(socketPath);
}

/**
 * Send request to daemon and get response
 * @param {object} request - Request object to send
 * @param {string} socketPath - Path to Unix socket
 * @param {number} timeout - Timeout in ms (default: 60000)
 * @returns {Promise<object>} Response from daemon
 */
async function sendToDaemon(request, socketPath = DEFAULT_SOCKET_PATH, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let data = '';
    let timeoutId;

    socket.on('connect', () => {
      // Send request as JSON with newline delimiter
      socket.write(JSON.stringify(request) + '\n');
    });

    socket.on('data', (chunk) => {
      data += chunk.toString();
    });

    socket.on('end', () => {
      clearTimeout(timeoutId);
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error(`Invalid response from daemon: ${data}`));
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeoutId);
      if (err.code === 'ECONNREFUSED') {
        reject(new Error('Daemon is not running. Start it with: browser-daemon start'));
      } else if (err.code === 'ENOENT') {
        reject(new Error('Daemon socket not found. Start daemon with: browser-daemon start'));
      } else {
        reject(err);
      }
    });

    // Set timeout
    timeoutId = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Daemon request timed out after ${timeout}ms`));
    }, timeout);
  });
}

/**
 * Execute action(s) via daemon
 * @param {object} options - Execution options
 * @returns {Promise<object>} Execution result
 */
async function executeViaDaemon(options) {
  const {
    session,
    action,
    chain,
    url,
    noNavigate,
    viewport,
    spaMode,
    waitForIdle,
    timeout,
    socketPath = DEFAULT_SOCKET_PATH
  } = options;

  // Build actions array
  let actions;
  if (chain) {
    actions = typeof chain === 'string' ? JSON.parse(chain) : chain;
  } else {
    // Single action
    actions = [{
      action: action || 'screenshot',
      selector: options.selector,
      value: options.value,
      fullPage: options.fullPage,
      script: options.script,
      waitFor: options.waitFor,
      y: options.y,
      contains: options.contains,
      typingDelay: options.typingDelay
    }];
  }

  const request = {
    command: 'execute',
    session: session || 'default',
    actions,
    options: {
      url,
      noNavigate: noNavigate || false,
      viewport,
      spaMode,
      waitForIdle,
      timeout
    }
  };

  return sendToDaemon(request, socketPath, timeout || 60000);
}

/**
 * Get daemon status
 * @param {string} socketPath - Path to Unix socket
 * @returns {Promise<object>} Status information
 */
async function getDaemonStatus(socketPath = DEFAULT_SOCKET_PATH) {
  return sendToDaemon({ command: 'status' }, socketPath);
}

/**
 * List all active sessions
 * @param {string} socketPath - Path to Unix socket
 * @returns {Promise<object>} Sessions list
 */
async function listDaemonSessions(socketPath = DEFAULT_SOCKET_PATH) {
  return sendToDaemon({ command: 'list' }, socketPath);
}

/**
 * Close a specific session
 * @param {string} sessionId - Session to close
 * @param {string} socketPath - Path to Unix socket
 * @returns {Promise<object>} Close result
 */
async function closeDaemonSession(sessionId, socketPath = DEFAULT_SOCKET_PATH) {
  return sendToDaemon({ command: 'close', session: sessionId }, socketPath);
}

/**
 * Shutdown the daemon
 * @param {string} socketPath - Path to Unix socket
 * @returns {Promise<object>} Shutdown result
 */
async function shutdownDaemon(socketPath = DEFAULT_SOCKET_PATH) {
  return sendToDaemon({ command: 'shutdown' }, socketPath);
}

module.exports = {
  DEFAULT_SOCKET_PATH,
  isDaemonRunning,
  isDaemonRunningSync,
  sendToDaemon,
  executeViaDaemon,
  getDaemonStatus,
  listDaemonSessions,
  closeDaemonSession,
  shutdownDaemon
};
