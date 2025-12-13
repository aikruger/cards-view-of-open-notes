// src/interfaces.ts

export interface OpenTabInfo {
  displayName: string;       // File name or view title
  filePath: string;          // Full file path (empty for non-file views)
  leafId: string;            // Unique leaf identifier
  viewType: string;          // 'markdown', 'canvas', 'image', etc.
  isActive: boolean;         // Is this the currently focused tab
  icon?: string;             // Icon for the tab
}

export interface CanvasConfig {
  autoLayout: boolean;       // Auto-arrange cards in grid
  cardWidth: number;         // Card width in pixels
  cardHeight: number;        // Card height in pixels
  gridSpacing: number;       // Spacing between cards
}