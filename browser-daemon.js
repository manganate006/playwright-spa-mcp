#!/usr/bin/env node
/**
 * Browser Daemon
 * Persistent browser process that maintains session state between CLI calls
 *
 * Usage:
 *   browser-daemon start     - Start the daemon in background
 *   browser-daemon stop      - Stop the daemon
 *   browser-daemon status    - Show daemon status
 *   browser-daemon restart   - Restart the daemon
 */

const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { SessionManager } = require('./lib/session-manager');

const SOCKET_PATH = '/tmp/browser-daemon.sock';
const PID_FILE = '/tmp/browser-daemon.pid';
const LOG_FILE = '/tmp/browser-daemon.log';

// Parse command line arguments
const command = process.argv[2] || 'run';

/**
 * Log message with timestamp
 */
function log(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}`;
  console.log(logLine);

  // Also write to log file
  try {
    fs.appendFileSync(LOG_FILE, logLine + '\n');
  } catch (e) {
    // Ignore log file errors
  }
}

/**
 * Handle daemon commands
 */
async function handleCommand(command) {
  switch (command) {
    case 'start':
      await startDaemon();
      break;

    case 'stop':
      await stopDaemon();
      break;

    case 'status':
      await showStatus();
      break;

    case 'restart':
      await stopDaemon();
      await new Promise(r => setTimeout(r, 1000));
      await startDaemon();
      break;

    case 'run':
      // Run in foreground (used when spawning)
      await runDaemon();
      break;

    default:
      console.log('Usage: browser-daemon <start|stop|status|restart>');
      process.exit(1);
  }
}

/**
 * Start daemon in background
 */
async function startDaemon() {
  // Check if already running
  if (fs.existsSync(SOCKET_PATH)) {
    try {
      const response = await sendRequest({ command: 'ping' });
      if (response.pong) {
        console.log('Daemon is already running');
        return;
      }
    } catch (e) {
      // Socket exists but daemon not responding, clean up
      fs.unlinkSync(SOCKET_PATH);
    }
  }

  console.log('Starting browser daemon...');

  // Spawn daemon process
  const daemon = spawn(process.execPath, [__filename, 'run'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore']
  });

  daemon.unref();

  // Wait for daemon to start
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (fs.existsSync(SOCKET_PATH)) {
      console.log('Daemon started successfully');
      console.log(`Socket: ${SOCKET_PATH}`);
      console.log(`PID: ${daemon.pid}`);
      return;
    }
  }

  console.error('Failed to start daemon');
  process.exit(1);
}

/**
 * Stop the daemon
 */
async function stopDaemon() {
  if (!fs.existsSync(SOCKET_PATH)) {
    console.log('Daemon is not running');
    return;
  }

  try {
    console.log('Stopping daemon...');
    await sendRequest({ command: 'shutdown' });
    console.log('Daemon stopped');
  } catch (e) {
    console.log('Daemon not responding, cleaning up...');
    if (fs.existsSync(SOCKET_PATH)) {
      fs.unlinkSync(SOCKET_PATH);
    }
  }

  // Also try to kill by PID
  if (fs.existsSync(PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'));
      process.kill(pid, 'SIGTERM');
    } catch (e) {
      // Process might already be dead
    }
    fs.unlinkSync(PID_FILE);
  }
}

/**
 * Show daemon status
 */
async function showStatus() {
  if (!fs.existsSync(SOCKET_PATH)) {
    console.log('Daemon is not running');
    return;
  }

  try {
    const response = await sendRequest({ command: 'status' });
    console.log('Daemon Status:');
    console.log(`  Active Sessions: ${response.activeSessions}`);
    console.log(`  Max Sessions: ${response.maxSessions}`);
    console.log(`  Idle Timeout: ${response.idleTimeout / 1000}s`);

    if (response.sessions && response.sessions.length > 0) {
      console.log('\nSessions:');
      for (const session of response.sessions) {
        const idle = Math.round(session.idle / 1000);
        console.log(`  - ${session.id}: ${session.currentUrl || '(no URL)'} (idle: ${idle}s)`);
      }
    }
  } catch (e) {
    console.log('Daemon is not responding');
    console.log('Socket file exists but daemon may have crashed');
  }
}

/**
 * Send request to daemon
 */
function sendRequest(request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCKET_PATH);
    let data = '';

    socket.on('connect', () => {
      socket.write(JSON.stringify(request) + '\n');
    });

    socket.on('data', (chunk) => {
      data += chunk.toString();
    });

    socket.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('Invalid response'));
      }
    });

    socket.on('error', reject);

    setTimeout(() => {
      socket.destroy();
      reject(new Error('Timeout'));
    }, 5000);
  });
}

/**
 * Run the daemon (foreground mode)
 */
async function runDaemon() {
  // Clean up stale socket
  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH);
  }

  // Write PID file
  fs.writeFileSync(PID_FILE, process.pid.toString());

  log('Browser daemon starting...');

  // Create session manager
  const manager = new SessionManager({
    idleTimeout: 300000, // 5 minutes
    maxSessions: 10,
    debugLog: log
  });

  // Create Unix socket server
  const server = net.createServer(async (socket) => {
    let data = '';

    socket.on('data', (chunk) => {
      data += chunk.toString();

      // Check for complete message (newline-terminated)
      if (data.includes('\n')) {
        const lines = data.split('\n');
        data = lines.pop(); // Keep incomplete line

        for (const line of lines) {
          if (line.trim()) {
            handleRequest(line, socket, manager);
          }
        }
      }
    });

    socket.on('error', (err) => {
      log(`Socket error: ${err.message}`);
    });
  });

  // Handle server errors
  server.on('error', (err) => {
    log(`Server error: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
      log('Socket already in use, cleaning up...');
      fs.unlinkSync(SOCKET_PATH);
      server.listen(SOCKET_PATH);
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    log('Shutting down...');
    server.close();
    await manager.closeAll();
    if (fs.existsSync(SOCKET_PATH)) {
      fs.unlinkSync(SOCKET_PATH);
    }
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
    log('Daemon stopped');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGHUP', shutdown);

  // Handle uncaught errors
  process.on('uncaughtException', (err) => {
    log(`Uncaught exception: ${err.message}`);
    log(err.stack);
  });

  process.on('unhandledRejection', (reason) => {
    log(`Unhandled rejection: ${reason}`);
  });

  // Start listening
  server.listen(SOCKET_PATH, () => {
    // Set socket permissions
    fs.chmodSync(SOCKET_PATH, 0o666);
    log(`Daemon listening on ${SOCKET_PATH}`);
  });
}

/**
 * Handle incoming request
 */
async function handleRequest(requestStr, socket, manager) {
  let request;
  try {
    request = JSON.parse(requestStr);
  } catch (e) {
    sendResponse(socket, { success: false, error: 'Invalid JSON' });
    return;
  }

  const { command } = request;
  log(`Received command: ${command}`);

  try {
    switch (command) {
      case 'ping':
        sendResponse(socket, { pong: true });
        break;

      case 'status':
        sendResponse(socket, manager.getStatus());
        break;

      case 'list':
        sendResponse(socket, { sessions: manager.listSessions() });
        break;

      case 'execute':
        const result = await manager.execute(
          request.session || 'default',
          request.actions,
          request.options || {}
        );
        sendResponse(socket, result);
        break;

      case 'close':
        await manager.closeSession(request.session);
        sendResponse(socket, { success: true, message: `Session ${request.session} closed` });
        break;

      case 'shutdown':
        sendResponse(socket, { success: true, message: 'Shutting down' });
        // Give time for response to be sent
        setTimeout(async () => {
          await manager.closeAll();
          if (fs.existsSync(SOCKET_PATH)) {
            fs.unlinkSync(SOCKET_PATH);
          }
          if (fs.existsSync(PID_FILE)) {
            fs.unlinkSync(PID_FILE);
          }
          process.exit(0);
        }, 100);
        break;

      default:
        sendResponse(socket, { success: false, error: `Unknown command: ${command}` });
    }
  } catch (error) {
    log(`Error handling request: ${error.message}`);
    sendResponse(socket, { success: false, error: error.message });
  }
}

/**
 * Send response to client
 */
function sendResponse(socket, response) {
  try {
    socket.write(JSON.stringify(response));
    socket.end();
  } catch (e) {
    // Socket might be already closed
  }
}

// Run command
handleCommand(command).catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
