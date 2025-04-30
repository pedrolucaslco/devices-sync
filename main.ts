/**
 * Obsidian Plugin: Devices Sync
 * Description: Sync your Obsidian vault with Supabase storage
 */

import { createClient } from '@supabase/supabase-js';
import { addIcon, App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

const SYNC_ICON = `
<svg viewBox="0 0 24 24"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6a6 6 0 0 1-6 6c-1.87 0-3.52-.85-4.62-2.18l-1.45 1.36A7.982 7.982 0 0 0 12 20c4.42 0 8-3.58 8-8s-3.58-8-8-8z"/></svg>
`;

addIcon('sync-icon', SYNC_ICON);

export default class DevicesSyncPlugin extends Plugin {
	settings: { supabaseUrl: string; supabaseKey: string };
	modifiedFiles: Set<string> = new Set();
	intervalId: NodeJS.Timeout | null = null;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new DevicesSyncSettingTab(this.app, this));

		// Botão manual na sidebar
		this.addRibbonIcon('sync-icon', 'Sync Now', async () => {
			await this.syncNow();
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
		const allFiles = this.app.vault.getFiles().map(f => f.path);
		await this.upload(allFiles);
		await this.download();
	}

	async upload(paths: string[]) {
		const supabase = this.getSupabaseClient();
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;

			const content = await this.app.vault.read(file);
			const alias = this.getAlias(path);

			const metadata = {
				updated_at: Date.now(),
				alias,
				original_name: path,
			};

			await supabase.from('notes').upsert({
				id: alias,
				content,
				metadata,
			});
		}
	}

	async download() {
		const supabase = this.getSupabaseClient();
		const { data } = await supabase.from('notes').select('*');
		if (!data) return;

		for (const note of data) {
			const file = this.app.vault.getAbstractFileByPath(note.metadata.original_name);
			const localFile = file instanceof TFile ? file : null;
			const localTimestamp = localFile ? localFile.stat.mtime : 0;

			if (note.metadata.updated_at > localTimestamp) {
				await this.app.vault.modify(localFile!, note.content);
			}
		}
	}

	getAlias(path: string): string {
		return encodeURIComponent(path);
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
			href: 'https://supabase.com/docs/guides/with-js',
			attr: { target: '_blank' }
		});
	}
}