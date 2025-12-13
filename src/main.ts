// src/main.ts

import {
  Plugin,
  Notice,
  WorkspaceLeaf,
  PluginSettingTab,
  Setting,
  App
} from 'obsidian';
import { TabCollectionService } from './services/TabCollectionService';
import { CanvasGenerationService } from './services/CanvasGenerationService';
import { CanvasInteractionService } from './services/CanvasInteractionService';
import { CanvasConfig } from './interfaces';

const DEFAULT_SETTINGS: CanvasConfig = {
  autoLayout: true,
  cardWidth: 250,
  cardHeight: 150,
  gridSpacing: 50
};

class OpenTabsCanvasSettingTab extends PluginSettingTab {
  plugin: OpenTabsCanvasPlugin;

  constructor(app: App, plugin: OpenTabsCanvasPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Open Tabs Canvas Settings' });

    new Setting(containerEl)
      .setName('Auto-layout cards')
      .setDesc('Automatically arrange cards in a grid')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoLayout)
          .onChange(async (value) => {
            this.plugin.settings.autoLayout = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Card width')
      .setDesc('Width of canvas cards in pixels')
      .addText((text) =>
        text
          .setPlaceholder('250')
          .setValue(String(this.plugin.settings.cardWidth))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.cardWidth = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName('Card height')
      .setDesc('Height of canvas cards in pixels')
      .addText((text) =>
        text
          .setPlaceholder('150')
          .setValue(String(this.plugin.settings.cardHeight))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.cardHeight = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName('Grid spacing')
      .setDesc('Space between cards in pixels')
      .addText((text) =>
        text
          .setPlaceholder('50')
          .setValue(String(this.plugin.settings.gridSpacing))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 0) {
              this.plugin.settings.gridSpacing = num;
              await this.plugin.saveSettings();
            }
          })
      );
  }
}

export default class OpenTabsCanvasPlugin extends Plugin {
  settings: CanvasConfig;
  private tabCollectionService: TabCollectionService;
  private canvasGenerationService: CanvasGenerationService;
  private canvasInteractionService: CanvasInteractionService;

  async onload() {
    console.log('Loading Open Tabs Canvas plugin');

    // Load settings
    await this.loadSettings();

    // Initialize services
    this.tabCollectionService = new TabCollectionService(this.app);
    this.canvasGenerationService = new CanvasGenerationService(
      this.app,
      this.settings
    );
    this.canvasInteractionService = new CanvasInteractionService(
      this.app,
      this.tabCollectionService
    );

    // Register main command
    this.addCommand({
      id: 'open-tabs-canvas-create',
      name: 'Create canvas from open tabs',
      callback: () => this.createCanvasFromOpenTabs()
    });

    // Add ribbon icon
    this.addRibbonIcon('network', 'Create Canvas from Open Tabs', () => {
      this.createCanvasFromOpenTabs();
    });

    // Add settings tab
    this.addSettingTab(new OpenTabsCanvasSettingTab(this.app, this));

    // Listen for leaf opens to attach canvas event listeners
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (!leaf) return;

        // Check if this is a canvas view
        if (leaf.view?.getViewType?.() === 'canvas') {
          // Attach event listeners after a brief delay to ensure render
          setTimeout(() => {
            this.canvasInteractionService.attachCanvasEventListeners(leaf);
          }, 100);
        }
      })
    );

    // Listen for leaf closing to remove handlers
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        // Cleanup on close if needed
      })
    );

    console.log('Open Tabs Canvas plugin loaded');
  }

  onunload() {
    console.log('Unloading Open Tabs Canvas plugin');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async createCanvasFromOpenTabs() {
    try {
      // Collect all open tabs
      const tabs = this.tabCollectionService.getAllOpenTabs();

      if (tabs.length === 0) {
        new Notice('No open tabs found');
        return;
      }

      console.log(`Collected ${tabs.length} open tabs`);

      // Generate canvas structure
      this.canvasGenerationService.generateCanvasFromTabs(tabs);

      // Save canvas file
      const canvasFile = await this.canvasGenerationService.saveCanvasToFile();

      if (canvasFile) {
        // Open the newly created canvas
        const leaf = this.app.workspace.getLeaf(false);
        await leaf?.openFile(canvasFile);

        // Attach event listeners after canvas renders
        setTimeout(() => {
          if (leaf) {
            this.canvasInteractionService.attachCanvasEventListeners(leaf);
          }
        }, 500);

        new Notice(`Created canvas with ${tabs.length} tabs`);
        console.log('Canvas created successfully');
      } else {
        new Notice('Failed to create canvas file');
      }
    } catch (error) {
      console.error('Error creating canvas:', error);
      new Notice('Error creating canvas from open tabs');
    }
  }
}