import * as vscode from 'vscode';
import { getBaseUrl } from './config';

/**
 * Generate the HTML content for the webview, containing an iframe pointing to
 * the with.md embed page and a postMessage bridge between the extension and iframe.
 */
export function getWebviewHtml(webview: vscode.Webview): string {
  const baseUrl = getBaseUrl();
  const embedUrl = `${baseUrl}/embed`;

  // Generate a nonce for the inline script
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${baseUrl}; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--vscode-editor-background, #1e1e1e);
    }
    iframe {
      border: none;
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <iframe id="editor-frame" src="${embedUrl}" sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const iframe = document.getElementById('editor-frame');

      // Route messages by type — event.source comparisons are unreliable
      // in VSCode webviews (extension host messages have source=null, and
      // cross-origin iframe source comparisons can also fail).
      // The message types are disjoint so routing by type is safe.
      window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || !data.type) return;

        // Messages from the iframe → forward to the extension host
        if (data.type === 'ready' || data.type === 'contentChanged' || data.type === 'requestLogin' || data.type === 'collabStatus' || data.type === 'requestRevert' || data.type === 'requestDiff') {
          vscode.postMessage(data);
        }

        // Messages from the extension host → forward to the iframe
        if (data.type === 'init' || data.type === 'contentUpdate' || data.type === 'githubToken' || data.type === 'diffContent') {
          iframe.contentWindow.postMessage(data, '*');
        }
      });
    })();
  </script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
