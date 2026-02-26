import * as vscode from 'vscode';
import { detectGitHubRepo, getGitHeadContent } from './git-utils';
import { getWebviewHtml } from './webview';

export class WithMdEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'with-md.markdownEditor';

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new WithMdEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(
      WithMdEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
      },
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
    };

    webviewPanel.webview.html = getWebviewHtml(webviewPanel.webview);

    // Detect git context
    const repoInfo = detectGitHubRepo(document.uri);
    const mode = repoInfo ? 'repo' : 'local';

    // Counter to prevent circular updates (counter instead of boolean avoids
    // races when multiple edits overlap)
    let pendingWebviewEdits = 0;

    // Track whether the embed page is in collab mode (Hocuspocus connected).
    // When active, Yjs is the source of truth — we must not send contentUpdate
    // messages back to the embed because the local file is being overwritten by
    // Hocuspocus content via contentChanged.
    let collabActive = false;

    // Handle messages from the webview
    const messageDisposable = webviewPanel.webview.onDidReceiveMessage((message: { type: string; content?: string; githubToken?: string; active?: boolean }) => {
      switch (message.type) {
        case 'ready': {
          // iframe is ready — send initial content and mode info
          void (async () => {
            const initMessage: Record<string, unknown> = {
              type: 'init',
              content: document.getText(),
              mode,
            };
            if (repoInfo) {
              initMessage.owner = repoInfo.owner;
              initMessage.repo = repoInfo.repo;
              initMessage.path = repoInfo.path;
            }

            // Try to get a GitHub token from VSCode's built-in auth.
            // Uses { silent: true } first to avoid prompting — if the user
            // is already signed in to GitHub in VSCode, we get the token
            // for free. If not, we skip and let the embed page show a
            // login button (which triggers createIfNone on demand).
            try {
              const session = await vscode.authentication.getSession('github', ['user:email'], { silent: true });
              if (session) {
                initMessage.githubToken = session.accessToken;
              }
            } catch {
              // No GitHub session available — that's fine
            }

            webviewPanel.webview.postMessage(initMessage);
          })();
          break;
        }

        case 'requestLogin': {
          // User clicked login in the embed page — prompt VSCode's GitHub auth
          void (async () => {
            try {
              const session = await vscode.authentication.getSession('github', ['user:email'], { createIfNone: true });
              if (session) {
                webviewPanel.webview.postMessage({
                  type: 'githubToken',
                  githubToken: session.accessToken,
                });
              }
            } catch {
              // User cancelled the auth prompt
            }
          })();
          break;
        }

        case 'collabStatus': {
          collabActive = message.active === true;
          break;
        }

        case 'requestDiff': {
          void (async () => {
            try {
              const headContent = await getGitHeadContent(document.uri);
              webviewPanel.webview.postMessage({
                type: 'diffContent',
                content: headContent,
              });
            } catch {
              webviewPanel.webview.postMessage({
                type: 'diffContent',
                content: null,
              });
            }
          })();
          break;
        }

        case 'requestRevert': {
          void (async () => {
            try {
              const headContent = await getGitHeadContent(document.uri);
              if (headContent === null) return;

              const currentText = document.getText();
              if (headContent === currentText) {
                // Already at HEAD — just ensure the file is saved
                if (document.isDirty) await document.save();
                return;
              }

              // Update the embed editor
              webviewPanel.webview.postMessage({
                type: 'contentUpdate',
                content: headContent,
              });

              // Replace document text
              pendingWebviewEdits++;
              const edit = new vscode.WorkspaceEdit();
              edit.replace(
                document.uri,
                new vscode.Range(0, 0, document.lineCount, 0),
                headContent,
              );
              const success = await vscode.workspace.applyEdit(edit);
              pendingWebviewEdits--;

              // Save so VS Code no longer shows the file as modified
              if (success) await document.save();
            } catch {
              // Failed to revert
            }
          })();
          break;
        }

        case 'contentChanged': {
          if (typeof message.content !== 'string') return;

          const currentText = document.getText();
          if (message.content === currentText) return;

          pendingWebviewEdits++;
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            message.content,
          );
          vscode.workspace.applyEdit(edit).then(() => {
            pendingWebviewEdits--;
          }, () => {
            pendingWebviewEdits--;
          });
          break;
        }
      }
    });

    // Watch for external changes to the document
    const changeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) return;
      if (pendingWebviewEdits > 0) return;
      if (event.contentChanges.length === 0) return;
      // In collab mode, Yjs is the source of truth. Don't send file changes
      // back to the embed — they'd conflict with the Hocuspocus document.
      if (collabActive) return;

      webviewPanel.webview.postMessage({
        type: 'contentUpdate',
        content: document.getText(),
      });
    });

    webviewPanel.onDidDispose(() => {
      messageDisposable.dispose();
      changeDisposable.dispose();
    });
  }
}
