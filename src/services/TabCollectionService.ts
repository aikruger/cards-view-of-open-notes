// src/services/TabCollectionService.ts

import { App, WorkspaceLeaf, Notice } from 'obsidian';
import { OpenTabInfo } from '../interfaces';

export class TabCollectionService {
  constructor(private app: App) {}

  /**
   * Collect all open tabs across the entire workspace
   * Handles all panes, windows, and window groups
   */
  getAllOpenTabs(): OpenTabInfo[] {
    const tabs: OpenTabInfo[] = [];
    const seenLeafIds = new Set<string>();

    try {
      // Get all leaves from workspace
      this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
        // @ts-ignore
        if (seenLeafIds.has(leaf.id)) {
          return;
        }
        // @ts-ignore
        seenLeafIds.add(leaf.id);

        const tabInfo = this.extractTabInfo(leaf);
        if (tabInfo) {
          tabs.push(tabInfo);
        }
      });
    } catch (error) {
      console.error('Error collecting tabs:', error);
      new Notice('Error collecting open tabs');
    }

    return tabs;
  }

  /**
   * Extract relevant information from a WorkspaceLeaf
   */
  private extractTabInfo(leaf: WorkspaceLeaf): OpenTabInfo | null {
    try {
      const view = leaf.view;
      // @ts-ignore
      const file = view?.file;

      // Get display text for the leaf
      let displayName = '';
      try {
        displayName = leaf.getDisplayText();
      } catch {
        displayName = 'Unnamed Tab';
      }

      // Determine file path
      const filePath = file?.path || '';
      const viewType = view?.getViewType() || 'unknown';

      // Get icon if available
      let icon = 'file-text';
      try {
        icon = leaf.getIcon() || 'file-text';
      } catch {
        // Use default icon
      }

      return {
        displayName,
        filePath,
        // @ts-ignore
        leafId: leaf.id,
        viewType,
        isActive: this.app.workspace.activeLeaf === leaf,
        icon
      };
    } catch (error) {
      console.error('Error extracting tab info:', error);
      return null;
    }
  }

  /**
   * Focus/navigate to a specific tab by leaf ID
   */
  focusTab(leafId: string): boolean {
    let found = false;

    this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
      // @ts-ignore
      if (leaf.id === leafId) {
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
        found = true;
      }
    });

    return found;
  }

  /**
   * Get current active tab
   */
  getActiveTab(): OpenTabInfo | null {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf) return null;
    return this.extractTabInfo(activeLeaf);
  }
}