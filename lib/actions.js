/**
 * Browser actions module
 * Contains all action handlers for the browser-screenshot tool
 */

const fs = require('fs');
const path = require('path');

const SCREENSHOTS_DIR = '/tmp/screenshots';

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

/**
 * Generate a timestamped filename
 */
function getTimestampedPath(prefix, extension = 'png') {
  const timestamp = Date.now();
  return path.join(SCREENSHOTS_DIR, `${prefix}-${timestamp}.${extension}`);
}

/**
 * All available actions
 */
const actions = {
  async screenshot(page, args) {
    const filename = getTimestampedPath('screenshot');
    await page.screenshot({
      path: filename,
      fullPage: args.fullPage
    });
    return { success: true, file: filename, action: 'screenshot' };
  },

  async click(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for click action');
    }

    await page.click(args.selector);
    await page.waitForLoadState('networkidle').catch(() => {});

    const filename = getTimestampedPath('after-click');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'click', selector: args.selector };
  },

  async fill(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for fill action');
    }
    if (args.value === null || args.value === undefined) {
      throw new Error('--value is required for fill action');
    }

    await page.fill(args.selector, args.value);

    const filename = getTimestampedPath('after-fill');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'fill', selector: args.selector };
  },

  async type(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for type action');
    }
    if (!args.value) {
      throw new Error('--value is required for type action');
    }

    await page.type(args.selector, args.value, { delay: args.typingDelay || 50 });

    const filename = getTimestampedPath('after-type');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'type', selector: args.selector };
  },

  async select(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for select action');
    }
    if (!args.value) {
      throw new Error('--value is required for select action');
    }

    await page.selectOption(args.selector, args.value);

    const filename = getTimestampedPath('after-select');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'select', selector: args.selector };
  },

  async wait(page, args) {
    if (!args.selector && !args.waitFor) {
      throw new Error('--selector or --wait-for is required for wait action');
    }

    const selector = args.selector || args.waitFor;
    await page.waitForSelector(selector, { timeout: args.timeout });

    const filename = getTimestampedPath('after-wait');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'wait', selector };
  },

  async scroll(page, args) {
    await page.evaluate((y) => {
      window.scrollBy(0, y);
    }, args.y || 0);

    await page.waitForTimeout(500);

    const filename = getTimestampedPath('after-scroll');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'scroll', y: args.y };
  },

  async pdf(page, args) {
    const filename = getTimestampedPath('page', 'pdf');
    await page.pdf({
      path: filename,
      format: 'A4',
      printBackground: true
    });
    return { success: true, file: filename, action: 'pdf' };
  },

  async html(page, args) {
    const html = await page.content();
    const filename = getTimestampedPath('page', 'html');
    fs.writeFileSync(filename, html);
    return { success: true, file: filename, action: 'html', length: html.length };
  },

  async evaluate(page, args) {
    if (!args.script) {
      throw new Error('--script is required for evaluate action');
    }

    const result = await page.evaluate(args.script);

    const filename = getTimestampedPath('after-eval');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'evaluate', result };
  },

  async hover(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for hover action');
    }

    await page.hover(args.selector);

    const filename = getTimestampedPath('after-hover');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'hover', selector: args.selector };
  },

  async getText(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for getText action');
    }

    const text = await page.textContent(args.selector);
    return { success: true, action: 'getText', selector: args.selector, text };
  },

  async getUrl(page, args) {
    const url = page.url();
    return { success: true, action: 'getUrl', url };
  },

  async console(page, args, consoleLogs = []) {
    // Wait a bit to collect any async console logs
    await page.waitForTimeout(500);
    return { success: true, action: 'console', logs: consoleLogs };
  },

  // ============================================
  // ASSERTION ACTIONS (Phase 3)
  // ============================================

  async 'assert-exists'(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for assert-exists action');
    }

    const element = await page.$(args.selector);
    if (!element) {
      throw new Error(`Assertion failed: Element "${args.selector}" does not exist`);
    }
    return { success: true, action: 'assert-exists', selector: args.selector };
  },

  async 'assert-text'(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for assert-text action');
    }
    if (args.value === null || args.value === undefined) {
      throw new Error('--value is required for assert-text action');
    }

    const text = await page.textContent(args.selector);
    const expected = args.value;

    if (args.contains) {
      if (!text?.includes(expected)) {
        throw new Error(`Assertion failed: Text "${text}" does not contain "${expected}"`);
      }
    } else {
      if (text?.trim() !== expected?.trim()) {
        throw new Error(`Assertion failed: Text "${text}" !== "${expected}"`);
      }
    }
    return { success: true, action: 'assert-text', selector: args.selector, actual: text };
  },

  async 'assert-visible'(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for assert-visible action');
    }

    const visible = await page.isVisible(args.selector);
    if (!visible) {
      throw new Error(`Assertion failed: Element "${args.selector}" is not visible`);
    }
    return { success: true, action: 'assert-visible', selector: args.selector };
  },

  async 'assert-count'(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for assert-count action');
    }
    if (args.value === null || args.value === undefined) {
      throw new Error('--value is required for assert-count action');
    }

    const elements = await page.$$(args.selector);
    const expected = parseInt(args.value);
    if (elements.length !== expected) {
      throw new Error(`Assertion failed: Expected ${expected} elements for "${args.selector}", found ${elements.length}`);
    }
    return { success: true, action: 'assert-count', selector: args.selector, count: elements.length };
  },

  // ============================================
  // IFRAME ACTIONS (Phase 1.2)
  // ============================================

  async 'iframe-click'(page, args) {
    if (!args.frame) {
      throw new Error('--frame is required for iframe-click action');
    }
    if (!args.selector) {
      throw new Error('--selector is required for iframe-click action');
    }

    const frameLocator = page.frameLocator(args.frame);
    await frameLocator.locator(args.selector).click();
    await page.waitForLoadState('networkidle').catch(() => {});

    const filename = getTimestampedPath('after-iframe-click');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'iframe-click', frame: args.frame, selector: args.selector };
  },

  async 'iframe-fill'(page, args) {
    if (!args.frame) {
      throw new Error('--frame is required for iframe-fill action');
    }
    if (!args.selector) {
      throw new Error('--selector is required for iframe-fill action');
    }
    if (args.value === null || args.value === undefined) {
      throw new Error('--value is required for iframe-fill action');
    }

    const frameLocator = page.frameLocator(args.frame);
    await frameLocator.locator(args.selector).fill(args.value);

    const filename = getTimestampedPath('after-iframe-fill');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'iframe-fill', frame: args.frame, selector: args.selector };
  },

  async 'iframe-type'(page, args) {
    if (!args.frame) {
      throw new Error('--frame is required for iframe-type action');
    }
    if (!args.selector) {
      throw new Error('--selector is required for iframe-type action');
    }
    if (!args.value) {
      throw new Error('--value is required for iframe-type action');
    }

    const frameLocator = page.frameLocator(args.frame);
    await frameLocator.locator(args.selector).pressSequentially(args.value, { delay: args.typingDelay || 50 });

    const filename = getTimestampedPath('after-iframe-type');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'iframe-type', frame: args.frame, selector: args.selector };
  },

  async 'iframe-getText'(page, args) {
    if (!args.frame) {
      throw new Error('--frame is required for iframe-getText action');
    }
    if (!args.selector) {
      throw new Error('--selector is required for iframe-getText action');
    }

    const frameLocator = page.frameLocator(args.frame);
    const text = await frameLocator.locator(args.selector).textContent();

    return { success: true, action: 'iframe-getText', frame: args.frame, selector: args.selector, text };
  },

  async 'iframe-screenshot'(page, args) {
    if (!args.frame) {
      throw new Error('--frame is required for iframe-screenshot action');
    }

    const frameLocator = page.frameLocator(args.frame);
    const frameElement = await page.$(args.frame);

    const filename = getTimestampedPath('iframe-screenshot');
    if (frameElement) {
      await frameElement.screenshot({ path: filename });
    } else {
      // Fallback to page screenshot
      await page.screenshot({ path: filename });
    }

    return { success: true, file: filename, action: 'iframe-screenshot', frame: args.frame };
  },

  // ============================================
  // NAVIGATION ACTIONS (Phase 1.3)
  // ============================================

  async 'go-back'(page, args) {
    await page.goBack({ waitUntil: 'networkidle', timeout: args.timeout || 30000 });

    const filename = getTimestampedPath('after-go-back');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'go-back', url: page.url() };
  },

  async 'go-forward'(page, args) {
    await page.goForward({ waitUntil: 'networkidle', timeout: args.timeout || 30000 });

    const filename = getTimestampedPath('after-go-forward');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'go-forward', url: page.url() };
  },

  async 'click-new-tab'(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for click-new-tab action');
    }

    const context = page.context();

    // Wait for new page/tab to open
    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      page.click(args.selector)
    ]);

    // Wait for new page to load
    await newPage.waitForLoadState('networkidle').catch(() => {});

    const filename = getTimestampedPath('new-tab');
    await newPage.screenshot({ path: filename });

    return {
      success: true,
      file: filename,
      action: 'click-new-tab',
      selector: args.selector,
      newTabUrl: newPage.url(),
      // Note: The new page is now available via context
      message: 'New tab opened. Use session to continue on the new tab.'
    };
  },

  async 'reload'(page, args) {
    await page.reload({ waitUntil: 'networkidle', timeout: args.timeout || 30000 });

    const filename = getTimestampedPath('after-reload');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'reload', url: page.url() };
  },

  // ============================================
  // FILE UPLOAD ACTION (Phase 1.4)
  // ============================================

  async 'upload'(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for upload action');
    }
    if (!args.file && !args.files) {
      throw new Error('--file or --files is required for upload action');
    }

    const files = args.files || [args.file];

    // Verify files exist
    for (const file of files) {
      if (!fs.existsSync(file)) {
        throw new Error(`File not found: ${file}`);
      }
    }

    // Set input files
    await page.setInputFiles(args.selector, files);

    const filename = getTimestampedPath('after-upload');
    await page.screenshot({ path: filename });

    return {
      success: true,
      file: filename,
      action: 'upload',
      selector: args.selector,
      uploadedFiles: files
    };
  },

  // ============================================
  // DRAG & DROP ACTION (Phase 1.5)
  // ============================================

  async 'drag'(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for drag action (source element)');
    }
    if (!args.target) {
      throw new Error('--target is required for drag action (destination element)');
    }

    await page.dragAndDrop(args.selector, args.target);

    const filename = getTimestampedPath('after-drag');
    await page.screenshot({ path: filename });

    return {
      success: true,
      file: filename,
      action: 'drag',
      source: args.selector,
      target: args.target
    };
  },

  async 'drag-by-offset'(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for drag-by-offset action');
    }
    if (args.x === undefined && args.y === undefined) {
      throw new Error('--x or --y offset is required for drag-by-offset action');
    }

    const element = await page.$(args.selector);
    if (!element) {
      throw new Error(`Element not found: ${args.selector}`);
    }

    const box = await element.boundingBox();
    if (!box) {
      throw new Error(`Cannot get bounding box of element: ${args.selector}`);
    }

    // Start position: center of element
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // End position: offset from start
    const endX = startX + (args.x || 0);
    const endY = startY + (args.y || 0);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();

    const filename = getTimestampedPath('after-drag-offset');
    await page.screenshot({ path: filename });

    return {
      success: true,
      file: filename,
      action: 'drag-by-offset',
      selector: args.selector,
      offsetX: args.x || 0,
      offsetY: args.y || 0
    };
  },

  // ============================================
  // ADDITIONAL USEFUL ACTIONS
  // ============================================

  async 'double-click'(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for double-click action');
    }

    await page.dblclick(args.selector);
    await page.waitForLoadState('networkidle').catch(() => {});

    const filename = getTimestampedPath('after-double-click');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'double-click', selector: args.selector };
  },

  async 'right-click'(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for right-click action');
    }

    await page.click(args.selector, { button: 'right' });

    const filename = getTimestampedPath('after-right-click');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'right-click', selector: args.selector };
  },

  async 'check'(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for check action');
    }

    await page.check(args.selector);

    const filename = getTimestampedPath('after-check');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'check', selector: args.selector };
  },

  async 'uncheck'(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for uncheck action');
    }

    await page.uncheck(args.selector);

    const filename = getTimestampedPath('after-uncheck');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'uncheck', selector: args.selector };
  },

  async 'get-attribute'(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for get-attribute action');
    }
    if (!args.attribute) {
      throw new Error('--attribute is required for get-attribute action');
    }

    const value = await page.getAttribute(args.selector, args.attribute);

    return { success: true, action: 'get-attribute', selector: args.selector, attribute: args.attribute, value };
  },

  async 'get-value'(page, args) {
    if (!args.selector) {
      throw new Error('--selector is required for get-value action');
    }

    const value = await page.inputValue(args.selector);

    return { success: true, action: 'get-value', selector: args.selector, value };
  },

  async 'set-viewport'(page, args) {
    const width = args.width || 1280;
    const height = args.height || 720;

    await page.setViewportSize({ width, height });

    const filename = getTimestampedPath('after-set-viewport');
    await page.screenshot({ path: filename });

    return { success: true, file: filename, action: 'set-viewport', width, height };
  }
};

module.exports = {
  actions,
  getTimestampedPath,
  SCREENSHOTS_DIR
};
