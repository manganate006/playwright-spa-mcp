/**
 * HTTP Actions module
 * Provides HTTP request capabilities via Playwright's API context
 */

const { getTimestampedPath, SCREENSHOTS_DIR } = require('./actions');
const fs = require('fs');
const path = require('path');

/**
 * Parse headers from string or object
 * @param {string|object} headers - Headers as JSON string or object
 * @returns {object} Parsed headers
 */
function parseHeaders(headers) {
  if (!headers) return {};
  if (typeof headers === 'object') return headers;
  try {
    return JSON.parse(headers);
  } catch (e) {
    throw new Error(`Invalid headers JSON: ${e.message}`);
  }
}

/**
 * Parse body from string or object
 * @param {string|object} body - Body as JSON string or object
 * @returns {object|string} Parsed body
 */
function parseBody(body) {
  if (!body) return undefined;
  if (typeof body === 'object') return body;
  try {
    return JSON.parse(body);
  } catch (e) {
    // Return as-is if not JSON (could be form data, plain text, etc.)
    return body;
  }
}

/**
 * Save response to file
 * @param {object} response - HTTP response object
 * @param {string} prefix - Filename prefix
 * @returns {string} Path to saved file
 */
async function saveResponse(response, prefix = 'http-response') {
  const contentType = response.headers()['content-type'] || '';
  let extension = 'txt';

  if (contentType.includes('application/json')) {
    extension = 'json';
  } else if (contentType.includes('text/html')) {
    extension = 'html';
  } else if (contentType.includes('text/xml') || contentType.includes('application/xml')) {
    extension = 'xml';
  }

  const filename = getTimestampedPath(prefix, extension);
  const body = await response.text().catch(() => '');

  fs.writeFileSync(filename, body);
  return filename;
}

/**
 * HTTP action handlers
 */
const httpActions = {
  /**
   * Generic HTTP request
   */
  async 'http-request'(page, args) {
    const { httpUrl, httpMethod = 'GET', httpBody, httpHeaders, bearerToken, timeout = 30000 } = args;

    if (!httpUrl) {
      throw new Error('--http-url is required for http-request action');
    }

    const context = page.context();
    const request = context.request;

    const headers = parseHeaders(httpHeaders);
    if (bearerToken) {
      headers['Authorization'] = `Bearer ${bearerToken}`;
    }

    const requestOptions = {
      timeout,
      headers
    };

    if (httpBody && ['POST', 'PUT', 'PATCH'].includes(httpMethod.toUpperCase())) {
      const body = parseBody(httpBody);
      if (typeof body === 'object') {
        requestOptions.data = body;
      } else {
        requestOptions.body = body;
      }
    }

    let response;
    switch (httpMethod.toUpperCase()) {
      case 'GET':
        response = await request.get(httpUrl, requestOptions);
        break;
      case 'POST':
        response = await request.post(httpUrl, requestOptions);
        break;
      case 'PUT':
        response = await request.put(httpUrl, requestOptions);
        break;
      case 'PATCH':
        response = await request.patch(httpUrl, requestOptions);
        break;
      case 'DELETE':
        response = await request.delete(httpUrl, requestOptions);
        break;
      case 'HEAD':
        response = await request.head(httpUrl, requestOptions);
        break;
      default:
        throw new Error(`Unsupported HTTP method: ${httpMethod}`);
    }

    const responseFile = await saveResponse(response, `http-${httpMethod.toLowerCase()}`);

    let responseBody;
    try {
      responseBody = await response.json();
    } catch (e) {
      responseBody = await response.text().catch(() => null);
    }

    return {
      success: true,
      action: 'http-request',
      method: httpMethod.toUpperCase(),
      url: httpUrl,
      status: response.status(),
      statusText: response.statusText(),
      headers: response.headers(),
      body: responseBody,
      file: responseFile
    };
  },

  /**
   * HTTP GET request
   */
  async 'http-get'(page, args) {
    return httpActions['http-request'](page, { ...args, httpMethod: 'GET' });
  },

  /**
   * HTTP POST request
   */
  async 'http-post'(page, args) {
    return httpActions['http-request'](page, { ...args, httpMethod: 'POST' });
  },

  /**
   * HTTP PUT request
   */
  async 'http-put'(page, args) {
    return httpActions['http-request'](page, { ...args, httpMethod: 'PUT' });
  },

  /**
   * HTTP PATCH request
   */
  async 'http-patch'(page, args) {
    return httpActions['http-request'](page, { ...args, httpMethod: 'PATCH' });
  },

  /**
   * HTTP DELETE request
   */
  async 'http-delete'(page, args) {
    return httpActions['http-request'](page, { ...args, httpMethod: 'DELETE' });
  },

  /**
   * HTTP HEAD request
   */
  async 'http-head'(page, args) {
    return httpActions['http-request'](page, { ...args, httpMethod: 'HEAD' });
  },

  /**
   * Fetch and wait for specific network response
   */
  async 'wait-for-response'(page, args) {
    const { urlPattern, timeout = 30000 } = args;

    if (!urlPattern) {
      throw new Error('--url-pattern is required for wait-for-response action');
    }

    const response = await page.waitForResponse(
      (resp) => resp.url().includes(urlPattern),
      { timeout }
    );

    let responseBody;
    try {
      responseBody = await response.json();
    } catch (e) {
      responseBody = await response.text().catch(() => null);
    }

    return {
      success: true,
      action: 'wait-for-response',
      urlPattern,
      url: response.url(),
      status: response.status(),
      headers: response.headers(),
      body: responseBody
    };
  },

  /**
   * Wait for network request
   */
  async 'wait-for-request'(page, args) {
    const { urlPattern, timeout = 30000 } = args;

    if (!urlPattern) {
      throw new Error('--url-pattern is required for wait-for-request action');
    }

    const request = await page.waitForRequest(
      (req) => req.url().includes(urlPattern),
      { timeout }
    );

    return {
      success: true,
      action: 'wait-for-request',
      urlPattern,
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      postData: request.postData()
    };
  },

  /**
   * Intercept and mock network requests
   */
  async 'mock-route'(page, args) {
    const { urlPattern, mockStatus = 200, mockBody, mockHeaders } = args;

    if (!urlPattern) {
      throw new Error('--url-pattern is required for mock-route action');
    }

    await page.route(urlPattern, (route) => {
      route.fulfill({
        status: mockStatus,
        headers: parseHeaders(mockHeaders),
        body: mockBody ? JSON.stringify(parseBody(mockBody)) : ''
      });
    });

    return {
      success: true,
      action: 'mock-route',
      urlPattern,
      mockStatus,
      message: `Route ${urlPattern} will be mocked with status ${mockStatus}`
    };
  },

  /**
   * Block network requests matching pattern
   */
  async 'block-route'(page, args) {
    const { urlPattern } = args;

    if (!urlPattern) {
      throw new Error('--url-pattern is required for block-route action');
    }

    await page.route(urlPattern, (route) => {
      route.abort();
    });

    return {
      success: true,
      action: 'block-route',
      urlPattern,
      message: `Requests matching ${urlPattern} will be blocked`
    };
  },

  /**
   * Capture all network traffic
   */
  async 'capture-network'(page, args) {
    const { duration = 5000 } = args;

    const requests = [];
    const responses = [];

    // Set up listeners
    const requestHandler = (request) => {
      requests.push({
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        postData: request.postData(),
        timestamp: Date.now()
      });
    };

    const responseHandler = (response) => {
      responses.push({
        url: response.url(),
        status: response.status(),
        headers: response.headers(),
        timestamp: Date.now()
      });
    };

    page.on('request', requestHandler);
    page.on('response', responseHandler);

    // Wait for specified duration
    await page.waitForTimeout(duration);

    // Remove listeners
    page.off('request', requestHandler);
    page.off('response', responseHandler);

    // Save to file
    const filename = getTimestampedPath('network-capture', 'json');
    fs.writeFileSync(filename, JSON.stringify({ requests, responses }, null, 2));

    return {
      success: true,
      action: 'capture-network',
      duration,
      requestCount: requests.length,
      responseCount: responses.length,
      file: filename
    };
  }
};

module.exports = {
  httpActions,
  parseHeaders,
  parseBody,
  saveResponse
};
