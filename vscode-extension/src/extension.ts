import { basename, dirname, join } from "node:path";
import * as vscode from "vscode";
import { listRuns, listTests, testAtLine, TESTFILE_NAMES, type RunInfo } from "./testfile-doc.js";

function isTestfileDocument(document: vscode.TextDocument): boolean {
  return TESTFILE_NAMES.includes(basename(document.fileName));
}

function testfileCommand(): string {
  return (
    vscode.workspace.getConfiguration("testfile").get<string>("command", "testfile") || "testfile"
  );
}

function viewerCommand(): string {
  return (
    vscode.workspace.getConfiguration("testfile").get<string>("viewerCommand", "testfile-viewer") ||
    "testfile-viewer"
  );
}

// All commands run in one shared "Testfile" terminal, so runs, the TUI and
// the viewer behave exactly like they do outside the editor.
function runInTerminal(args: string, cwd: string | undefined, command = testfileCommand()): void {
  let terminal = vscode.window.terminals.find((t) => t.name === "Testfile");
  if (!terminal || terminal.exitStatus !== undefined) {
    terminal = vscode.window.createTerminal({ name: "Testfile", cwd });
  }
  terminal.show(true);
  terminal.sendText(`${command} ${args}`);
}

function workspaceDirOf(uri: vscode.Uri | undefined): string | undefined {
  if (uri && TESTFILE_NAMES.includes(basename(uri.fsPath))) return dirname(uri.fsPath);
  if (uri) return uri.fsPath;
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// "▶ run" above every test in a Testfile.
class TestfileCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!isTestfileDocument(document)) return [];
    return listTests(document.getText()).map(
      (test) =>
        new vscode.CodeLens(new vscode.Range(test.line, 0, test.line, 0), {
          title: `▶ run ${test.isGroup ? `${test.name} (with nested tests)` : test.name}`,
          tooltip: `testfile run -n "${test.path}"`,
          command: "testfile.runTest",
          arguments: [document.uri, test.path],
        }),
    );
  }
}

type RunTreeNode = { kind: "run"; run: RunInfo } | { kind: "test"; run: RunInfo; index: number };

const STATUS_ICON: Record<string, vscode.ThemeIcon> = {
  passed: new vscode.ThemeIcon("check", new vscode.ThemeColor("testing.iconPassed")),
  failed: new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed")),
  aborted: new vscode.ThemeIcon("circle-slash", new vscode.ThemeColor("testing.iconErrored")),
  skipped: new vscode.ThemeIcon("debug-step-over", new vscode.ThemeColor("testing.iconSkipped")),
};

function formatMs(ms?: number): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

// The "Testfile Runs" explorer view: recent runs with their tests; a test
// with a log opens it on click.
class RunsTreeProvider implements vscode.TreeDataProvider<RunTreeNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  private baseDir(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  getChildren(element?: RunTreeNode): RunTreeNode[] {
    const base = this.baseDir();
    if (!base) return [];
    if (!element) return listRuns(base).map((run) => ({ kind: "run", run }));
    if (element.kind === "run") {
      return element.run.tests.map((_, index) => ({ kind: "test", run: element.run, index }));
    }
    return [];
  }

  getTreeItem(element: RunTreeNode): vscode.TreeItem {
    if (element.kind === "run") {
      const run = element.run;
      const item = new vscode.TreeItem(
        run.startedAt.replace("T", " ").slice(0, 19),
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.id = run.id;
      item.description = `${run.status} · ${formatMs(run.durationMs)}`;
      item.iconPath = STATUS_ICON[run.status] ?? new vscode.ThemeIcon("circle-outline");
      item.tooltip = `run ${run.id}`;
      return item;
    }
    const test = element.run.tests[element.index];
    const item = new vscode.TreeItem(test.path, vscode.TreeItemCollapsibleState.None);
    item.id = `${element.run.id}/${test.path}`;
    item.description = `${test.status}${test.durationMs !== undefined ? ` · ${formatMs(test.durationMs)}` : ""}`;
    item.iconPath = STATUS_ICON[test.status] ?? new vscode.ThemeIcon("circle-outline");
    if (test.log) {
      item.command = {
        title: "Open log",
        command: "vscode.open",
        arguments: [vscode.Uri.file(join(element.run.dir, test.log))],
      };
      item.tooltip = "open the recorded log";
    }
    return item;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  void vscode.commands.executeCommand("setContext", "testfile.hasTestfile", true);

  const runs = new RunsTreeProvider();
  const selector = TESTFILE_NAMES.map((name) => ({ pattern: `**/${name}` }));

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("testfileRuns", runs),
    vscode.languages.registerCodeLensProvider(selector, new TestfileCodeLensProvider()),

    vscode.commands.registerCommand("testfile.runAll", () => {
      runInTerminal("run", workspaceDirOf(vscode.window.activeTextEditor?.document.uri));
    }),

    vscode.commands.registerCommand("testfile.runTest", (uri?: vscode.Uri, path?: string) => {
      const editor = vscode.window.activeTextEditor;
      if (path === undefined && editor && isTestfileDocument(editor.document)) {
        const found = testAtLine(
          listTests(editor.document.getText()),
          editor.selection.active.line,
        );
        if (!found) {
          void vscode.window.showInformationMessage("No test found at the cursor.");
          return;
        }
        uri = editor.document.uri;
        path = found.path;
      }
      if (path === undefined) {
        void vscode.window.showInformationMessage(
          "Open a Testfile and place the cursor on a test.",
        );
        return;
      }
      runInTerminal(`run -n "${path}"`, workspaceDirOf(uri));
    }),

    vscode.commands.registerCommand("testfile.doctor", () => {
      runInTerminal("doctor", workspaceDirOf(vscode.window.activeTextEditor?.document.uri));
    }),

    vscode.commands.registerCommand("testfile.openTui", () => {
      runInTerminal(
        "tui",
        workspaceDirOf(vscode.window.activeTextEditor?.document.uri),
        viewerCommand(),
      );
    }),

    vscode.commands.registerCommand("testfile.serve", () => {
      runInTerminal(
        "serve",
        workspaceDirOf(vscode.window.activeTextEditor?.document.uri),
        viewerCommand(),
      );
    }),

    vscode.commands.registerCommand("testfile.refreshRuns", () => runs.refresh()),
  );

  // New recorded runs appear in the view automatically.
  const watcher = vscode.workspace.createFileSystemWatcher("**/.testfile/runs/**");
  watcher.onDidCreate(() => runs.refresh());
  watcher.onDidChange(() => runs.refresh());
  watcher.onDidDelete(() => runs.refresh());
  context.subscriptions.push(watcher);
}

export function deactivate(): void {
  // nothing to clean up: subscriptions are disposed by the host
}
