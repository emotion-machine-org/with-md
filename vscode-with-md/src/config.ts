import * as vscode from 'vscode';

export function getBaseUrl(): string {
  return vscode.workspace.getConfiguration('with-md').get<string>('baseUrl') ?? 'https://with.md';
}
