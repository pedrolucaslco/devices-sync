import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { App, normalizePath, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

export default class DevicesSyncPlugin extends Plugin {
	settings: { supabaseUrl: string; supabaseKey: string };
	bucketName: string = 'notes';

	private supabaseClient: SupabaseClient | null = null;

	async onload() {

		await this.loadSettings();
		this.addSettingTab(new DevicesSyncSettingTab(this.app, this));

		this.addRibbonIcon('circle-fading-arrow-up', 'Sync Now', async () => {
			await this.syncFiles();
		});

		// LISTENERS

		this.registerEvent(
			this.app.vault.on('create', (file: TFile) => {
				if (this.app.vault.getAbstractFileByPath(file.path)) {
					new Notice('Syncing created file...');
					console.log('creating file: ' + file.path);
					this.uploadFile(file.path);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('modify', (file: TFile) => {
				if (this.app.vault.getAbstractFileByPath(file.path)) {
					new Notice('Syncing modified file...');
					console.log('modifying file: ' + file.path);
					this.uploadFile(file.path);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('delete', (file: TFile) => {
				new Notice('Syncing deleted file...');
				console.log('deleting file: ' + file.path);
				this.deleteFile(file.path);
			})
		);

		this.registerEvent(
			this.app.vault.on('rename', (file: TFile, oldPath: string) => {
				new Notice('Syncing renamed file...');
				console.log('renaming file: ' + oldPath);
				this.renameFile(oldPath, file.path);
			})
		);

	}

	onunload() {

	}


	async renameFile(oldPath: string, newPath: string) {
		console.log('renameFile', oldPath, newPath);

		const supabase = this.getSupabaseClient();

		const { data: fileData } = await supabase.storage
			.from(this.bucketName)
			.move(oldPath, newPath);

		const { data: fileMetaData } = await supabase.storage
			.from(this.bucketName)
			.move(oldPath + '.meta.json', newPath + '.meta.json');
	}

	async deleteFile(path: string) {
		console.log('deleteFile', path);

		const supabase = this.getSupabaseClient();

		const { data: fileData } = await supabase.storage
			.from(this.bucketName)
			.remove([path, path + '.meta.json']);
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
		console.log('before alias change: ' + file.path);
		const alias = this.getAlias(file.path);
		console.log('after alias change: ' + alias);
		const ext = file.extension;
		const filename = `${alias}`;
		const mime = this.getMimeType(ext);

		const fileBlob = new Blob([content], { type: mime });

		await supabase.storage
			.from(this.bucketName)
			.upload(filename, fileBlob, { upsert: true });

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

	async downloadFile(path: string, newPath: string | null) {
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

		var localPath = metaData.originalPath;

		if (newPath !== null) {
			localPath = newPath;
		}

		const localFile = this.app.vault.getAbstractFileByPath(localPath);

		if (!localFile) {
			console.log('localFile not found, creating new file');

			const arrayBuffer = await fileData.arrayBuffer();
			await this.app.vault.createBinary(localPath, arrayBuffer);
		} else if (localFile instanceof TFile) {
			console.log('localFile found, overwriting file');

			const arrayBuffer = await fileData.arrayBuffer();
			await this.app.vault.modifyBinary(localFile, arrayBuffer);

		} else {
			console.log('localFile not TFile, skipping');
		}
	}

	async makeACopy(path: string) {
		console.log('makeACopy', path);

		const alias = path.split('.')[0];
		const ext = path.split('.').pop();
		const newFileName = `${alias} 1.${ext}`;

		this.downloadFile(path, newFileName);
		this.uploadFile(newFileName);
	}

	async syncFiles() {

		new Notice('Syncing...');

		const localFiles = await this.getLocalFiles();

		console.log('localFiles', localFiles);

		const remoteFiles = await this.getRemoteFiles();

		for (const file of localFiles) {

			const existsInRemote = remoteFiles.find(f => f.path === file.path);
			const existsInLocal = localFiles.find(f => f.path === file.path);

			if (existsInRemote && !existsInLocal) {
				this.downloadFile(file.path, null); // novo remoto, baixa
			} else if (existsInLocal && !existsInRemote) {
				// this.uploadFile(file.path); // novo em local, envia para a nuvem

				// pode ser um caso de arquivo que foi excluido na nuvem e ainda está no local
				this.deleteLocalFile(file.path);
			} else if (existsInLocal && existsInRemote) {
				if (file.timestamp !== existsInRemote.timestamp) {
					this.downloadFile(file.path, null); // novo remoto, baixa
				}
			}
		}

		// 3. Baixar novos arquivos da nuvem
		for (const file of remoteFiles) {
			if (!localFiles.find(f => f.path === file.path)) {
				this.downloadFile(file.path, null); // novo remoto, baixa
			}
		}
	}

	async deleteLocalFile(path: string) {
		console.log('deleteLocalFile', path);

		const localFile = this.app.vault.getAbstractFileByPath(path);

		if (localFile instanceof TFile) {
			await this.app.vault.delete(localFile);
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
		const newPath = path
			.normalize("NFD")                        // separa acento da letra
			.replace(/[\u0300-\u036f]/g, "")        // remove acentos
			// .replace(/\s+/g, '-')                   // substitui espaços por hífens
			.replace(/[^a-zA-Z0-9.-]/g, '')         // remove caracteres especiais (exceto ponto e hífen)
			.toLowerCase();

			console.log('newPath: ' + newPath);
		return encodeURIComponent(normalizePath(newPath));
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