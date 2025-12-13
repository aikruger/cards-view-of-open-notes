// src/services/CanvasGenerationService.ts

import { App, Notice, TFile, normalizePath } from 'obsidian';
import {
  CanvasData,
  CanvasFileData,
  CanvasTextData,
  CanvasNodeData,
  CanvasEdgeData
} from 'obsidian/canvas';
import { OpenTabInfo, CanvasConfig } from '../interfaces';

export class CanvasGenerationService {
  private canvas: CanvasData = {
    nodes: [],
    edges: []
  };

  constructor(
    private app: App,
    private settings: CanvasConfig
  ) {}

  /**
   * Generate canvas nodes from open tabs
   */
  generateCanvasFromTabs(tabs: OpenTabInfo[]): CanvasData {
    this.canvas = {
      nodes: [],
      edges: []
    };

    if (tabs.length === 0) {
      return this.canvas;
    }

    // Calculate layout positions
    const positions = this.calculateGridLayout(tabs.length);

    // Create nodes for each tab
    tabs.forEach((tab, index) => {
      const nodeId = `tab-node-${index}`;
      const node = this.createCardNode(tab, nodeId, positions[index]);
      this.canvas.nodes.push(node);
    });

    return this.canvas;
  }

  /**
   * Create a single canvas card node for a tab
   */
  private createCardNode(
    tab: OpenTabInfo,
    nodeId: string,
    position: { x: number; y: number }
  ): CanvasFileData | CanvasTextData {
    // For markdown and canvas files, create file nodes
    if (tab.filePath && (tab.viewType === 'markdown' || tab.viewType === 'canvas')) {
      const fileNode: CanvasFileData = {
        id: nodeId,
        type: 'file',
        file: tab.filePath,
        x: position.x,
        y: position.y,
        width: this.settings.cardWidth,
        height: this.settings.cardHeight,
        color: tab.isActive ? '1' : undefined,
        // @ts-ignore
        metadata: { leafId: tab.leafId }
      };
      return fileNode;
    } else {
      // For other views (graph, search, etc.), use text nodes
      const textNode: CanvasTextData = {
        id: nodeId,
        type: 'text',
        text: `${tab.displayName}\n(${tab.viewType})`,
        x: position.x,
        y: position.y,
        width: this.settings.cardWidth,
        height: this.settings.cardHeight,
        color: tab.isActive ? '1' : undefined,
        // @ts-ignore
        metadata: { leafId: tab.leafId }
      };
      return textNode;
    }
  }

  /**
   * Calculate grid layout positions for nodes
   */
  private calculateGridLayout(
    nodeCount: number
  ): Array<{ x: number; y: number }> {
    const positions: Array<{ x: number; y: number }> = [];

    if (!this.settings.autoLayout || nodeCount === 0) {
      // Default to single column if no auto-layout
      for (let i = 0; i < nodeCount; i++) {
        positions.push({
          x: 0,
          y: i * (this.settings.cardHeight + this.settings.gridSpacing)
        });
      }
      return positions;
    }

    // Calculate grid dimensions for balanced layout
    const cols = Math.max(1, Math.ceil(Math.sqrt(nodeCount)));
    const cardWidth = this.settings.cardWidth;
    const cardHeight = this.settings.cardHeight;
    const spacing = this.settings.gridSpacing;
    const totalWidth = cardWidth + spacing;
    const totalHeight = cardHeight + spacing;

    for (let i = 0; i < nodeCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);

      positions.push({
        x: col * totalWidth,
        y: row * totalHeight
      });
    }

    return positions;
  }

  /**
   * Save canvas to file in vault root
   */
  async saveCanvasToFile(canvasName: string = 'Open Tabs Canvas'): Promise<TFile | null> {
    try {
      const fileName = `${canvasName}.canvas`;
      const normalizedPath = normalizePath(fileName);

      // Ensure unique filename by checking if file exists
      let finalPath = normalizedPath;
      let counter = 1;
      while (this.app.vault.getAbstractFileByPath(finalPath)) {
        const baseName = canvasName;
        finalPath = normalizePath(`${baseName} ${counter}.canvas`);
        counter++;
      }

      // Serialize canvas data to JSON
      const canvasContent = JSON.stringify(this.canvas, null, 2);

      // Create file
      const file = await this.app.vault.create(finalPath, canvasContent);
      return file;
    } catch (error) {
      console.error('Error saving canvas file:', error);
      new Notice('Failed to save canvas file');
      return null;
    }
  }
}