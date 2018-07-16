/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Proto from '../protocol';
import { ITypeScriptServiceClient } from '../typescriptService';
import API from '../utils/api';
import { ConditionalRegistration, ConfigurationDependentRegistration, VersionDependentRegistration } from '../utils/dependentRegistration';
import { disposeAll } from '../utils/dispose';
import * as typeConverters from '../utils/typeConverters';

class TagClosing {

	private _disposed = false;
	private _timeout: NodeJS.Timer | undefined = undefined;
	private _cancel: vscode.CancellationTokenSource | undefined = undefined;
	private readonly _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly client: ITypeScriptServiceClient
	) {
		vscode.workspace.onDidChangeTextDocument(
			event => this.onDidChangeTextDocument(event.document, event.contentChanges),
			null,
			this._disposables);
	}

	public dispose() {
		this._disposed = true;

		disposeAll(this._disposables);

		if (this._timeout) {
			clearTimeout(this._timeout);
			this._timeout = undefined;
		}

		if (this._cancel) {
			this._cancel.cancel();
			this._cancel.dispose();
			this._cancel = undefined;
		}
	}

	private onDidChangeTextDocument(
		document: vscode.TextDocument,
		changes: vscode.TextDocumentContentChangeEvent[]
	) {
		const activeDocument = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
		if (document !== activeDocument || changes.length === 0) {
			return;
		}

		const filepath = this.client.toPath(document.uri);
		if (!filepath) {
			return;
		}

		if (typeof this._timeout !== 'undefined') {
			clearTimeout(this._timeout);
		}

		if (this._cancel) {
			this._cancel.cancel();
			this._cancel.dispose();
			this._cancel = undefined;
		}

		const lastChange = changes[changes.length - 1];
		const lastCharacter = lastChange.text[lastChange.text.length - 1];
		if (lastChange.rangeLength > 0 || lastCharacter !== '>' && lastCharacter !== '/') {
			return;
		}

		const secondToLastCharacter = lastChange.text[lastChange.text.length - 2];
		if (secondToLastCharacter === '>') {
			return;
		}

		const rangeStart = lastChange.range.start;
		const version = document.version;
		this._timeout = setTimeout(async () => {
			this._timeout = undefined;

			if (this._disposed) {
				return;
			}

			let position = new vscode.Position(rangeStart.line, rangeStart.character + lastChange.text.length);
			let body: Proto.TextInsertion | undefined = undefined;
			const args: Proto.JsxClosingTagRequestArgs = typeConverters.Position.toFileLocationRequestArgs(filepath, position);

			this._cancel = new vscode.CancellationTokenSource();
			try {
				const response = await this.client.execute('jsxClosingTag', args, this._cancel.token);
				body = response && response.body;
				if (!body) {
					return;
				}
			} catch {
				return;
			}

			if (this._disposed) {
				return;
			}

			const activeEditor = vscode.window.activeTextEditor;
			if (!activeEditor) {
				return;
			}

			const activeDocument = activeEditor.document;
			if (document === activeDocument && activeDocument.version === version) {
				activeEditor.insertSnippet(
					this.getTagSnippet(body),
					this.getInsertionPositions(activeEditor, position));
			}
		}, 100);
	}

	private getTagSnippet(closingTag: Proto.TextInsertion): vscode.SnippetString {
		const snippet = new vscode.SnippetString();
		snippet.appendPlaceholder('', 0);
		snippet.appendText(closingTag.newText);
		return snippet;
	}

	private getInsertionPositions(editor: vscode.TextEditor, position: vscode.Position) {
		const activeSelectionPositions = editor.selections.map(s => s.active);
		return activeSelectionPositions.some(p => p.isEqual(position))
			? activeSelectionPositions
			: position;
	}
}

export class ActiveDocumentDependentRegistration {
	private readonly _registration: ConditionalRegistration;
	private readonly _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly selector: vscode.DocumentSelector,
		register: () => vscode.Disposable,
	) {
		this._registration = new ConditionalRegistration(register);
		vscode.window.onDidChangeActiveTextEditor(this.update, this, this._disposables);
		this.update();
	}

	public dispose() {
		disposeAll(this._disposables);
		this._registration.dispose();
	}

	private update() {
		const editor = vscode.window.activeTextEditor;
		const enabled = !!(editor && vscode.languages.match(this.selector, editor.document));
		this._registration.update(enabled);
	}
}

export function register(
	selector: vscode.DocumentSelector,
	modeId: string,
	client: ITypeScriptServiceClient,
) {
	return new VersionDependentRegistration(client, API.v300, () =>
		new ConfigurationDependentRegistration(modeId, 'autoClosingTags', () =>
			new ActiveDocumentDependentRegistration(selector, () =>
				new TagClosing(client))));
}
