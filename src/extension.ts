import * as vscode from 'vscode'
import { CodeTime } from './codetime'

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
let codetime: CodeTime

export function activate(context: vscode.ExtensionContext) {
  codetime = new CodeTime(context.globalState)
  vscode.commands.registerCommand('codetime.getURL', () => {
    codetime.setURL()
  })
  vscode.commands.registerCommand('codetime.codeTimeInStatusBar', () => {
    codetime.codeTimeInStatBar()
  })
  vscode.commands.registerCommand('codetime.toDashboard', () => {
    const url = `${codetime.getURL()}/code-time`
    vscode.env.openExternal(vscode.Uri.parse(url))
  })
}

export function deactivate() {
  if (codetime) {
    codetime.dispose()
  }
}
