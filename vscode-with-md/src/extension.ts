import * as vscode from 'vscode';
import { WithMdEditorProvider } from './editor-provider';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(WithMdEditorProvider.register(context));
}

export function deactivate() {}
