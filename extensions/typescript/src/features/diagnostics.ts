/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Diagnostic, DiagnosticCollection, languages } from 'vscode';
import { ITypeScriptServiceClient } from '../typescriptService';

export default class DiagnosticsManager {

	private syntaxDiagnostics: ObjectMap<Diagnostic[]>;
	private semanticDiagnostics: ObjectMap<Diagnostic[]>;
	private readonly currentDiagnostics: DiagnosticCollection;
	private _validate: boolean = true;

	constructor(
		language: string,
		private readonly client: ITypeScriptServiceClient
	) {
		this.syntaxDiagnostics = Object.create(null);
		this.semanticDiagnostics = Object.create(null);
		this.currentDiagnostics = languages.createDiagnosticCollection(language);
	}

	public dispose() {
		this.currentDiagnostics.dispose();
	}

	public reInitialize(): void {
		this.currentDiagnostics.clear();
		this.syntaxDiagnostics = Object.create(null);
		this.semanticDiagnostics = Object.create(null);
	}

	public updateValidate(value: boolean) {
		if (this._validate === value) {
			return;
		}
		this._validate = value;
		if (!value) {
			this.syntaxDiagnostics = Object.create(null);
			this.semanticDiagnostics = Object.create(null);
			this.currentDiagnostics.clear();
		}
	}

	public syntaxDiagnosticsReceived(file: string, syntaxDiagnostics: Diagnostic[]): void {
		if (!this._validate) {
			return;
		}
		this.syntaxDiagnostics[file] = syntaxDiagnostics;
		const semanticDianostics = this.semanticDiagnostics[file] || [];
		this.currentDiagnostics.set(this.client.asUrl(file), semanticDianostics.concat(syntaxDiagnostics));
	}

	public semanticDiagnosticsReceived(file: string, semanticDiagnostics: Diagnostic[]): void {
		if (!this._validate) {
			return;
		}
		this.semanticDiagnostics[file] = semanticDiagnostics;
		const syntaxDiagnostics = this.syntaxDiagnostics[file] || [];
		this.currentDiagnostics.set(this.client.asUrl(file), semanticDiagnostics.concat(syntaxDiagnostics));
	}

	public configFileDiagnosticsReceived(file: string, diagnostics: Diagnostic[]): void {
		this.currentDiagnostics.set(this.client.asUrl(file), diagnostics);
	}

	public delete(file: string) {
		this.currentDiagnostics.delete(this.client.asUrl(file));
	}
}