# 🎭 Playwright SPA MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io/)

> **The Playwright MCP server built for modern web apps.**
> Persistent sessions, React/Vue/Angular support, 143+ devices, and smart DOM waiting.

🇫🇷 *Serveur MCP Playwright optimisé pour les Single Page Applications modernes.*

---

## ✨ Why This Server?

| Feature | playwright-spa-mcp | Other Playwright MCPs |
|---------|:------------------:|:---------------------:|
| 🔄 Persistent sessions | ✅ | ❌ |
| ⚛️ React/Vue/Angular detection | ✅ | ❌ |
| ⏳ Smart DOM idle waiting | ✅ | ❌ |
| ⌨️ Realistic typing | ✅ | ❌ |
| 📱 Device emulation | 143+ | Limited |
| ⛓️ Action chains | ✅ | ❌ |
| 🍪 HTTP with browser cookies | ✅ | ❌ |

---

## 🚀 Quick Start

### Installation

```bash
# One command - no clone needed!
claude mcp add playwright-spa -- npx -y github:manganate006/playwright-spa-mcp

# Install Playwright browser
npx playwright install chromium
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "playwright-spa": {
      "command": "npx",
      "args": ["-y", "github:manganate006/playwright-spa-mcp"]
    }
  }
}
```

<details>
<summary>📦 Alternative: Clone & install locally</summary>

```bash
git clone https://github.com/manganate006/playwright-spa-mcp.git
cd playwright-spa-mcp
npm install
npx playwright install chromium

# Add to Claude
claude mcp add playwright-spa -- node $(pwd)/src/index.js
```
</details>

---

## 🛠️ Available Tools (22)

### 📸 Screenshot & Navigation
| Tool | Description |
|------|-------------|
| `spa_screenshot` | Screenshot with SPA support |
| `spa_navigate` | Navigate with device emulation |
| `spa_go_back` / `spa_go_forward` | Browser history |

### 📝 Form Interactions
| Tool | Description |
|------|-------------|
| `spa_click` | Click with DOM idle waiting |
| `spa_fill` | Fill input (React/Vue compatible) |
| `spa_type_realistic` | Type character-by-character ⌨️ |

### ⛓️ Action Chains
| Tool | Description |
|------|-------------|
| `spa_chain` | Execute multiple actions in sequence |

### 🔐 Sessions
| Tool | Description |
|------|-------------|
| `spa_session_start` | Start persistent session |
| `spa_session_end` | Close session |
| `spa_session_list` | List active sessions |

### 🌐 Advanced
| Tool | Description |
|------|-------------|
| `spa_http_request` | HTTP with browser cookies 🍪 |
| `spa_iframe_click` / `spa_iframe_fill` | iframe interactions |
| `spa_upload` | File upload |
| `spa_drag` | Drag and drop |
| `spa_evaluate` | Execute JavaScript |
| `spa_assert` | Assertions (exists, visible, text) |

---

## 💡 Usage Examples

### 🔐 Login to a React App

```javascript
// Start a persistent session
spa_session_start({ session: "myapp" })

// Login with realistic typing (triggers React onChange properly)
spa_chain({
  session: "myapp",
  url: "https://app.example.com/login",
  spaMode: "react",
  chain: [
    { action: "type-realistic", selector: "#email", value: "user@example.com" },
    { action: "type-realistic", selector: "#password", value: "secret123" },
    { action: "click", selector: "button[type=submit]" },
    { action: "wait-for-idle" },
    { action: "screenshot" }
  ]
})

// Continue with the same session - React state is preserved! 🎉
spa_click({ session: "myapp", selector: ".dashboard-item" })
```

### 📱 Mobile Device Testing

```javascript
spa_screenshot({
  url: "https://example.com",
  device: "iPhone 15 Pro",  // or use shortcut: "iphone-pro"
  fullPage: true
})
```

### 🍪 API Request with Browser Auth

```javascript
// After logging in, make API calls with session cookies
spa_http_request({
  session: "myapp",
  url: "https://api.example.com/user/profile",
  method: "GET"
})
// Cookies are automatically included!
```

---

## 📱 Device Shortcuts

| Shortcut | Device |
|----------|--------|
| `iphone` | iPhone 15 |
| `iphone-pro` | iPhone 15 Pro |
| `iphone-pro-max` | iPhone 15 Pro Max |
| `pixel` | Pixel 7 |
| `ipad` | iPad (gen 7) |
| `ipad-pro` | iPad Pro 11 |
| `desktop` | Desktop Chrome |
| `desktop-hd` | Desktop Chrome HiDPI |

> 💡 Use `spa_list_devices` to see all 143+ devices!

---

## ⛓️ Chain Actions Reference

### Browser
`screenshot` · `click` · `double-click` · `right-click` · `fill` · `type` · `type-realistic` · `hover` · `scroll`

### Navigation
`go-back` · `go-forward` · `reload`

### Waiting
`wait` · `wait-for` · `wait-for-idle` · `wait-for-spa`

### Form
`clear` · `check` · `uncheck` · `upload` · `focus` · `blur`

### Keyboard
`press` (Enter, Tab, Escape, etc.)

### Advanced
`drag` · `evaluate` · `iframe-click` · `iframe-fill`

---

## ⚛️ SPA Framework Support

### React
- ✅ Waits for React to finish rendering
- ✅ Proper `onChange` events for controlled inputs
- ✅ `type-realistic` for complex forms

### Vue
- ✅ Detects Vue instance
- ✅ Triggers v-model bindings correctly

### Angular
- ✅ Waits for Zone.js stability
- ✅ Handles async operations

> 💡 Use `spaMode: "auto"` for automatic detection!

---

## 🖥️ CLI Usage

```bash
# Simple screenshot
node browser.js --url "https://example.com" --action screenshot

# With device emulation
node browser.js --url "https://example.com" --device "iPhone 15" --action screenshot

# Action chain
node browser.js --url "https://site.com" --chain '[
  {"action": "fill", "selector": "#email", "value": "test@test.com"},
  {"action": "click", "selector": "button"},
  {"action": "screenshot"}
]'

# List all devices
node browser.js --list-devices

# List all actions
node browser.js --list-actions
```

---

## 📂 Project Structure

```
playwright-spa-mcp/
├── src/
│   ├── index.js          # MCP server entry point
│   └── server.js         # MCP server implementation (22 tools)
├── lib/
│   ├── actions.js        # Browser actions
│   ├── chain-executor.js # Chain execution engine
│   ├── devices.js        # 143+ device presets
│   ├── http-actions.js   # HTTP request actions
│   ├── session-manager.js
│   └── spa-utils.js      # SPA detection & waiting
├── browser.js            # CLI interface
├── browser-daemon.js     # Daemon mode
└── package.json
```

---

## 🌐 Projects Built With This MCP

| Project | Description |
|---------|-------------|
| [atp.mangi.fr](https://atp.mangi.fr) | 🎾 ATP Tennis Stats since 1968 |
| [piscinade.com](https://piscinade.com) | 🏊 Pool party finder in France |

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit PRs.

---

## 📄 License

MIT © 2024

---

<p align="center">
  <b>Built with ❤️ for Claude Code and Claude Desktop</b><br>
  <i>Making browser automation actually work with modern SPAs</i>
</p>
