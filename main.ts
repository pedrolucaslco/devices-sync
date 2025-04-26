import { createClient } from '@supabase/supabase-js';
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface SupabaseSyncSettings {
	supabaseUrl: string;
	supabaseKey: string;
}

const DEFAULT_SETTINGS: SupabaseSyncSettings = {
	supabaseUrl: '',
	supabaseKey: '',
}
1
export default class SupabaseSyncPlugin extends Plugin {
	settings: SupabaseSyncSettings;
	supabase: any;
	bucketName: string;

	async onload() {
		await this.loadSettings();

		if (this.settings.supabaseUrl || this.settings.supabaseKey) {
			this.supabase = createClient(this.settings.supabaseUrl, this.settings.supabaseKey);
			this.bucketName = "notes";
		} 

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('cloud', 'Sample Plugin', async () => {
			new Notice('Starting sync...');
			await this.syncNotes();
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SyncSettingTab(this.app, this));

	}

	onunload() {

	}

	async syncNotes() {

		if (!this.supabase) {
			this.supabase = createClient(this.settings.supabaseUrl, this.settings.supabaseKey);
			this.bucketName = "notes";

			if (!this.supabase) {
				new Notice("Supabase not configured");
				return;
			}

			return;
		}

		const files = this.app.vault.getFiles();
		new Notice("Syncing notes...");

		for (const file of files) {
			new Notice(`Syncing ${file.path}`);
			const localContent = await this.app.vault.read(file);
			const { data, error } = await this.supabase
				.storage
				.from(this.bucketName)
				.download(file.path);

			if (error && error.message !== "The resource was not found") {
				new Notice(`Error downloading: ${file.path} - ${JSON.stringify(error)}`);
				console.error(error);
				continue;
			}

			const remoteContent = data ? await data.text() : "";

			let shouldUpload = false;
			
			if (!data) {
				shouldUpload = true;
			} else {
				shouldUpload = localContent.length > remoteContent.length;
			}

			if (shouldUpload) {
				await this.supabase.storage.from(this.bucketName).upload(file.path, localContent, { upsert: true });
			} else {
				await this.app.vault.modify(file, remoteContent);
			}
		}

		new Notice("Sync complete!");
	}


	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SyncSettingTab extends PluginSettingTab {
	plugin: SupabaseSyncPlugin;

	constructor(app: App, plugin: SupabaseSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Supabase URL')
			.setDesc('The URL of your Supabase instance')
			.addText(text => text
				.setPlaceholder('Enter your Supabase URL')
				.setValue(this.plugin.settings.supabaseUrl)
				.onChange(async (value) => {
					this.plugin.settings.supabaseUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Supabase Key')
			.setDesc('The API key of your Supabase instance')
			.addText(text => text
				.setPlaceholder('Enter your Supabase Key')
				.setValue(this.plugin.settings.supabaseKey)
				.onChange(async (value) => {
					this.plugin.settings.supabaseKey = value;
					await this.plugin.saveSettings();
				}));
	}
}
