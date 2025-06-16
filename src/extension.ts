// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface FavoriteFolder extends vscode.TreeItem {
	uri: vscode.Uri;
}

class FavoriteFoldersProvider implements vscode.TreeDataProvider<FavoriteFolder | vscode.TreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<FavoriteFolder | vscode.TreeItem | undefined | void> = new vscode.EventEmitter<FavoriteFolder | vscode.TreeItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<FavoriteFolder | vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;

	constructor(private context: vscode.ExtensionContext) { }

	getTreeItem(element: FavoriteFolder | vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: FavoriteFolder | vscode.TreeItem): Promise<(FavoriteFolder | vscode.TreeItem)[]> {
		if (!element) {
			const favorites = this.context.globalState.get<string[]>('favoriteFolders', []);
			return favorites.map(fav => {
				const uri = vscode.Uri.parse(fav);
				const item: FavoriteFolder = new vscode.TreeItem(uri.fsPath.split(/[\\/]/).pop() || uri.fsPath, vscode.TreeItemCollapsibleState.Collapsed) as FavoriteFolder;
				item.uri = uri;
				item.resourceUri = uri;
				item.contextValue = 'favoriteFolder';
				return item;
			});
		} else {
			// Always use .resourceUri for all folders, fallback to .uri for top-level
			const folderUri: vscode.Uri | undefined = (element as any).resourceUri || (element as any).uri;
			const folderPath = folderUri?.fsPath;
			if (!folderPath || !fs.existsSync(folderPath)) return [];
			let files: string[] = [];
			try {
				files = fs.readdirSync(folderPath);
			} catch (err) {
				console.error(`Failed to read directory: ${folderPath}`, err);
				vscode.window.showWarningMessage(`Cannot access folder: ${folderPath}`);
				return [];
			}
			return files.map(file => {
				const filePath = path.join(folderPath, file);
				const stat = fs.statSync(filePath);
				const fileItem = new vscode.TreeItem(file, stat.isDirectory() ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
				fileItem.resourceUri = vscode.Uri.file(filePath);
				if (stat.isDirectory()) {
					(fileItem as any).uri = vscode.Uri.file(filePath); // for compatibility
					// Set a different contextValue for second-level and deeper folders
					fileItem.contextValue = 'favoriteFolderChild';
				}
				else {
					fileItem.command = {
						command: 'vscode.open',
						title: 'Open File',
						arguments: [vscode.Uri.file(filePath)]
					};
				}
				return fileItem;
			});
		}
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}
}

class FavoriteFoldersDragAndDropController implements vscode.TreeDragAndDropController<FavoriteFolder> {
	readonly dropMimeTypes = ['text/uri-list'];
	readonly dragMimeTypes = [];
	constructor(private context: vscode.ExtensionContext, private provider: FavoriteFoldersProvider) { }

	async handleDrop(target: FavoriteFolder | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) {
		const uriList = dataTransfer.get('text/uri-list');
		if (!uriList) return;
		const value = uriList.value as string;
		const uris = value.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => vscode.Uri.parse(s));
		const favorites = this.context.globalState.get<string[]>('favoriteFolders', []);
		let updated = false;
		for (const uri of uris) {
			if (uri.scheme === 'file' && !favorites.includes(uri.toString())) {
				favorites.push(uri.toString());
				updated = true;
			}
		}
		if (updated) {
			await this.context.globalState.update('favoriteFolders', favorites);
			this.provider.refresh();
		}
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const provider = new FavoriteFoldersProvider(context);
	const dnd = new FavoriteFoldersDragAndDropController(context, provider);
	vscode.window.createTreeView('favoriteFolderView', {
		treeDataProvider: provider,
		dragAndDropController: dnd
	});

	context.subscriptions.push(
		vscode.commands.registerCommand('favorite-folders.addFolder', async (uri?: vscode.Uri) => {
			let folderUri: vscode.Uri | undefined = uri;
			if (!folderUri) {
				const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false });
				if (selected && selected[0]) {
					folderUri = selected[0];
				}
			}
			if (folderUri) {
				const favorites = context.globalState.get<string[]>('favoriteFolders', []);
				if (!favorites.includes(folderUri.toString())) {
					favorites.push(folderUri.toString());
					await context.globalState.update('favoriteFolders', favorites);
					provider.refresh();
				}
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('favorite-folders.removeFolder', async (itemOrUri?: FavoriteFolder | vscode.Uri) => {
			let folderUri: vscode.Uri | undefined;
			if (itemOrUri) {
				if (itemOrUri instanceof vscode.Uri) {
					folderUri = itemOrUri;
				} else if ((itemOrUri as FavoriteFolder).uri) {
					folderUri = (itemOrUri as FavoriteFolder).uri;
				}
			}
			if (!folderUri) {
				const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false });
				if (selected && selected[0]) {
					folderUri = selected[0];
				}
			}
			if (folderUri) {
				const favorites = context.globalState.get<string[]>('favoriteFolders', []);
				const updated = favorites.filter(fav => fav !== folderUri.toString());
				await context.globalState.update('favoriteFolders', updated);
				provider.refresh();
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('favorite-folders.openFolder', async (itemOrUri?: FavoriteFolder | vscode.Uri) => {
			let folderUri: vscode.Uri | undefined;
			if (itemOrUri) {
				if (itemOrUri instanceof vscode.Uri) {
					folderUri = itemOrUri;
				} else if ((itemOrUri as FavoriteFolder).uri) {
					folderUri = (itemOrUri as FavoriteFolder).uri;
				} else if ((itemOrUri as any).resourceUri) {
					folderUri = (itemOrUri as any).resourceUri;
				}
			}
			if (folderUri) {
				await vscode.commands.executeCommand('vscode.openFolder', folderUri, { forceNewWindow: true });
			}
		})
	);
}

// This method is called when your extension is deactivated
export function deactivate() { }
