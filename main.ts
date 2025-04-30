/**
 * Obsidian Plugin: Devices Sync
 * Description: Sync your Obsidian vault with Supabase storage
 */

import { createClient } from '@supabase/supabase-js';
import { addIcon, App, Editor, MarkdownView, Modal, normalizePath, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

const SYNC_ICON = `
<svg viewBox="0 0 24 24"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6a6 6 0 0 1-6 6c-1.87 0-3.52-.85-4.62-2.18l-1.45 1.36A7.982 7.982 0 0 0 12 20c4.42 0 8-3.58 8-8s-3.58-8-8-8z"/></svg>
`;

addIcon('sync-icon', SYNC_ICON);

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

		this.addRibbonIcon('trash-2', 'Clean Old Versions', async () => {
			await this.cleanOldVersionsForAllFiles();
			new Notice('Old versions cleaned!');
		});


		// Escuta modificações
		this.registerEvent(
			this.app.vault.on('modify', (file: TFile) => {
				// if (file.extension === 'md') {
				this.modifiedFiles.add(file.path);
				// }
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

		const allFilePaths = this.app.vault.getFiles().map(f => f.path);

		await this.upload(allFilePaths);
		await this.download();
	}

	async upload(paths: string[]) {
		const supabase = this.getSupabaseClient();

		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);

			if (!(file instanceof TFile)) continue;

			const alias = this.getAlias(path);
			const timestamp = Date.now();

			const ext = file.extension;
			const filename = `${alias}__${timestamp}.${ext}`;

			const arrayBuffer = await this.app.vault.readBinary(file);
			const fileBlob = new Blob([arrayBuffer], { type: this.getMimeType(file.extension) });

			await supabase.storage.from(this.bucketName).upload(filename, fileBlob, { upsert: true });

		}
	}

	async cleanOldVersionsForAllFiles() {
		const supabase = this.getSupabaseClient();

		// Lista todos os arquivos no bucket
		const { data: fileList } = await supabase.storage.from(this.bucketName).list('', {
			limit: 1000, // Limite de arquivos
		});

		if (!fileList) return;

		const filesGroupedByAlias: Record<string, { name: string; timestamp: number }[]> = {};

		// Organiza os arquivos por alias
		fileList.forEach(file => {
			const alias = this.getAliasFromFileName(file.name);
			const timestamp = parseInt(file.name.split('__')[1]?.split('.')[0] || '0'); // Extraímos o timestamp

			if (!filesGroupedByAlias[alias]) {
				filesGroupedByAlias[alias] = [];
			}

			filesGroupedByAlias[alias].push({
				name: file.name,
				timestamp: timestamp,
			});
		});

		// Para cada alias, mantém apenas as 3 versões mais recentes
		for (const alias in filesGroupedByAlias) {
			const files = filesGroupedByAlias[alias];

			// Ordena os arquivos por timestamp decrescente
			const sortedFiles = files.sort((a, b) => b.timestamp - a.timestamp);

			// Arquivos a serem excluídos (mais antigos que os 3 mais recentes)
			const filesToDelete = sortedFiles.slice(3);

			// Exclui os arquivos mais antigos
			for (const file of filesToDelete) {
				await supabase.storage.from(this.bucketName).remove([file.name]);
			}
		}
	}

	// Função para obter o alias a partir do nome do arquivo
	getAliasFromFileName(fileName: string): string {
		const aliasMatch = fileName.split('__')[0];
		return aliasMatch ? decodeURIComponent(aliasMatch) : '';
	}

	async download() {
		const supabase = this.getSupabaseClient();
		const { data: fileList } = await supabase.storage.from(this.bucketName).list('', { limit: 1000 });
		if (!fileList) return;

		console.log('fileList', fileList);

		const latestFiles: Record<string, { name: string; timestamp: number }> = {};

		for (const file of fileList) {
			const match = file.name.match(/^(.*)__([0-9]+)\.md$/);
			if (!match) continue;

			const [_, alias, tsStr] = match;
			const timestamp = parseInt(tsStr);

			if (!latestFiles[alias] || timestamp > latestFiles[alias].timestamp) {
				latestFiles[alias] = { name: file.name, timestamp };
			}
		}

		for (const alias in latestFiles) {
			const { name } = latestFiles[alias];
			const { data: fileData } = await supabase.storage.from(this.bucketName).download(name);
			if (!fileData) continue;

			console.log('downloaded fileData', fileData);

			const path = decodeURIComponent(alias);
			const localFile = this.app.vault.getAbstractFileByPath(path);
			const localTimestamp = localFile instanceof TFile ? localFile.stat.mtime : 0;

			if (latestFiles[alias].timestamp > localTimestamp && localFile instanceof TFile) {
				const content = await fileData.text();
				await this.app.vault.modify(localFile, content);
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
		// Requires supabase-js to be installed in plugin
		// Assume globalThis.supabase is configured externally if needed
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