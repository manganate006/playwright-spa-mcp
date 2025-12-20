/**
 * Playwright SPA MCP Server
 * MCP server implementation with SPA support, persistent sessions, and action chains
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Import our modules
const { actions, getTimestampedPath, SCREENSHOT_DIR } = require('../lib/actions');
const { executeChain, validateChain, listAvailableActions } = require('../lib/chain-executor');
const { waitForDomIdle, waitForSpaStable, typeRealistic } = require('../lib/spa-utils');
const { resolveDevice, listDevices, searchDevices, DEVICE_SHORTCUTS } = require('../lib/devices');
const { httpActions } = require('../lib/http-actions');

// Session storage for persistent browser contexts
const sessions = new Map();

/**
 * Get or create a browser session
 */
async function getSession(sessionId, options = {}) {
  if (sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();
    return session;
  }

  // Launch browser
  const browser = await chromium.launch({
    headless: options.headless !== false
  });

  // Build context options
  const contextOptions = {
    viewport: options.viewport || { width: 1920, height: 1080 }
  };

  // Apply device emulation
  if (options.device) {
    const deviceDescriptor = resolveDevice(options.device);
    if (deviceDescriptor) {
      Object.assign(contextOptions, deviceDescriptor);
    }
  }

  // Custom user agent
  if (options.userAgent) {
    contextOptions.userAgent = options.userAgent;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  // Console log capture
  const consoleLogs = [];
  page.on('console', (msg) => {
    consoleLogs.push({
      type: msg.type(),
      text: msg.text(),
      timestamp: Date.now()
    });
  });

  const session = {
    browser,
    context,
    page,
    consoleLogs,
    lastUsed: Date.now(),
    options
  };

  sessions.set(sessionId, session);
  return session;
}

/**
 * Close a browser session
 */
async function closeSession(sessionId) {
  if (sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    await session.browser.close();
    sessions.delete(sessionId);
    return true;
  }
  return false;
}

/**
 * Close all sessions
 */
async function closeAllSessions() {
  for (const [id, session] of sessions) {
    try {
      await session.browser.close();
    } catch (e) {
      // Ignore errors during cleanup
    }
  }
  sessions.clear();
}

/**
 * Define MCP tools
 */
const tools = [
  {
    name: 'spa_screenshot',
    description: 'Take a screenshot of a web page with SPA framework support. Waits for DOM to stabilize before capturing.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to (optional if using existing session)' },
        session: { type: 'string', description: 'Session ID for persistent browser state', default: 'default' },
        fullPage: { type: 'boolean', description: 'Capture full page screenshot', default: false },
        device: { type: 'string', description: 'Device to emulate (e.g., "iPhone 15", "Pixel 7", or shortcuts like "iphone", "pixel")' },
        spaMode: { type: 'string', enum: ['auto', 'react', 'vue', 'angular', 'generic'], description: 'SPA framework mode for better stability detection' },
        waitForIdle: { type: 'number', description: 'Wait for DOM idle time in ms before screenshot', default: 500 },
        selector: { type: 'string', description: 'CSS selector to screenshot (element screenshot)' }
      }
    }
  },
  {
    name: 'spa_click',
    description: 'Click an element with SPA-aware waiting. Waits for DOM to stabilize after click.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to click' },
        session: { type: 'string', description: 'Session ID', default: 'default' },
        url: { type: 'string', description: 'URL to navigate to first (optional)' },
        spaMode: { type: 'string', enum: ['auto', 'react', 'vue', 'angular', 'generic'] },
        waitForIdle: { type: 'boolean', description: 'Wait for DOM idle after click', default: true },
        screenshot: { type: 'boolean', description: 'Take screenshot after action', default: true }
      },
      required: ['selector']
    }
  },
  {
    name: 'spa_fill',
    description: 'Fill an input field with React/Vue/Angular compatibility. Properly triggers framework change events.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for input field' },
        value: { type: 'string', description: 'Value to fill' },
        session: { type: 'string', description: 'Session ID', default: 'default' },
        url: { type: 'string', description: 'URL to navigate to first (optional)' },
        spaMode: { type: 'string', enum: ['auto', 'react', 'vue', 'angular', 'generic'] },
        screenshot: { type: 'boolean', description: 'Take screenshot after action', default: true }
      },
      required: ['selector', 'value']
    }
  },
  {
    name: 'spa_type_realistic',
    description: 'Type text character by character with realistic delays. Best for React controlled inputs and forms with live validation.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for input field' },
        value: { type: 'string', description: 'Text to type' },
        session: { type: 'string', description: 'Session ID', default: 'default' },
        url: { type: 'string', description: 'URL to navigate to first (optional)' },
        delay: { type: 'number', description: 'Delay between keystrokes in ms', default: 50 },
        clearFirst: { type: 'boolean', description: 'Clear the field before typing', default: true },
        spaMode: { type: 'string', enum: ['auto', 'react', 'vue', 'angular', 'generic'] },
        screenshot: { type: 'boolean', description: 'Take screenshot after action', default: true }
      },
      required: ['selector', 'value']
    }
  },
  {
    name: 'spa_chain',
    description: 'Execute a chain of actions in sequence. Supports all browser actions plus chain-specific commands like wait, wait-for-idle, press, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        chain: {
          type: 'array',
          description: 'Array of action objects to execute',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', description: 'Action name (screenshot, click, fill, type-realistic, wait, wait-for, wait-for-idle, press, etc.)' },
              selector: { type: 'string' },
              value: { type: 'string' },
              ms: { type: 'number' },
              key: { type: 'string' },
              fullPage: { type: 'boolean' }
            },
            required: ['action']
          }
        },
        session: { type: 'string', description: 'Session ID', default: 'default' },
        url: { type: 'string', description: 'URL to navigate to first (optional)' },
        device: { type: 'string', description: 'Device to emulate' },
        spaMode: { type: 'string', enum: ['auto', 'react', 'vue', 'angular', 'generic'] },
        stopOnError: { type: 'boolean', description: 'Stop chain execution on first error', default: true }
      },
      required: ['chain']
    }
  },
  {
    name: 'spa_navigate',
    description: 'Navigate to a URL with device emulation support.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        session: { type: 'string', description: 'Session ID', default: 'default' },
        device: { type: 'string', description: 'Device to emulate' },
        userAgent: { type: 'string', description: 'Custom user agent string' },
        waitUntil: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle', 'commit'], default: 'networkidle' },
        screenshot: { type: 'boolean', description: 'Take screenshot after navigation', default: true }
      },
      required: ['url']
    }
  },
  {
    name: 'spa_iframe_click',
    description: 'Click an element inside an iframe.',
    inputSchema: {
      type: 'object',
      properties: {
        frame: { type: 'string', description: 'CSS selector for the iframe' },
        selector: { type: 'string', description: 'CSS selector for element inside iframe' },
        session: { type: 'string', description: 'Session ID', default: 'default' },
        url: { type: 'string', description: 'URL to navigate to first (optional)' },
        screenshot: { type: 'boolean', description: 'Take screenshot after action', default: true }
      },
      required: ['frame', 'selector']
    }
  },
  {
    name: 'spa_iframe_fill',
    description: 'Fill an input field inside an iframe.',
    inputSchema: {
      type: 'object',
      properties: {
        frame: { type: 'string', description: 'CSS selector for the iframe' },
        selector: { type: 'string', description: 'CSS selector for input inside iframe' },
        value: { type: 'string', description: 'Value to fill' },
        session: { type: 'string', description: 'Session ID', default: 'default' },
        url: { type: 'string', description: 'URL to navigate to first (optional)' },
        screenshot: { type: 'boolean', description: 'Take screenshot after action', default: true }
      },
      required: ['frame', 'selector', 'value']
    }
  },
  {
    name: 'spa_upload',
    description: 'Upload a file to a file input element.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for file input' },
        file: { type: 'string', description: 'Path to file to upload' },
        files: { type: 'array', items: { type: 'string' }, description: 'Multiple file paths to upload' },
        session: { type: 'string', description: 'Session ID', default: 'default' },
        url: { type: 'string', description: 'URL to navigate to first (optional)' },
        screenshot: { type: 'boolean', description: 'Take screenshot after action', default: true }
      },
      required: ['selector']
    }
  },
  {
    name: 'spa_drag',
    description: 'Drag an element and drop it on another element.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for element to drag' },
        target: { type: 'string', description: 'CSS selector for drop target' },
        session: { type: 'string', description: 'Session ID', default: 'default' },
        url: { type: 'string', description: 'URL to navigate to first (optional)' },
        screenshot: { type: 'boolean', description: 'Take screenshot after action', default: true }
      },
      required: ['selector', 'target']
    }
  },
  {
    name: 'spa_go_back',
    description: 'Navigate back in browser history.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID', default: 'default' },
        screenshot: { type: 'boolean', description: 'Take screenshot after action', default: true }
      }
    }
  },
  {
    name: 'spa_go_forward',
    description: 'Navigate forward in browser history.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID', default: 'default' },
        screenshot: { type: 'boolean', description: 'Take screenshot after action', default: true }
      }
    }
  },
  {
    name: 'spa_http_request',
    description: 'Make an HTTP request using the browser context (includes cookies and auth).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL for HTTP request' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], default: 'GET' },
        body: { type: 'string', description: 'Request body (JSON string or form data)' },
        headers: { type: 'object', description: 'Request headers' },
        bearerToken: { type: 'string', description: 'Bearer token for Authorization header' },
        session: { type: 'string', description: 'Session ID', default: 'default' }
      },
      required: ['url']
    }
  },
  {
    name: 'spa_assert',
    description: 'Run assertions on page elements.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['exists', 'visible', 'text', 'count'], description: 'Assertion type' },
        selector: { type: 'string', description: 'CSS selector to check' },
        value: { type: 'string', description: 'Expected value (for text and count assertions)' },
        contains: { type: 'boolean', description: 'For text assertion: check if text contains value instead of exact match' },
        session: { type: 'string', description: 'Session ID', default: 'default' },
        url: { type: 'string', description: 'URL to navigate to first (optional)' }
      },
      required: ['type', 'selector']
    }
  },
  {
    name: 'spa_session_start',
    description: 'Start a new persistent browser session. Use sessions to maintain state between tool calls.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID to create', default: 'default' },
        device: { type: 'string', description: 'Device to emulate' },
        userAgent: { type: 'string', description: 'Custom user agent' },
        viewport: {
          type: 'object',
          properties: {
            width: { type: 'number' },
            height: { type: 'number' }
          }
        }
      }
    }
  },
  {
    name: 'spa_session_end',
    description: 'End a browser session and close the browser.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID to close', default: 'default' }
      }
    }
  },
  {
    name: 'spa_session_list',
    description: 'List all active browser sessions.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'spa_wait_idle',
    description: 'Wait for DOM to become idle (no mutations). Useful for SPAs that update the DOM frequently.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID', default: 'default' },
        idleTime: { type: 'number', description: 'Required idle time in ms', default: 500 },
        maxWait: { type: 'number', description: 'Maximum wait time in ms', default: 10000 }
      }
    }
  },
  {
    name: 'spa_evaluate',
    description: 'Execute JavaScript in the page context.',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'JavaScript code to execute' },
        session: { type: 'string', description: 'Session ID', default: 'default' },
        url: { type: 'string', description: 'URL to navigate to first (optional)' }
      },
      required: ['script']
    }
  },
  {
    name: 'spa_get_text',
    description: 'Get text content of an element.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        session: { type: 'string', description: 'Session ID', default: 'default' },
        url: { type: 'string', description: 'URL to navigate to first (optional)' }
      },
      required: ['selector']
    }
  },
  {
    name: 'spa_list_devices',
    description: 'List available device emulation presets.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search pattern to filter devices' }
      }
    }
  },
  {
    name: 'spa_list_actions',
    description: 'List all available actions for the chain command.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

/**
 * Handle tool execution
 */
async function handleToolCall(name, args) {
  const sessionId = args.session || 'default';

  try {
    switch (name) {
      case 'spa_screenshot': {
        const session = await getSession(sessionId, {
          device: args.device,
          userAgent: args.userAgent
        });

        if (args.url) {
          await session.page.goto(args.url, { waitUntil: 'networkidle' });
        }

        if (args.spaMode) {
          await waitForSpaStable(session.page, args.spaMode);
        }

        if (args.waitForIdle) {
          await waitForDomIdle(session.page, args.waitForIdle);
        }

        const filename = getTimestampedPath('screenshot');
        const screenshotOptions = { path: filename };

        if (args.fullPage) {
          screenshotOptions.fullPage = true;
        }

        if (args.selector) {
          const element = await session.page.locator(args.selector);
          await element.screenshot(screenshotOptions);
        } else {
          await session.page.screenshot(screenshotOptions);
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              file: filename,
              url: session.page.url()
            }, null, 2)
          }]
        };
      }

      case 'spa_click': {
        const session = await getSession(sessionId);

        if (args.url) {
          await session.page.goto(args.url, { waitUntil: 'networkidle' });
        }

        await session.page.click(args.selector);

        if (args.waitForIdle !== false) {
          await waitForDomIdle(session.page, 500);
        }

        if (args.spaMode) {
          await waitForSpaStable(session.page, args.spaMode);
        }

        let filename = null;
        if (args.screenshot !== false) {
          filename = getTimestampedPath('after-click');
          await session.page.screenshot({ path: filename });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              action: 'click',
              selector: args.selector,
              file: filename,
              url: session.page.url()
            }, null, 2)
          }]
        };
      }

      case 'spa_fill': {
        const session = await getSession(sessionId);

        if (args.url) {
          await session.page.goto(args.url, { waitUntil: 'networkidle' });
        }

        await session.page.fill(args.selector, args.value);

        if (args.spaMode) {
          await waitForSpaStable(session.page, args.spaMode);
        }

        let filename = null;
        if (args.screenshot !== false) {
          filename = getTimestampedPath('after-fill');
          await session.page.screenshot({ path: filename });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              action: 'fill',
              selector: args.selector,
              file: filename,
              url: session.page.url()
            }, null, 2)
          }]
        };
      }

      case 'spa_type_realistic': {
        const session = await getSession(sessionId);

        if (args.url) {
          await session.page.goto(args.url, { waitUntil: 'networkidle' });
        }

        await typeRealistic(session.page, args.selector, args.value, {
          delay: args.delay || 50,
          clearFirst: args.clearFirst !== false,
          triggerBlur: true
        });

        if (args.spaMode) {
          await waitForSpaStable(session.page, args.spaMode);
        }

        let filename = null;
        if (args.screenshot !== false) {
          filename = getTimestampedPath('after-type');
          await session.page.screenshot({ path: filename });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              action: 'type-realistic',
              selector: args.selector,
              file: filename,
              url: session.page.url()
            }, null, 2)
          }]
        };
      }

      case 'spa_chain': {
        const session = await getSession(sessionId, {
          device: args.device
        });

        if (args.url) {
          await session.page.goto(args.url, { waitUntil: 'networkidle' });
        }

        const validation = validateChain(args.chain);
        if (!validation.valid) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: validation.error
              }, null, 2)
            }]
          };
        }

        const result = await executeChain(
          session.page,
          args.chain,
          { spaMode: args.spaMode },
          {
            stopOnError: args.stopOnError !== false,
            consoleLogs: session.consoleLogs
          }
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      }

      case 'spa_navigate': {
        const session = await getSession(sessionId, {
          device: args.device,
          userAgent: args.userAgent
        });

        await session.page.goto(args.url, {
          waitUntil: args.waitUntil || 'networkidle'
        });

        let filename = null;
        if (args.screenshot !== false) {
          filename = getTimestampedPath('navigate');
          await session.page.screenshot({ path: filename });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              url: session.page.url(),
              file: filename
            }, null, 2)
          }]
        };
      }

      case 'spa_iframe_click': {
        const session = await getSession(sessionId);

        if (args.url) {
          await session.page.goto(args.url, { waitUntil: 'networkidle' });
        }

        const frameLocator = session.page.frameLocator(args.frame);
        await frameLocator.locator(args.selector).click();

        let filename = null;
        if (args.screenshot !== false) {
          filename = getTimestampedPath('iframe-click');
          await session.page.screenshot({ path: filename });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              action: 'iframe-click',
              frame: args.frame,
              selector: args.selector,
              file: filename
            }, null, 2)
          }]
        };
      }

      case 'spa_iframe_fill': {
        const session = await getSession(sessionId);

        if (args.url) {
          await session.page.goto(args.url, { waitUntil: 'networkidle' });
        }

        const frameLocator = session.page.frameLocator(args.frame);
        await frameLocator.locator(args.selector).fill(args.value);

        let filename = null;
        if (args.screenshot !== false) {
          filename = getTimestampedPath('iframe-fill');
          await session.page.screenshot({ path: filename });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              action: 'iframe-fill',
              frame: args.frame,
              selector: args.selector,
              file: filename
            }, null, 2)
          }]
        };
      }

      case 'spa_upload': {
        const session = await getSession(sessionId);

        if (args.url) {
          await session.page.goto(args.url, { waitUntil: 'networkidle' });
        }

        const files = args.files || [args.file];
        await session.page.setInputFiles(args.selector, files);

        let filename = null;
        if (args.screenshot !== false) {
          filename = getTimestampedPath('upload');
          await session.page.screenshot({ path: filename });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              action: 'upload',
              selector: args.selector,
              uploadedFiles: files,
              file: filename
            }, null, 2)
          }]
        };
      }

      case 'spa_drag': {
        const session = await getSession(sessionId);

        if (args.url) {
          await session.page.goto(args.url, { waitUntil: 'networkidle' });
        }

        await session.page.dragAndDrop(args.selector, args.target);

        let filename = null;
        if (args.screenshot !== false) {
          filename = getTimestampedPath('drag');
          await session.page.screenshot({ path: filename });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              action: 'drag',
              source: args.selector,
              target: args.target,
              file: filename
            }, null, 2)
          }]
        };
      }

      case 'spa_go_back': {
        const session = await getSession(sessionId);
        await session.page.goBack({ waitUntil: 'networkidle' });

        let filename = null;
        if (args.screenshot !== false) {
          filename = getTimestampedPath('go-back');
          await session.page.screenshot({ path: filename });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              action: 'go-back',
              url: session.page.url(),
              file: filename
            }, null, 2)
          }]
        };
      }

      case 'spa_go_forward': {
        const session = await getSession(sessionId);
        await session.page.goForward({ waitUntil: 'networkidle' });

        let filename = null;
        if (args.screenshot !== false) {
          filename = getTimestampedPath('go-forward');
          await session.page.screenshot({ path: filename });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              action: 'go-forward',
              url: session.page.url(),
              file: filename
            }, null, 2)
          }]
        };
      }

      case 'spa_http_request': {
        const session = await getSession(sessionId);
        const request = session.context.request;

        const headers = args.headers || {};
        if (args.bearerToken) {
          headers['Authorization'] = `Bearer ${args.bearerToken}`;
        }

        const options = { headers };
        if (args.body) {
          try {
            options.data = JSON.parse(args.body);
          } catch {
            options.data = args.body;
          }
        }

        let response;
        const method = (args.method || 'GET').toUpperCase();

        switch (method) {
          case 'GET':
            response = await request.get(args.url, options);
            break;
          case 'POST':
            response = await request.post(args.url, options);
            break;
          case 'PUT':
            response = await request.put(args.url, options);
            break;
          case 'PATCH':
            response = await request.patch(args.url, options);
            break;
          case 'DELETE':
            response = await request.delete(args.url, options);
            break;
          case 'HEAD':
            response = await request.head(args.url, options);
            break;
          default:
            throw new Error(`Unsupported HTTP method: ${method}`);
        }

        let body = null;
        try {
          body = await response.json();
        } catch {
          try {
            body = await response.text();
          } catch {
            body = null;
          }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              status: response.status(),
              statusText: response.statusText(),
              headers: response.headers(),
              body
            }, null, 2)
          }]
        };
      }

      case 'spa_assert': {
        const session = await getSession(sessionId);

        if (args.url) {
          await session.page.goto(args.url, { waitUntil: 'networkidle' });
        }

        let passed = false;
        let actual = null;

        switch (args.type) {
          case 'exists': {
            const count = await session.page.locator(args.selector).count();
            passed = count > 0;
            actual = count > 0 ? 'exists' : 'not found';
            break;
          }
          case 'visible': {
            const locator = session.page.locator(args.selector).first();
            passed = await locator.isVisible();
            actual = passed ? 'visible' : 'not visible';
            break;
          }
          case 'text': {
            const text = await session.page.locator(args.selector).first().textContent();
            actual = text;
            if (args.contains) {
              passed = text && text.includes(args.value);
            } else {
              passed = text === args.value;
            }
            break;
          }
          case 'count': {
            const count = await session.page.locator(args.selector).count();
            actual = count;
            passed = count === parseInt(args.value);
            break;
          }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              assertion: args.type,
              selector: args.selector,
              expected: args.value,
              actual,
              passed
            }, null, 2)
          }]
        };
      }

      case 'spa_session_start': {
        const session = await getSession(sessionId, {
          device: args.device,
          userAgent: args.userAgent,
          viewport: args.viewport
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              session: sessionId,
              message: `Session "${sessionId}" started`
            }, null, 2)
          }]
        };
      }

      case 'spa_session_end': {
        const closed = await closeSession(sessionId);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              session: sessionId,
              closed,
              message: closed ? `Session "${sessionId}" closed` : `Session "${sessionId}" not found`
            }, null, 2)
          }]
        };
      }

      case 'spa_session_list': {
        const sessionList = [];
        for (const [id, session] of sessions) {
          sessionList.push({
            id,
            url: session.page.url(),
            lastUsed: session.lastUsed,
            idleSeconds: Math.round((Date.now() - session.lastUsed) / 1000)
          });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: sessionList.length,
              sessions: sessionList
            }, null, 2)
          }]
        };
      }

      case 'spa_wait_idle': {
        const session = await getSession(sessionId);

        await waitForDomIdle(
          session.page,
          args.idleTime || 500,
          args.maxWait || 10000
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              action: 'wait-idle',
              url: session.page.url()
            }, null, 2)
          }]
        };
      }

      case 'spa_evaluate': {
        const session = await getSession(sessionId);

        if (args.url) {
          await session.page.goto(args.url, { waitUntil: 'networkidle' });
        }

        const result = await session.page.evaluate(args.script);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              result
            }, null, 2)
          }]
        };
      }

      case 'spa_get_text': {
        const session = await getSession(sessionId);

        if (args.url) {
          await session.page.goto(args.url, { waitUntil: 'networkidle' });
        }

        const text = await session.page.locator(args.selector).first().textContent();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              selector: args.selector,
              text
            }, null, 2)
          }]
        };
      }

      case 'spa_list_devices': {
        let deviceList;
        if (args.search) {
          deviceList = searchDevices(args.search);
        } else {
          deviceList = listDevices();
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: deviceList.length,
              shortcuts: DEVICE_SHORTCUTS,
              devices: deviceList.slice(0, 50), // Limit to 50 for readability
              note: deviceList.length > 50 ? `Showing first 50 of ${deviceList.length} devices. Use search to filter.` : undefined
            }, null, 2)
          }]
        };
      }

      case 'spa_list_actions': {
        const available = listAvailableActions();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              ...available
            }, null, 2)
          }]
        };
      }

      default:
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Unknown tool: ${name}`
            }, null, 2)
          }]
        };
    }
  } catch (error) {
    // Take error screenshot if possible
    let errorScreenshot = null;
    try {
      if (sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        errorScreenshot = getTimestampedPath('error');
        await session.page.screenshot({ path: errorScreenshot });
      }
    } catch {
      // Ignore screenshot errors
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: error.message,
          errorScreenshot
        }, null, 2)
      }]
    };
  }
}

/**
 * Run the MCP server
 */
async function runServer() {
  const server = new Server(
    {
      name: 'playwright-spa-mcp',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(name, args || {});
  });

  // Cleanup on exit
  process.on('SIGINT', async () => {
    await closeAllSessions();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await closeAllSessions();
    process.exit(0);
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Playwright SPA MCP Server running on stdio');
}

module.exports = { runServer, handleToolCall, tools };
