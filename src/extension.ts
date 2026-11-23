import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SqlFileProvider } from './sidebarProvider';
import { ErModel } from './model/models';

type ExportFormat = 'png' | 'svg' | 'mermaid' | 'json';

// Binary formats arrive as base64 data URIs, text formats as plain strings.
const EXPORT_FORMATS: Record<ExportFormat, { ext: string; filterName: string; mime?: string }> = {
    png: { ext: 'png', filterName: 'PNG Images', mime: 'image/png' },
    svg: { ext: 'svg', filterName: 'SVG Images', mime: 'image/svg+xml' },
    mermaid: { ext: 'mmd', filterName: 'Mermaid Diagrams' },
    json: { ext: 'json', filterName: 'JSON' }
};

const MESSAGE_TO_FORMAT = new Map<string, ExportFormat>([
    ['downloadPNG', 'png'],
    ['downloadSVG', 'svg'],
    ['downloadMermaid', 'mermaid'],
    ['downloadJSON', 'json']
]);

async function saveExport(format: ExportFormat, data: unknown, folderName: string, rootPath: string) {
    const { ext, filterName, mime } = EXPORT_FORMATS[format];
    const prefix = mime ? `data:${mime};base64,` : undefined;
    const valid = typeof data === 'string' && (prefix ? data.startsWith(prefix) : data.length > 0);
    if (!valid) {
        vscode.window.showErrorMessage(`Could not export ${format.toUpperCase()}: the diagram is too large or could not be rendered.`);
        return;
    }
    try {
        const defaultFileName = `er-${folderName}-${new Date().toISOString().split('T')[0]}.${ext}`;
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(rootPath, defaultFileName)),
            filters: { [filterName]: [ext] }
        });
        if (uri) {
            const content = prefix ? Buffer.from((data as string).slice(prefix.length), 'base64') : (data as string);
            await fs.promises.writeFile(uri.fsPath, content);
            vscode.window.showInformationMessage(`Diagram saved to: ${uri.fsPath}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Error saving ${format.toUpperCase()} file.`);
        console.error(error);
    }
}

async function scanAndShowDiagram(provider: SqlFileProvider, context: vscode.ExtensionContext) {
    const rootPath = provider.currentRoot;
    if (!rootPath) {
        vscode.window.showErrorMessage('No SQL folder selected.');
        return;
    }
    const folderName = path.basename(rootPath);

    try {
        const model = await provider.getModel();
        const realTables = model.tables.filter(t => !t.external).length;
        if (realTables === 0) {
            vscode.window.showWarningMessage('No CREATE TABLE statements found in the .sql files of this folder.');
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'sqlDbMap',
            `${folderName} (${realTables} tables)`,
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
            }
        );
        panel.webview.html = getHtmlForWebview(context, panel.webview, model);

        const messageDisposable = panel.webview.onDidReceiveMessage(async (message) => {
            const format = MESSAGE_TO_FORMAT.get(message?.type);
            if (format) {
                await saveExport(format, message.data, folderName, rootPath);
            }
        });

        const configListener = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('sql-dbmap.columnDisplay')) {
                panel.webview.postMessage({
                    type: 'updateConfig',
                    config: { columnDisplay: vscode.workspace.getConfiguration('sql-dbmap').get<string>('columnDisplay', 'all') }
                });
            }
        });

        panel.onDidDispose(() => {
            messageDisposable.dispose();
            configListener.dispose();
        });
    } catch (error) {
        vscode.window.showErrorMessage('Error processing SQL files.');
        console.error(error);
    }
}

const ROOT_STATE_KEY = 'sql-dbmap.selectedRoot';

export function activate(context: vscode.ExtensionContext) {
    // Prefer the folder the user picked last time; fall back to the first workspace folder.
    const savedRoot = context.workspaceState.get<string>(ROOT_STATE_KEY);
    const initialRoot = (savedRoot && fs.existsSync(savedRoot)) ? savedRoot : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '');

    const provider = new SqlFileProvider(initialRoot);
    const treeView = vscode.window.createTreeView('sqlDbMapView', { treeDataProvider: provider });
    provider.onStatusChange = message => { treeView.message = message; };
    context.subscriptions.push(treeView);

    context.subscriptions.push(
        vscode.commands.registerCommand('sql-dbmap.selectFolder', async () => {
            const folders = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: 'Select SQL Folder'
            });
            if (folders && folders.length > 0) {
                await context.workspaceState.update(ROOT_STATE_KEY, folders[0].fsPath);
                provider.setRoot(folders[0].fsPath);
            }
        }),
        vscode.commands.registerCommand('sql-dbmap.visualize', async () => {
            if (!provider.currentRoot) {
                vscode.window.showWarningMessage('Please select a SQL folder first.');
                return;
            }
            await scanAndShowDiagram(provider, context);
        }),
        vscode.commands.registerCommand('sql-dbmap.refresh', () => provider.refresh())
    );
}

/** Serializes data for embedding inside an inline <script>: `<` is escaped so `</script>` or `<!--` cannot break out. */
function toInlineJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function getHtmlForWebview(context: vscode.ExtensionContext, webview: vscode.Webview, model: ErModel): string {
    const html = fs.readFileSync(path.join(context.extensionPath, 'media', 'index.html'), 'utf-8');
    const mediaUri = webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media'))).toString();
    const config = { columnDisplay: vscode.workspace.getConfiguration('sql-dbmap').get<string>('columnDisplay', 'all') };

    // Replacer functions (not strings) so `$&`, `$'` etc. inside the data are never interpreted.
    return html
        .replace(/\{\{cspSource\}\}/g, () => webview.cspSource)
        .replace(/\{\{mediaUri\}\}/g, () => mediaUri)
        .replace('{{userConfig}}', () => toInlineJson(config))
        .replace('{{erModel}}', () => toInlineJson(model));
}

export function deactivate() { }
