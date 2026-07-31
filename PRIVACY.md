# Privacy Policy — NearbyShare Browser Extension

**Last updated: July 2026**

## Summary

NearbyShare does **NOT** collect, store, or transmit any personal data to external servers. All data stays on your local network.

## What data does the extension access?

| Data | Purpose | Where it goes |
|------|---------|---------------|
| Text you choose to send | Delivered to the local companion server on your own computer | Stays on your LAN (local area network) only |
| Files you choose to send | Uploaded to the local companion server | Stays on your LAN only |
| Selected text / page URL | Sent only when you explicitly use "Send via NearbyShare" | Stays on your LAN only |

## What data does the extension NOT access?

- Browsing history
- Passwords or credentials
- Cookies
- Any data from websites you visit (unless you explicitly right-click → "Send via NearbyShare")

## Network communication

The extension communicates **only** with a local companion server running on your own computer (typically `http://localhost:3000` or a private LAN IP address like `192.168.x.x`).

**No data is ever sent to the internet, cloud services, or third-party servers.**

## Permissions explained

| Permission | Why it's needed |
|------------|----------------|
| `contextMenus` | Right-click menu to send selected text/links/images |
| `storage` | Save your settings (server URL, display name) locally |
| `notifications` | Show a notification when a send succeeds or fails |
| `activeTab` | Read selected text from the current tab when you click "Send selection" |
| `clipboardWrite` | Copy LAN URLs to clipboard when you click them |
| `alarms` | Periodically check if the local server is running (every 15 seconds) |
| `scripting` | Read selected text from pages for the "Send selection" feature |
| `host_permissions` (localhost, LAN IPs) | Communicate with the local companion server |

## Third-party services

None. This extension uses zero third-party services, analytics, or tracking.

## Data retention

The extension stores only your settings (server URL and display name) in `chrome.storage.local`. No other data is retained. Uninstalling the extension removes all stored data.

## Open source

This extension is fully open source. You can inspect the entire source code at:
https://github.com/HveinBlg/NearbyShare

## Contact

For questions about this privacy policy, please open an issue on GitHub:
https://github.com/HveinBlg/NearbyShare/issues
