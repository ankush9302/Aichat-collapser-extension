# Privacy Policy for Chat Collapser

**Last updated:** February 15, 2026

## Overview

Chat Collapser is a Chrome extension that collapses older AI responses in long chat threads on Claude.ai and ChatGPT.com. It operates entirely within your browser.

## Data Collection

Chat Collapser does **not** collect, transmit, or share any personal data or browsing information.

## Data Storage

The extension stores only the collapse/expand state of message pairs using Chrome's local storage API (`chrome.storage.local`). This data:

- Is stored **entirely on your device**
- Is keyed by the URL path of the conversation
- Is never transmitted to any server or third party
- Is automatically removed when you uninstall the extension

## Permissions

- **storage**: Used to remember which messages you have collapsed or expanded across page reloads. No data leaves your device.

## Host Permissions

The extension runs content scripts on:

- `https://claude.ai/*`
- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

These permissions are required solely to inject the collapse/expand UI into the chat pages. The extension does not read, modify, or transmit your conversation content.

## Third-Party Services

Chat Collapser does not use any third-party analytics, tracking, or advertising services.

## Changes to This Policy

Any changes to this privacy policy will be reflected in updated versions of the extension.

## Contact

If you have questions about this privacy policy, please open an issue on the project's GitHub repository.
