#!/usr/bin/env node
/**
 * Playwright Browser CLI Tool for Claude Code
 *
 * Usage:
 *   browser-screenshot --action screenshot --url "https://example.com"
 *   browser-screenshot --action click --selector "button.submit" --session mysession
 *   browser-screenshot --action fill --selector "input[name=email]" --value "test@test.com"
 *   browser-screenshot --chain '[{"action":"fill","selector":"input","value":"test"}]' --url "..."
 *   browser-screenshot --daemon --session s1 --action screenshot
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Import modules
const { actions, SCREENSHOTS_DIR } = require('./lib/actions');
const { loadSession, saveSession, restoreLocalStorage } = require('./lib/session');
const { withRetry } = require('./lib/retry');
const { executeChain, parseChain, validateChain, listAvailableActions } = require('./lib/chain-executor');
const { waitForSpaStable, waitForDomIdle } = require('./lib/spa-utils');
const { isDaemonRunningSync, executeViaDaemon, DEFAULT_SOCKET_PATH } = require('./lib/daemon-client');
const { resolveDevice, listDevices, searchDevices } = require('./lib/devices');
const { httpActions } = require('./lib/http-actions');

// Configuration
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const DEFAULT_TIMEOUT = 30000;

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

/**
 * Parse command line arguments
 */
function parseArgs(argv) {
  const args = {
    action: 'screenshot',
    url: null,
    selector: null,
    value: null,
    session: null,
    fullPage: false,
    waitFor: null,
    timeout: DEFAULT_TIMEOUT,
    viewport: { ...DEFAULT_VIEWPORT },
    script: null,
    y: 0,
    x: 0,
    // Chain & retry options
    chain: null,
    chainFile: null,
    retry: 0,
    retryDelay: 1000,
    debug: false,
    trace: false,
    traceDir: null,
    spaMode: null,
    waitForIdle: null,
    typingDelay: 50,
    contains: false,
    daemon: false,
    noNavigate: false,
    socketPath: DEFAULT_SOCKET_PATH,
    // Device emulation
    device: null,
    userAgent: null,
    // iFrame support
    frame: null,
    // File upload
    file: null,
    files: null,
    // Drag & drop
    target: null,
    // HTTP options
    httpUrl: null,
    httpMethod: null,
    httpBody: null,
    httpHeaders: null,
    bearerToken: null,
    urlPattern: null,
    // Additional options
    attribute: null
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case '--action':
        args.action = next;
        i++;
        break;
      case '--url':
        args.url = next;
        i++;
        break;
      case '--selector':
        args.selector = next;
        i++;
        break;
      case '--value':
        args.value = next;
        i++;
        break;
      case '--session':
        args.session = next;
        i++;
        break;
      case '--full-page':
        args.fullPage = true;
        break;
      case '--wait-for':
        args.waitFor = next;
        i++;
        break;
      case '--timeout':
        args.timeout = parseInt(next);
        i++;
        break;
      case '--width':
        args.viewport.width = parseInt(next);
        i++;
        break;
      case '--height':
        args.viewport.height = parseInt(next);
        i++;
        break;
      case '--script':
        args.script = next;
        i++;
        break;
      case '--y':
        args.y = parseInt(next);
        i++;
        break;
      // New options
      case '--chain':
        args.chain = next;
        i++;
        break;
      case '--chain-file':
        args.chainFile = next;
        i++;
        break;
      case '--retry':
        args.retry = parseInt(next);
        i++;
        break;
      case '--retry-delay':
        args.retryDelay = parseInt(next);
        i++;
        break;
      case '--debug':
        args.debug = true;
        break;
      case '--trace':
        args.trace = true;
        break;
      case '--trace-dir':
        args.traceDir = next;
        i++;
        break;
      case '--spa-mode':
        args.spaMode = next;
        i++;
        break;
      case '--wait-for-idle':
        args.waitForIdle = next ? parseInt(next) : 500;
        if (next && !next.startsWith('-')) i++;
        break;
      case '--typing-delay':
        args.typingDelay = parseInt(next);
        i++;
        break;
      case '--contains':
        args.contains = true;
        break;
      case '--daemon':
        args.daemon = true;
        break;
      case '--no-navigate':
        args.noNavigate = true;
        break;
      case '--socket-path':
        args.socketPath = next;
        i++;
        break;
      // Device emulation
      case '--device':
        args.device = next;
        i++;
        break;
      case '--user-agent':
        args.userAgent = next;
        i++;
        break;
      // iFrame support
      case '--frame':
        args.frame = next;
        i++;
        break;
      // File upload
      case '--file':
        args.file = next;
        i++;
        break;
      case '--files':
        args.files = next.split(',');
        i++;
        break;
      // Drag & drop
      case '--target':
        args.target = next;
        i++;
        break;
      // Offset for drag
      case '--x':
        args.x = parseInt(next);
        i++;
        break;
      // HTTP options
      case '--http-url':
        args.httpUrl = next;
        i++;
        break;
      case '--http-method':
        args.httpMethod = next;
        i++;
        break;
      case '--http-body':
        args.httpBody = next;
        i++;
        break;
      case '--http-headers':
        args.httpHeaders = next;
        i++;
        break;
      case '--bearer-token':
        args.bearerToken = next;
        i++;
        break;
      case '--url-pattern':
        args.urlPattern = next;
        i++;
        break;
      // Additional options
      case '--attribute':
        args.attribute = next;
        i++;
        break;
      case '--help':
        printHelp();
        process.exit(0);
        break;
      case '--list-actions':
        const actionList = listAvailableActions();
        console.log(JSON.stringify(actionList, null, 2));
        process.exit(0);
        break;
      case '--list-devices':
        const deviceList = listDevices();
        console.log(JSON.stringify(deviceList, null, 2));
        process.exit(0);
        break;
      case '--search-devices':
        const matches = searchDevices(next);
        console.log(JSON.stringify(matches, null, 2));
        process.exit(0);
        break;
    }
  }

  return args;
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
Browser Screenshot CLI Tool - SPA-First Playwright Automation

BASIC USAGE:
  browser-screenshot --action screenshot --url "https://example.com"
  browser-screenshot --action click --selector "button" --session mysession
  browser-screenshot --action fill --selector "input" --value "text"

ACTIONS:
  screenshot       Take a screenshot (default)
  click            Click an element
  double-click     Double-click an element
  right-click      Right-click an element
  fill             Fill an input field
  type             Type text character by character
  type-realistic   Type with realistic delays (good for React)
  select           Select an option
  check            Check a checkbox
  uncheck          Uncheck a checkbox
  hover            Hover over an element
  scroll           Scroll the page
  wait             Wait for an element
  evaluate         Execute JavaScript
  getText          Get element text content
  get-value        Get input value
  get-attribute    Get element attribute
  getUrl           Get current URL
  console          Get console logs
  html             Export page HTML
  pdf              Export page as PDF

NAVIGATION:
  go-back          Navigate back
  go-forward       Navigate forward
  reload           Reload page
  click-new-tab    Click and switch to new tab

IFRAME ACTIONS:
  iframe-click     Click inside iframe (--frame + --selector)
  iframe-fill      Fill input in iframe
  iframe-type      Type in iframe
  iframe-getText   Get text from iframe
  iframe-screenshot Screenshot iframe

FILE & DRAG:
  upload           Upload file(s) (--selector + --file/--files)
  drag             Drag and drop (--selector + --target)
  drag-by-offset   Drag by pixel offset (--selector + --x/--y)

HTTP REQUESTS:
  http-get         GET request (--http-url)
  http-post        POST request (--http-url + --http-body)
  http-put         PUT request
  http-patch       PATCH request
  http-delete      DELETE request
  wait-for-response Wait for network response (--url-pattern)
  capture-network  Capture network traffic

ASSERTIONS:
  assert-exists    Assert element exists
  assert-text      Assert element text (--contains for partial)
  assert-visible   Assert element is visible
  assert-count     Assert element count

OPTIONS:
  --url <url>           URL to navigate to
  --selector <sel>      CSS selector for element-based actions
  --value <val>         Value for fill/type/assert actions
  --session <id>        Session ID for persistent state
  --full-page           Capture full page screenshot
  --wait-for <sel>      Wait for selector before action
  --timeout <ms>        Timeout in milliseconds (default: 30000)
  --width <px>          Viewport width (default: 1280)
  --height <px>         Viewport height (default: 720)

DEVICE EMULATION:
  --device <name>       Emulate device (e.g., "iPhone 15", "Pixel 7")
  --user-agent <ua>     Custom User-Agent string
  --list-devices        List all available devices
  --search-devices <q>  Search devices by name

IFRAME OPTIONS:
  --frame <sel>         Frame selector for iframe actions

FILE UPLOAD:
  --file <path>         Single file path for upload
  --files <paths>       Comma-separated file paths

DRAG & DROP:
  --target <sel>        Target selector for drag action
  --x <px>              X offset for drag-by-offset
  --y <px>              Y offset for scroll/drag-by-offset

HTTP OPTIONS:
  --http-url <url>      URL for HTTP requests
  --http-method <m>     HTTP method (GET, POST, PUT, PATCH, DELETE)
  --http-body <json>    Request body (JSON)
  --http-headers <json> Request headers (JSON)
  --bearer-token <tok>  Bearer token for Authorization header
  --url-pattern <pat>   URL pattern for wait-for-response

CHAIN MODE:
  --chain <json>        JSON array of actions to execute
  --chain-file <path>   Path to JSON file with actions

RETRY:
  --retry <n>           Number of retry attempts (default: 0)
  --retry-delay <ms>    Delay between retries (default: 1000)

SPA SUPPORT:
  --spa-mode <mode>     SPA framework: react, vue, angular, generic, auto
  --wait-for-idle [ms]  Wait for DOM to stabilize (default: 500ms)
  --typing-delay <ms>   Delay between keystrokes (default: 50)

DAEMON MODE:
  --daemon              Use persistent daemon (must be running)
  --no-navigate         Don't navigate, reuse existing page state

DEBUG:
  --debug               Enable debug output
  --trace               Generate Playwright trace file
  --trace-dir <path>    Custom trace output directory

EXAMPLES:
  # Screenshot with device emulation
  browser-screenshot --url "https://example.com" --device "iPhone 15"

  # Fill form inside iframe
  browser-screenshot --url "https://site.com" --action iframe-fill \\
    --frame "iframe#payment" --selector "input[name=card]" --value "4111..."

  # Upload file
  browser-screenshot --url "https://upload.com" --action upload \\
    --selector "input[type=file]" --file "/path/to/file.pdf"

  # Drag and drop
  browser-screenshot --url "https://app.com" --action drag \\
    --selector ".item" --target ".dropzone"

  # HTTP request with bearer token
  browser-screenshot --action http-get --http-url "https://api.com/data" \\
    --bearer-token "eyJhbG..."

  # Chain with device emulation
  browser-screenshot --url "https://m.site.com" --device "Pixel 7" --chain '[
    {"action": "fill", "selector": "input", "value": "search"},
    {"action": "click", "selector": "button"},
    {"action": "wait-for-idle"},
    {"action": "screenshot", "fullPage": true}
  ]'

  # Use daemon for persistent React sessions
  browser-daemon start
  browser-screenshot --daemon --session myapp --url "https://react-app.com" \\
    --spa-mode react --chain '[{"action":"screenshot"}]'
  browser-screenshot --daemon --session myapp --no-navigate \\
    --chain '[{"action":"type-realistic","selector":"input","value":"test"}]'
`);
}

/**
 * Debug logging
 */
function debugLog(args, ...messages) {
  if (args.debug) {
    console.error('[DEBUG]', new Date().toISOString(), ...messages);
  }
}

/**
 * Console logs collector
 */
let consoleLogs = [];

/**
 * Main entry point
 */
async function main() {
  const args = parseArgs(process.argv);
  consoleLogs = [];

  debugLog(args, 'Starting with args:', JSON.stringify(args, null, 2));

  // Handle daemon mode
  if (args.daemon) {
    debugLog(args, 'Using daemon mode');

    if (!isDaemonRunningSync(args.socketPath)) {
      console.log(JSON.stringify({
        success: false,
        error: 'Daemon is not running. Start it with: browser-daemon start'
      }, null, 2));
      process.exit(1);
    }

    try {
      // Determine chain to execute
      let chainToExecute = null;
      if (args.chain) {
        chainToExecute = args.chain;
      } else if (args.chainFile) {
        chainToExecute = fs.readFileSync(args.chainFile, 'utf-8');
      }

      const result = await executeViaDaemon({
        session: args.session,
        action: args.action,
        chain: chainToExecute,
        url: args.url,
        noNavigate: args.noNavigate,
        viewport: args.viewport,
        spaMode: args.spaMode,
        waitForIdle: args.waitForIdle,
        timeout: args.timeout,
        selector: args.selector,
        value: args.value,
        fullPage: args.fullPage,
        script: args.script,
        waitFor: args.waitFor,
        y: args.y,
        contains: args.contains,
        typingDelay: args.typingDelay,
        socketPath: args.socketPath
      });

      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error.message
      }, null, 2));
      process.exit(1);
    }
  }

  // Standalone mode
  let browser = null;
  let traceFile = null;

  try {
    debugLog(args, 'Launching browser...');

    // Launch browser
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    // Build context options
    const contextOptions = {
      viewport: args.viewport,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    // Apply device emulation if specified
    if (args.device) {
      const deviceDescriptor = resolveDevice(args.device);
      if (!deviceDescriptor) {
        throw new Error(`Unknown device: "${args.device}". Use --list-devices to see available devices.`);
      }
      debugLog(args, `Emulating device: ${args.device}`);
      Object.assign(contextOptions, deviceDescriptor);
    }

    // Override user-agent if specified
    if (args.userAgent) {
      contextOptions.userAgent = args.userAgent;
      debugLog(args, `Using custom User-Agent: ${args.userAgent}`);
    }

    // Create context with options
    const context = await browser.newContext(contextOptions);

    // Start tracing if enabled
    if (args.trace) {
      debugLog(args, 'Starting trace...');
      await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true
      });
    }

    // Load session if specified
    let sessionData = null;
    if (args.session) {
      debugLog(args, `Loading session: ${args.session}`);
      sessionData = await loadSession(context, args.session);
    }

    const page = await context.newPage();
    page.setDefaultTimeout(args.timeout);

    // Capture console logs
    page.on('console', msg => {
      consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location()
      });
    });

    // Capture page errors
    page.on('pageerror', error => {
      consoleLogs.push({
        type: 'pageerror',
        text: error.message,
        stack: error.stack
      });
    });

    // Navigate to URL or restore last URL from session
    if (args.url) {
      debugLog(args, `Navigating to: ${args.url}`);
      await page.goto(args.url, {
        waitUntil: 'networkidle',
        timeout: args.timeout
      });
    } else if (sessionData && sessionData.lastUrl) {
      debugLog(args, `Restoring URL from session: ${sessionData.lastUrl}`);
      await page.goto(sessionData.lastUrl, {
        waitUntil: 'networkidle',
        timeout: args.timeout
      });
    }

    // Restore localStorage if we have session data
    if (sessionData && sessionData.localStorage) {
      await restoreLocalStorage(page, sessionData.localStorage);
    }

    // Wait for specific element if requested
    if (args.waitFor && args.action !== 'wait') {
      debugLog(args, `Waiting for: ${args.waitFor}`);
      await page.waitForSelector(args.waitFor, { timeout: args.timeout });
    }

    // Wait for SPA to stabilize if spa-mode is set
    if (args.spaMode) {
      debugLog(args, `Waiting for SPA (${args.spaMode}) to stabilize...`);
      await waitForSpaStable(page, args.spaMode, { timeout: args.timeout });
    }

    // Wait for DOM idle if requested
    if (args.waitForIdle) {
      debugLog(args, `Waiting for DOM idle (${args.waitForIdle}ms)...`);
      await waitForDomIdle(page, args.waitForIdle);
    }

    let result;

    // Check if chain mode
    if (args.chain || args.chainFile) {
      debugLog(args, 'Executing chain...');

      let chain;
      if (args.chainFile) {
        const chainContent = fs.readFileSync(args.chainFile, 'utf-8');
        chain = parseChain(chainContent);
      } else {
        chain = parseChain(args.chain);
      }

      // Validate chain
      const validation = validateChain(chain);
      if (!validation.valid) {
        throw new Error(`Invalid chain: ${validation.error}`);
      }

      // Execute with retry if configured
      const executeWithRetry = () => executeChain(page, chain, args, {
        consoleLogs,
        debugLog: (msg) => debugLog(args, msg)
      });

      if (args.retry > 0) {
        result = await withRetry(executeWithRetry, {
          retries: args.retry,
          delay: args.retryDelay,
          onRetry: (attempt, error) => {
            debugLog(args, `Retry ${attempt}/${args.retry} after error: ${error.message}`);
          }
        });
      } else {
        result = await executeWithRetry();
      }
    } else {
      // Single action mode
      debugLog(args, `Executing action: ${args.action}`);

      // Check if it's an HTTP action
      const isHttpAction = args.action.startsWith('http-') ||
                           args.action === 'wait-for-response' ||
                           args.action === 'wait-for-request' ||
                           args.action === 'mock-route' ||
                           args.action === 'block-route' ||
                           args.action === 'capture-network';

      // Get action handler from actions or httpActions
      const actionHandler = actions[args.action] || (isHttpAction ? httpActions[args.action] : null);

      if (!actionHandler) {
        throw new Error(`Unknown action: ${args.action}. Use --list-actions to see available actions.`);
      }

      // Execute with retry if configured
      const executeWithRetry = () => actionHandler(page, args, consoleLogs);

      if (args.retry > 0) {
        result = await withRetry(executeWithRetry, {
          retries: args.retry,
          delay: args.retryDelay,
          onRetry: (attempt, error) => {
            debugLog(args, `Retry ${attempt}/${args.retry} after error: ${error.message}`);
          }
        });
      } else {
        result = await executeWithRetry();
      }
    }

    // Save session if specified
    if (args.session) {
      debugLog(args, `Saving session: ${args.session}`);
      await saveSession(context, page, args.session, page.url());
    }

    // Add current URL to result
    result.currentUrl = page.url();

    // Add console logs if any
    if (consoleLogs.length > 0) {
      result.consoleLogs = consoleLogs;
    }

    // Stop tracing and save
    if (args.trace) {
      const traceDir = args.traceDir || SCREENSHOTS_DIR;
      traceFile = path.join(traceDir, `trace-${Date.now()}.zip`);
      debugLog(args, `Saving trace to: ${traceFile}`);
      await context.tracing.stop({ path: traceFile });
      result.traceFile = traceFile;
    }

    // Output result as JSON
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    debugLog(args, `Error: ${error.message}`);
    debugLog(args, error.stack);

    const errorResult = {
      success: false,
      error: error.message,
      action: args.chain ? 'chain' : args.action
    };

    if (consoleLogs.length > 0) {
      errorResult.consoleLogs = consoleLogs;
    }

    console.log(JSON.stringify(errorResult, null, 2));
    process.exit(1);
  } finally {
    if (browser) {
      debugLog(args, 'Closing browser...');
      await browser.close();
    }
  }
}

main();
