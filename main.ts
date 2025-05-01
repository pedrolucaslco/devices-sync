/**
 * Obsidian Plugin: Devices Sync
 * Description: Sync your Obsidian vault with Supabase storage
 */

import { createClient } from '@supabase/supabase-js';
import { App, normalizePath, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

export default class DevicesSyncPlugin extends Plugin {
	settings: { supabaseUrl: string; supabaseKey: string };
	modifiedFiles: Set<string> = new Set();
	intervalId: NodeJS.Timeout | null = null;
	bucketName: string = 'notes';

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new DevicesSyncSettingTab(this.app, this));

		// Botão manual na sidebar
		this.addRibbonIcon('circle-fading-arrow-up', 'Sync Now', async () => {
			await this.syncNow();
		});

		this.registerEvent(
			this.app.vault.on('modify', (file: TFile) => {
				this.modifiedFiles.add(file.path);
			})
		);

		this.intervalId = setInterval(() => this.autoSync(), 5000);
	}

	onunload() {
		if (this.intervalId) clearInterval(this.intervalId);
	}

	async autoSync() {
		if (this.modifiedFiles.size > 0) {
			new Notice("Running autoSync...");
			const files = Array.from(this.modifiedFiles);
			this.modifiedFiles.clear();
			await this.upload(files);
		}
	}

	async syncNow() {
		new Notice('Syncing...');
		const allFiles = this.app.vault.getFiles().map(f => f.path);
		await this.upload(allFiles);
		await this.download();
	}

	async upload(paths: string[]) {
		const supabase = this.getSupabaseClient();

		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;

			const content = await this.app.vault.readBinary(file);
			const alias = this.getAlias(path);
			const timestamp = Date.now();
			console.log('alias', alias);
			const ext = file.extension;
			const filename = `${alias}__${timestamp}.${ext}`;
			const mime = this.getMimeType(ext);

			const listResp = await supabase.storage.from(this.bucketName).list('', { limit: 1000 });
			if (listResp.data) {
				const regex = new RegExp(`^${alias}__\\d+\\.${ext}$`);
				for (const entry of listResp.data) {
					if (regex.test(entry.name)) {
						await supabase.storage.from(this.bucketName).remove([entry.name]);
					}
				}
			}

			const fileBlob = new Blob([content], { type: mime });
			await supabase.storage.from(this.bucketName).upload(filename, fileBlob, { upsert: true });

			// Armazenando o nome original como metadado
			// const metadata = {
			// 	originalName: file.name
			// };

			// Salva metadados no bucket (opcionalmente em um arquivo JSON ou outro método)
			// await supabase.storage.from(this.bucketName).upload(`${filename}.json`, new Blob([JSON.stringify(metadata)], { type: 'application/json' }), { upsert: true });
		}
	}

	async download() {
		const supabase = this.getSupabaseClient();
		const { data: fileList } = await supabase.storage.from(this.bucketName).list('', { limit: 1000 });
		if (!fileList) return;

		console.log('fileList', fileList);

		const latestFiles: Record<string, { name: string; timestamp: number; ext: string }> = {};

		for (const file of fileList) {
			const match = file.name.match(/^(.*)__([0-9]+)\.(.+)$/);
			if (!match) continue;

			const [_, alias, tsStr, ext] = match;
			const timestamp = parseInt(tsStr);

			if (!latestFiles[alias] || timestamp > latestFiles[alias].timestamp) {
				latestFiles[alias] = { name: file.name, timestamp, ext };
			}
		}

		for (const alias in latestFiles) {
			const { name, ext } = latestFiles[alias];
			const { data: fileData } = await supabase.storage.from(this.bucketName).download(name);
			if (!fileData) continue;

			const path = decodeURIComponent(alias);
			const localFile = this.app.vault.getAbstractFileByPath(path);

			if (!localFile) {
				const arrayBuffer = await fileData.arrayBuffer();
				await this.app.vault.createBinary(path, arrayBuffer);
			} else if (localFile instanceof TFile) {
				const localTimestamp = localFile.stat.mtime;
				if (latestFiles[alias].timestamp > localTimestamp) {
					const arrayBuffer = await fileData.arrayBuffer();
					await this.app.vault.modifyBinary(localFile, arrayBuffer);
				}
			}
		}
	}

	// encodeSpecialChars(path: string): string {
	// 	// Verifica se o nome contém caracteres especiais (não alfanuméricos)
	// 	const specialCharsRegex = /[^a-zA-Z0-9\-_.]/;
	// 	if (specialCharsRegex.test(path)) {
	// 		// Se encontrar caracteres especiais, codifica em base64
	// 		return path
	// 			.split('')
	// 			.map((char) => (specialCharsRegex.test(char) ? TextEncoder .encode(char).toString('base64') : char))
	// 			.join('');
	// 	}
	// 	// Se não encontrar caracteres especiais, retorna o caminho original
	// 	return path;
	// }


	// Função para obter o alias a partir do nome do arquivo
	getAliasFromFileName(fileName: string): string {
		const aliasMatch = fileName.split('__')[0];
		return aliasMatch ? decodeURIComponent(aliasMatch) : '';
	}

	async createMissingFolders(filePath: string) {
		const folders = filePath.split('/');
		folders.pop(); // Remove o nome do arquivo

		let currentPath = '';
		for (const folder of folders) {
			currentPath += (currentPath ? '/' : '') + folder;
			if (!this.app.vault.getAbstractFileByPath(currentPath)) {
				await this.app.vault.createFolder(currentPath);
			}
		}
	}

	getAlias(path: string): string {
		return encodeURIComponent(normalizePath(path));
	}

	getMimeType(ext: string): string {
		const types: Record<string, string> = {
			// Text/Code
			md: 'text/markdown',
			txt: 'text/plain',
			json: 'application/json',
			html: 'text/html',
			css: 'text/css',
			js: 'application/javascript',
			ts: 'application/typescript',
			jsx: 'text/jsx',
			tsx: 'text/tsx',
			xml: 'application/xml',
			csv: 'text/csv',
			yaml: 'text/yaml',
			yml: 'text/yaml',
			ini: 'text/plain',

			// Docs
			pdf: 'application/pdf',
			doc: 'application/msword',
			docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			xls: 'application/vnd.ms-excel',
			xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			ppt: 'application/vnd.ms-powerpoint',
			pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

			// Images
			png: 'image/png',
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			gif: 'image/gif',
			bmp: 'image/bmp',
			svg: 'image/svg+xml',
			webp: 'image/webp',
			ico: 'image/vnd.microsoft.icon',

			// Audio
			mp3: 'audio/mpeg',
			wav: 'audio/wav',
			ogg: 'audio/ogg',
			flac: 'audio/flac',
			m4a: 'audio/mp4',

			// Video
			mp4: 'video/mp4',
			webm: 'video/webm',
			mkv: 'video/x-matroska',
			mov: 'video/quicktime',
			avi: 'video/x-msvideo',

			// Archives
			zip: 'application/zip',
			rar: 'application/vnd.rar',
			tar: 'application/x-tar',
			gz: 'application/gzip',

			// Fonts
			ttf: 'font/ttf',
			otf: 'font/otf',
			woff: 'font/woff',
			woff2: 'font/woff2',
		};

		return types[ext.toLowerCase()] || 'application/octet-stream';
	}

	getSupabaseClient() {
		return createClient(this.settings.supabaseUrl, this.settings.supabaseKey);
	}

	async loadSettings() {
		this.settings = Object.assign({
			supabaseUrl: '',
			supabaseKey: '',
		}, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class DevicesSyncSettingTab extends PluginSettingTab {
	plugin: DevicesSyncPlugin;

	constructor(app: App, plugin: DevicesSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.createEl('h2', { text: 'Devices Sync Settings' });

		new Setting(containerEl)
			.setName('Supabase URL')
			.addText(text => text
				.setPlaceholder('https://your-project.supabase.co')
				.setValue(this.plugin.settings.supabaseUrl)
				.onChange(async (value) => {
					this.plugin.settings.supabaseUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Supabase Key')
			.addText(text => text
				.setPlaceholder('Your Supabase Anon/Public Key')
				.setValue(this.plugin.settings.supabaseKey)
				.onChange(async (value) => {
					this.plugin.settings.supabaseKey = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('a', {
			text: 'Veja como configurar no Supabase',
			href: 'https://supabase.com/docs/guides/api',
			attr: { target: '_blank' }
		});
	}
}