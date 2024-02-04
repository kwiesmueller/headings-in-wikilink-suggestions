import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { around } from "monkey-around";


interface HeadingsPluginSettings {
	fileModePrefix: string;
}

const DEFAULT_SETTINGS: HeadingsPluginSettings = {
	fileModePrefix: '//'
}

export default class HeadingsPlugin extends Plugin {
	settings: HeadingsPluginSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.patchFileSuggest(this.settings.fileModePrefix);
		});
	}

	onunload() { }

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private patchFileSuggest(fileModePrefix: string) {
		const suggester = this.findMainSuggester();
		if (!suggester) {
			console.error('Could not find main suggester to patch:', suggester);
			return;
		}

		console.debug('Patching main suggester:', suggester);

		this.register(around(suggester.constructor.prototype, {
			getSuggestions(old: () => any[]) {
				return async function (...args: any[]) {
					const context = args[0];

					// If the query starts with //, we're in file mode and should not patch the suggestions.
					if (context.query.startsWith(fileModePrefix)) {
						context.query = context.query.substring(2);
						return await old.call(this, ...args);
					}

					// Load file suggestions.
					const files = await old.call(this, ...args);
					console.debug('Got file suggestions:', files);

					// Copy the suggestManager and set mode to "heading" to get heading suggestions.
					// This doesn't seem explicitly necessary, but is done to follow the original code.
					// Hopefully this prevents future breakages.
					let headingSuggestManager = { ...this.suggestManager };
					headingSuggestManager.mode = "heading";
					headingSuggestManager.global = true;

					// Get global heading suggestions.
					const headings = await suggester.suggestManager.getGlobalHeadingSuggestions(headingSuggestManager.runnable, args[0].query);
					console.debug('Got heading suggestions:', headings);

					// Set suggestManager to global to render headings in global mode (with their file paths).
					this.suggestManager.global = true;

					// Filter headings and remove entries where type === "none"
					// to avoid showing "None found" in the suggestions if there are finds in one of the
					// lists.
					const filteredHeadings = headings.filter(filterNoneFound);
					const filteredFiles = files.filter(filterNoneFound);

					let joinedSuggestions = [
						...filteredHeadings,
						...filteredFiles
					];

					const sortedSuggestions = joinedSuggestions.sort((a, b) => {
						// TODO(kwiesmueller): Decide on a sorting strategy.
						// Options considered right now:
						//   * Sort files first, then headings, then by score
						//   * Sort by score only
						//   * Sort headings under their files, sort files by score and headings inside files by score
						if (a.file?.basename === b.file?.basename) {
							if (a.type === "file" && b.type === "heading") {
								return -1;
							}
							if (b.type === "file" && a.type === "heading") {
								return 1;
							}
							// Seems unncessary as the score looks to be enough for now.
							// if (a.type === "heading" && b.type === "heading") {
							// 	// if (a.level < b.level) {
							// 	// 	return -1;
							// 	// }
							// 	// if (a.level > b.level) {
							// 	// 	return 1;
							// 	// }
							// 	// return 0;
							// }
							return 0;
						}
						if (a.score < b.score) {
							return 1;
						}
						if (a.score > b.score) {
							return -1;
						}
						return 0;
					});

					// Add back "None found" if there are no finds in all sources.
					if (sortedSuggestions.length === 0) {
						sortedSuggestions.push({
							type: "none",
							score: 0
						});
					}

					console.log('Returning suggestions:', sortedSuggestions);
					return sortedSuggestions;
				}
			},
			renderSuggestion(old: () => any) {
				return function (...args: any[]) {
					let suggestionData = args[0];
					let suggestion = args[1];

					// Build the default suggestion entry.
					old.call(this, ...args);

					// Only patch suggestions if we're in global mode.
					// So we don't annotate files if we're in file mode.
					if (!suggester.suggestManager.global) {
						return suggestion;
					}

					console.debug('Patching suggestion:', suggestion);

					// For files in global mode, we add an aux marker at the end
					// to indicate that this entry is a file.
					// This is for consistency with the heading suggestions which add an
					// aux marker indicating the heading level.
					const aux = suggestion.getElementsByClassName('suggestion-aux');
					if (aux.length === 0) {
						console.error('Could not find aux element in suggestion:', suggestion);
						return suggestion;
					}
					const auxEl = aux[0];
					if (suggestionData.type === "file") {
						auxEl.createSpan({
							cls: "suggestion-flair",
							text: "File"
						});
					}

					return suggestion;
				};
			}
		}));
	}

	private isMainSuggester(suggester: any): boolean {
		if (suggester?.suggestManager == undefined) {
			return false;
		}
		return suggester.suggestManager.mode !== undefined;
	}

	private findMainSuggester() {
		const suggests = (this.app.workspace as any).editorSuggest.suggests;
		const suggester = suggests.find(this.isMainSuggester);
		return suggester;
	}
}

function filterNoneFound(suggestion: any): boolean {
	return suggestion.type !== "none";
}

class SettingTab extends PluginSettingTab {
	plugin: HeadingsPlugin;

	constructor(app: App, plugin: HeadingsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('File Mode Prefix')
			.setDesc('Which prefix to force file only suggestion mode (original [[ behavior).\nTo enter original file mode use e.g.: "[[//"')
			.addText(text => text
				.setPlaceholder('//')
				.setValue(this.plugin.settings.fileModePrefix)
				.onChange(async (value) => {
					this.plugin.settings.fileModePrefix = value;
					await this.plugin.saveSettings();
				}));
	}
}
