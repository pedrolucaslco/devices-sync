/**
 * Obsidian Plugin: Devices Sync
 * Description: Sync your Obsidian vault with Supabase storage
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { App, normalizePath, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

export default class DevicesSyncPlugin extends Plugin {
	settings: { supabaseUrl: string; supabaseKey: string };
	bucketName: string = 'notes';

	private supabaseClient: SupabaseClient | null = null;

	async onload() {

		// Load settings
		await this.loadSettings();
		this.addSettingTab(new DevicesSyncSettingTab(this.app, this));

		// Add button to sidebar
		this.addRibbonIcon('circle-fading-arrow-up', 'Sync Now', async () => {
			await this.syncFiles();
		});

		this.registerEvent(
			this.app.vault.on('modify', (file: TFile) => {
				if (this.app.vault.getAbstractFileByPath(file.path)) {
					this.uploadFile(file.path);
				}
			})
		);
	}

	onunload() {

	}

	async getLocalFiles() {
		return this.app.vault.getFiles().map(file => ({
			name: file.name,
			path: file.path,
			timestamp: file.stat.mtime,
		}));
	}

	async getRemoteFiles() {
		const supabase = this.getSupabaseClient();

		const { data: cloudFilesList } = await supabase.storage
			.from(this.bucketName)
			.list('', { limit: 1000 });

		const cloudFiles: { name: string; path: string; timestamp: number }[] = [];

		for (const file of cloudFilesList || []) {
			if (!file.name.endsWith('.meta.json')) continue;

			const path = file.name;
			const metaPath = path;

			const { data: metaDataResponse, error } = await supabase.storage
				.from(this.bucketName)
				.download(metaPath);

			if (error || !metaDataResponse) {
				console.warn(`Meta não encontrada para: ${metaPath}`);
				continue;
			}

			const text = await metaDataResponse.text();
			const metaData = JSON.parse(text);

			cloudFiles.push({
				name: file.name.replace('.meta.json', ''),
				path: path.replace('.meta.json', ''),
				timestamp: metaData.timeStamp,
			});
		}

		return cloudFiles;
	}

	async uploadFile(path: string) {
		console.log('uploadFile', path);

		const supabase = this.getSupabaseClient();

		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;

		const content = await this.app.vault.readBinary(file);
		const alias = this.getAlias(file.path);
		const ext = file.extension;
		const filename = `${alias}`;
		const mime = this.getMimeType(ext);

		const fileBlob = new Blob([content], { type: mime });

		await supabase.storage.from(this.bucketName).upload(filename, fileBlob, { upsert: true });

		const metadata = {
			originalName: file.name,
			originalPath: file.path,
			timeStamp: file.stat.mtime,
		};

		await supabase.storage.from(this.bucketName).upload(`${filename}.meta.json`,
			new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
			{ upsert: true }
		);
	}

	async updateRemote(path: string) {
		console.log('updateRemote', path);

		const supabase = this.getSupabaseClient();

		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;

		const content = await this.app.vault.readBinary(file);
		const alias = this.getAlias(file.path);
		const ext = file.extension;
		const filename = `${alias}`;
		const mime = this.getMimeType(ext);

		const fileBlob = new Blob([content], { type: mime });

		await supabase.storage.from(this.bucketName).upload(filename, fileBlob, { upsert: true });

		const metadata = {
			originalName: file.name,
			originalPath: file.path,
			timeStamp: file.stat.mtime,
		};

		await supabase.storage.from(this.bucketName).upload(`${filename}.meta.json`,
			new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
			{ upsert: true }
		);
	}

	async uploadFileAsNew(path: string) {
		console.log('uploadFileAsNew', path);

		// change file name to originalName + '(copy)'
		// call uploadFile with new name

		const alias = path.split('.')[0];
		const ext = path.split('.').pop();
		const newFileName = `${alias} 1.${ext}`;

		this.uploadFile(newFileName);
	}

	async downloadFile(path: string) {
		console.log('downloadFile', path);

		const supabase = this.getSupabaseClient();

		const { data: fileData } = await supabase.storage
			.from(this.bucketName)
			.download(path);

		if (!fileData) {
			console.warn(`Arquivo não encontrado na nuvem: ${path}`);
			return;
		}

		const { data: metaDataResponse, error } = await supabase.storage
			.from(this.bucketName)
			.download(`${path}.meta.json`);

		if (error) {
			console.error('Erro ao baixar arquivo .meta.json:', error);
			return;
		}

		if (!metaDataResponse) {
			console.warn(`Meta não encontrada para: ${path}.meta.json`);
			return;
		}

		const text = await metaDataResponse.text();
		const metaData = JSON.parse(text);

		// -----------------------------------------------------------------

		const originalPath = metaData.originalPath;

		const localFile = this.app.vault.getAbstractFileByPath(originalPath);

		if (!localFile) {
			console.log('localFile not found, creating new file');

			const arrayBuffer = await fileData.arrayBuffer();
			await this.app.vault.createBinary(path, arrayBuffer);
		}
	}

	async syncFiles() {

		new Notice('Syncing...');

		const localFiles = await this.getLocalFiles();

		console.log('localFiles', localFiles);

		const remoteFiles = await this.getRemoteFiles();

		for (const file of localFiles) {
			const remote = remoteFiles.find(f => f.path === file.path);

			if (!remote) {
				this.uploadFile(file.path); // novo em local, envia para a nuvem
			} else if (file.timestamp > remote.timestamp) {
				this.updateRemote(file.path); // edição local mais recente
			} else if (file.timestamp < remote.timestamp) {
				this.uploadFileAsNew(file.path); // edição local mais antiga
			}
		}

		// 3. Baixar novos arquivos da nuvem
		for (const file of remoteFiles) {
			if (!localFiles.find(f => f.path === file.path)) {
				this.downloadFile(file.path); // novo remoto, baixa
			}
		}
	}

	// async createMissingFolders(filePath: string) {
	// 	const folders = filePath.split('/');
	// 	folders.pop(); // Remove o nome do arquivo

	// 	let currentPath = '';
	// 	for (const folder of folders) {
	// 		currentPath += (currentPath ? '/' : '') + folder;
	// 		if (!this.app.vault.getAbstractFileByPath(currentPath)) {
	// 			await this.app.vault.createFolder(currentPath);
	// 		}
	// 	}
	// }

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
		if (!this.supabaseClient) {
			this.supabaseClient = createClient(this.settings.supabaseUrl, this.settings.supabaseKey);
		}
		return this.supabaseClient;
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