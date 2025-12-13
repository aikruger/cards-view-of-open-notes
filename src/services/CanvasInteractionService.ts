// src/services/CanvasInteractionService.ts

import { App, Notice, WorkspaceLeaf, View } from 'obsidian';
import { TabCollectionService } from './TabCollectionService';

export class CanvasInteractionService {
  constructor(
    private app: App,
    private tabCollectionService: TabCollectionService
  ) {}

  /**
   * Attach double-click handlers to canvas when it opens
   */
  attachCanvasEventListeners(leaf: WorkspaceLeaf) {
    try {
      // Only attach to canvas views
      if (leaf.view.getViewType() !== 'canvas') {
        return;
      }

      const canvasContainer = leaf.view.containerEl;

      if (!canvasContainer) {
        console.warn('Could not find canvas container');
        return;
      }

      // Create and store the handler for this specific leaf
      const handler = (event: MouseEvent) => {
        this.handleCanvasCardDoubleClick(event, leaf.view);
      };

      // Listen for double-click events
      leaf.view.registerDomEvent(canvasContainer, 'dblclick', handler);
      // @ts-ignore
      console.log('Canvas event listeners attached to leaf:', leaf.id);
    } catch (error)      {
      console.error('Error attaching canvas listeners:', error);
    }
  }

  /**
   * Handle double-click on canvas card
   * This requires getting the leaf ID from the file being clicked
   */
  private handleCanvasCardDoubleClick(event: MouseEvent, view: View) {
    try {
      const target = event.target as HTMLElement;

      // Try to find what was clicked
      if (!target) return;

      const nodeElement = this.findCanvasNodeElement(target);
      if (!nodeElement) {
        return;
      }

      // @ts-ignore
      const canvas = view.canvas;
      const nodes = Array.from(canvas.nodes.values());
      // @ts-ignore
      const clickedNode = nodes.find(node => node.id === nodeElement.id);

      if (clickedNode) {
        // @ts-ignore
        const leafId = clickedNode.metadata?.leafId;
        if (leafId) {
          this.tabCollectionService.focusTab(leafId);
        }
      }

    } catch (error) {
      console.error('Error handling canvas double-click:', error);
    }
  }

  /**
   * Find the canvas node element from clicked target
   */
  private findCanvasNodeElement(element: HTMLElement): HTMLElement | null {
    let current = element;
    let depth = 0;
    const maxDepth = 10;

    while (current && depth < maxDepth) {
      // Check for various node identifiers
      const classList = current.className || '';

      if (
        classList.includes('canvas-node') ||
        classList.includes('node') ||
        current.hasAttribute('data-node-id')
      ) {
        return current;
      }

      // Check for text content that might be a file name
      if (current.textContent && current.textContent.length > 0) {
        // If we found a small text element, this might be a node label
        if (current.offsetWidth < 300 && current.offsetHeight < 200) {
          return current;
        }
      }

      current = current.parentElement as HTMLElement;
      depth++;
    }

    return null;
  }
}