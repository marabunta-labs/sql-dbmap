import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ErModel } from './model/models';
import { parseSql } from './parser/sqlParser';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'cdk.out', '.vscode']);
const MAX_DEPTH = 8;

class SqlFileNode extends vscode.TreeItem {
    constructor(public readonly filePath: string, root: string) {
        super(path.relative(root, filePath), vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('database');
        this.resourceUri = vscode.Uri.file(filePath);
        this.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(filePath)] };
    }
}

export class SqlFileProvider implements vscode.TreeDataProvider<SqlFileNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** Set by the extension so the tree can explain why it is empty. */
    public onStatusChange?: (message: string | undefined) => void;

    constructor(public currentRoot: string = '') { }

    setRoot(root: string) { this.currentRoot = root; this.refresh(); }
    refresh(): void { this._onDidChangeTreeData.fire(); }
    getTreeItem(element: SqlFileNode): vscode.TreeItem { return element; }

    async getChildren(): Promise<SqlFileNode[]> {
        if (!this.currentRoot) { return []; }
        const files = await this.findSqlFiles();
        this.onStatusChange?.(files.length === 0 ? 'No .sql files found in this folder.' : undefined);
        return files.map(f => new SqlFileNode(f, this.currentRoot));
    }

    async findSqlFiles(): Promise<string[]> {
        const found: string[] = [];
        const walk = async (dir: string, depth: number) => {
            let entries: fs.Dirent[];
            try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (depth < MAX_DEPTH && !IGNORED_DIRS.has(entry.name)) { await walk(full, depth + 1); }
                } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sql')) {
                    found.push(full);
                }
            }
        };
        await walk(this.currentRoot, 0);
        return found.sort();
    }

    async getModel(): Promise<ErModel> {
        const files = await this.findSqlFiles();
        const sources = await Promise.all(files.map(async f => ({
            path: path.relative(this.currentRoot, f),
            sql: await fs.promises.readFile(f, 'utf-8')
        })));
        return parseSql(sources);
    }
}
