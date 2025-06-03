/* eslint-disable style/brace-style */
/* eslint-disable style/comma-dangle */
/* eslint-disable antfu/if-newline */
/* eslint-disable style/operator-linebreak */
import type { Got } from 'got'
import * as os from 'node:os'
import { got } from 'got'

import osName from 'os-name'
import { v4 } from 'uuid'
import * as vscode from 'vscode'
import * as events from './events'
import { getDurationText } from './getDurationText'
import { getGitCurrentBranch, getGitOriginUrl } from './utils'

export class CodeTime {
  osName = osName()
  out: vscode.OutputChannel = vscode.window.createOutputChannel('Codetime')
  private debounceTimer?: NodeJS.Timeout

  private debounce(func: any, wait: number) {
    return (...args: any) => {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = setTimeout(() => func.apply(this, args), wait)
    }
  }

  setURL() {
    vscode.window
      .showInputBox({
        password: false,
        placeHolder: 'Lifeforge CodeTime: Input Your Lifeforge API host URL',
      })
      .then((url) => {
        if (url && this.isURL(url)) {
          this.state.update('lifeforgeAPIHost', url)
          this.lifeforgeAPIHost = url
          this.getCurrentDuration(true)
        } else {
          vscode.window.showErrorMessage('Please enter a valid URL')
          this.statusBar.text =
            '$(clock) Lifeforge CodeTime: Cannot connect to Lifeforge'
          this.statusBar.tooltip = 'Enter Lifeforge API host URL'
          this.statusBar.command = 'codetime.getURL'
          this.lifeforgeAPIHost = ''
        }
      })
  }

  private statusBar: vscode.StatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left
  )

  public disposable!: vscode.Disposable
  state: vscode.Memento
  client: Got
  userId: number
  lifeforgeAPIHost: string = ''
  inter!: NodeJS.Timeout
  session: string
  constructor(state: vscode.Memento) {
    this.state = state
    this.userId = this.getUserId()
    this.initSetURL()
    this.client = got.extend({
      prefixUrl: this.lifeforgeAPIHost,
      responseType: 'json',
      headers: {
        'User-Agent': 'CodeTime Client',
      },
    })
    this.session = v4()
    this.init()
  }

  getUserId(): number {
    return 2
  }

  isURL(url: string) {
    return /^https?:\/\/[^\s/$.?#].\S*$/.test(url)
  }

  initSetURL() {
    const stateURL = this.state.get<string>('lifeforgeAPIHost')
    this.lifeforgeAPIHost = stateURL || ''
    if (this.lifeforgeAPIHost === '') this.setURL()
  }

  private init(): void {
    this.statusBar.text = '$(clock) Lifeforge CodeTime: Initializing...'
    this.statusBar.show()
    this.setupEventListeners()
    this.getCurrentDuration()
    this.inter = setInterval(() => {
      this.getCurrentDuration()
      // TODO: Upload Local Data
      // this.uploadLocalData();
    }, 60 * 1000)
  }

  private setupEventListeners(): void {
    // subscribe to selection change and editor activation events
    const events: vscode.Disposable[] = []
    vscode.workspace.onDidChangeTextDocument(this.onEdit, this, events)
    vscode.window.onDidChangeActiveTextEditor(this.onEditor, this, events)
    vscode.window.onDidChangeTextEditorSelection(
      this.onChangeTextEditorSelection,
      this,
      events
    )
    vscode.window.onDidChangeTextEditorVisibleRanges(
      this.onChangeTextEditorVisibleRanges,
      this,
      events
    )
    vscode.window.onDidChangeWindowState(this.onFocus, this, events)
    vscode.workspace.onDidSaveTextDocument(this.onSave, this, events)
    vscode.workspace.onDidCreateFiles(this.onCreate, this, events)
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codetime')) this.getCurrentDuration()
    })
    this.disposable = vscode.Disposable.from(...events)
  }

  private onEdit(e: vscode.TextDocumentChangeEvent) {
    let eventName = events.FILE_EDITED
    // 如果 document 是 output channel 的话，不记录
    if (e.document.uri.scheme === 'output') return

    if (
      e.contentChanges.length === 1 &&
      /\r\n|\n|\r/.test(e.contentChanges[0].text)
    ) {
      eventName = events.FILE_ADDED_LINE
      this.onChange(eventName)
    } else if (Math.random() > 0.9) {
      this.onChange(eventName)
    }
  }

  private onEditor(_e: vscode.TextEditor | undefined) {
    this.onChange(events.ACTIVATE_FILE_CHANGED)
  }

  private onChangeTextEditorSelection(
    e: vscode.TextEditorSelectionChangeEvent
  ) {
    if (e.textEditor.document.uri.scheme === 'output') return

    if (Math.random() > 0.9) this.onChange(events.CHANGE_EDITOR_SELECTION)
  }

  private onChangeTextEditorVisibleRanges = this.debounce(
    (_e: vscode.TextEditorVisibleRangesChangeEvent) => {
      if (_e.textEditor.document.uri.scheme === 'output') return

      this.onChange(events.CHANGE_EDITOR_VISIBLE_RANGES)
    },
    300
  ) // 300毫秒的节流时间

  private onFocus(_e: vscode.WindowState) {
    this.onChange(events.EDITOR_CHANGED)
  }

  private onCreate() {
    this.onChange(events.FILE_CREATED)
  }

  private onSave(_e: vscode.TextDocument) {
    this.onChange(events.FILE_SAVED)
  }

  platfromVersion = os.release()
  platfromArch = os.arch()

  private getOperationType(eventName = 'unknown'): 'read' | 'write' {
    switch (eventName) {
      case events.FILE_CREATED:
      case events.FILE_EDITED:
      case events.FILE_ADDED_LINE:
      case events.FILE_REMOVED:
      case events.FILE_SAVED:
        return 'write'
      default:
        return 'read'
    }
  }

  private onChange(eventName = 'unknown') {
    const editor = vscode.window.activeTextEditor
    const workspaceName = vscode.workspace.name
    const workspaceRoot = vscode.workspace.workspaceFolders
    if (workspaceRoot && editor) {
      const doc = editor.document
      if (doc) {
        const lang: string = doc.languageId
        const absoluteFilePath = doc.fileName
        let relativeFilePath: string =
          vscode.workspace.asRelativePath(absoluteFilePath)
        if (relativeFilePath === absoluteFilePath)
          relativeFilePath = '[other workspace]'

        if (relativeFilePath) {
          const time: number = Date.now()
          const origin = getGitOriginUrl()
          const branch = getGitCurrentBranch()
          const data = {
            project: workspaceName,
            language: lang,
            relativeFile: relativeFilePath,
            absoluteFile: absoluteFilePath,
            editor: 'VSCode',
            platform: this.osName,
            eventTime: time,
            eventType: eventName,
            platformArch: this.platfromArch,
            plugin: 'VSCode',
            gitOrigin: origin,
            gitBranch: branch,
            operationType: this.getOperationType(eventName),
          }
          this.out.appendLine(JSON.stringify(data))
          // Post data
          this.client
            .post('code-time/eventLog', { json: data })
            .catch((e: { response: { statusCode: number } }) => {
              this.out.appendLine(`Error: ${e}`)
              // TODO: Append Data To Local
            })
        }
      }
    }
  }

  private getCurrentDuration(showSuccess = false) {
    const key = vscode.workspace.getConfiguration('codetime').statusBarInfo
    if (this.lifeforgeAPIHost === '') {
      this.statusBar.text =
        '$(clock) Lifeforge CodeTime: Without Lifeforge API host URL'
      this.statusBar.tooltip = 'Enter Lifeforge API host URL'
      this.statusBar.command = 'codetime.getURL'
      return
    }
    this.statusBar.command = 'codetime.toDashboard'
    this.statusBar.tooltip =
      'Lifeforge CodeTime: Head to the dashboard for statistics'
    let minutes = 60 * 24
    switch (key) {
      case 'today': {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
        const now = new Date(
          new Date().toLocaleString('en-US', { timeZone: tz })
        )
        const hours = now.getHours()
        minutes = now.getMinutes()
        minutes += hours * 60
        break
      }
      case 'total': {
        minutes = 60 * 24 * 365 * 100
        break
      }
      case '24h': {
        minutes = 60 * 24
        break
      }
      default: {
        minutes = 60 * 24 * 365 * 100
        break
      }
    }
    this.client
      .get<{ data: { minutes: number } }>(
        `code-time/user/minutes?minutes=${minutes}`
      )
      .then((res) => {
        const { minutes } = res.body.data
        this.statusBar.text = `$(watch) ${getDurationText(minutes * 60 * 1000)}`
        if (showSuccess) {
          vscode.window.showInformationMessage(
            'Lifeforge CodeTime: URL set successfully, please check the status bar'
          )
        }
      })
  }

  public codeTimeInStatBar() {
    vscode.window
      .showQuickPick(
        ['Total code time', '24h code time', 'Today code time'],
        {}
      )
      .then((v) => {
        let key = 'total'
        switch (v) {
          case '24h code time':
            key = '24h'
            break
          case 'Today code time':
            key = 'today'

            break
          default:
            break
        }
        vscode.workspace
          .getConfiguration('codetime')
          .update('statusBarInfo', key, true)
          .then(() => this.getCurrentDuration())
      })
  }

  public getURL() {
    return this.lifeforgeAPIHost
  }

  public dispose() {
    this.statusBar.dispose()
    this.disposable.dispose()
    clearInterval(this.inter)
  }
}
