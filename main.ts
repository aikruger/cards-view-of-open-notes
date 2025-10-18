import { App, ItemView, Plugin, TFile, WorkspaceLeaf, Notice, MarkdownRenderer, Component } from 'obsidian';

const VIEW_TYPE_NOTES_EXPLORER = "notes-explorer-view";

export default class NotesExplorerPlugin extends Plugin {
	async onload() {
		// Register the custom view
		this.registerView(
			VIEW_TYPE_NOTES_EXPLORER,
			(leaf) => new NotesExplorerView(leaf)
		);

		// Add ribbon icon to open the view
		this.addRibbonIcon('layout-grid', 'Open Notes Explorer', () => {
			this.activateView();
		});

		// Add command to open the view
		this.addCommand({
			id: 'open-notes-explorer',
			name: 'Open Notes Explorer',
			callback: () => {
				this.activateView();
			}
		});

		// Add debug command
		this.addCommand({
			id: 'debug-cards-view',
			name: 'Debug Cards View',
			callback: () => {
				const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_NOTES_EXPLORER);
				const view = leaves[0]?.view as NotesExplorerView;
				
				if (view) {
					console.log('=== Cards View Debug ===');
					console.log('Open files:', view.getOpenFiles().length);
					console.log('Hidden cards:', view.hiddenCards.size);
					
					const cards = view.cardsContainer.querySelectorAll('.notes-explorer-card');
					console.log('DOM cards:', cards.length);
					
					const pathCounts = new Map<string, number>();
					cards.forEach((card) => {
						const path = card.getAttribute('data-path');
						if (path) {
							pathCounts.set(path, (pathCounts.get(path) || 0) + 1);
						}
					});
					
					console.log('Unique paths:', pathCounts.size);
					
					for (const [path, count] of pathCounts) {
						if (count > 1) {
							console.error(`DUPLICATE: ${path} appears ${count} times`);
						}
					}
					
					new Notice('Check console for debug info');
				} else {
					new Notice('Notes Explorer view not found');
				}
			}
		});

		// Remove auto-activation to prevent unwanted popouts on startup
		// this.app.workspace.onLayoutReady(() => {
		// 	this.activateView();
		// });
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_NOTES_EXPLORER);

		if (leaves.length > 0) {
			// If view already exists, focus on it
			leaf = leaves[0];
		} else {
			// Create a new tab in the main editor area
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({ 
				type: VIEW_TYPE_NOTES_EXPLORER, 
				active: true 
			});
		}

		// Reveal and focus the leaf
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}
}

class NotesExplorerView extends ItemView {
	public cardsContainer: HTMLElement;
	private toolbar: HTMLElement;
	private draggedCard: HTMLElement | null = null;
	private draggedFile: TFile | null = null;
	private draggedLeaf: WorkspaceLeaf | null = null;
	private updateDebounceTimer: number | null = null;
	private minCardHeight: number = 150;  // Minimum card height in pixels
	private maxCardHeight: number = 500;  // Maximum card height in pixels
	private baseFileSize: number = 5000;  // File size (in characters) that maps to maxCardHeight
	private contentScale: number = 1.0;  // Scale property (1.0 = 100%, 0.5 = 50%, etc.)
	private resizeObserver: ResizeObserver | null = null;  // Add resize observer
	private stableCardOrder: Map<string, number> = new Map();  // Map of file.path -> order index
	private orderCounter: number = 0;  // Counter for assigning stable order
	private dropIndicator: HTMLElement | null = null;  // Drop position indicator
	private dropPosition: string | null = null;  // 'top', 'right', 'bottom', 'left'
	private manualColumns: number | null = null;  // null = auto, number = fixed columns
	private cardWidth: number = 220;  // Base card width
	private zoomLevel: number = 1.0;  // 1.0 = 100%, 0.5 = 50%, 1.5 = 150%, etc.
	private minZoom: number = 0.5;
	private maxZoom: number = 2.0;
	private zoomStep: number = 0.1;
	private sortMethod: string = 'manual';  // 'manual', 'name-asc', 'name-desc', 'size-asc', 'size-desc', 'modified'
	private searchQuery: string = '';  // Search query for filtering cards
	public hiddenCards: Set<string> = new Set();  // Track hidden card paths
	private customCardSizes: Map<string, {width: number, height: number}> = new Map(); // Map<filePath, {width, height}>
	private tabObserver: MutationObserver | null = null;  // Observer for tab changes

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_NOTES_EXPLORER;
	}

	getDisplayText(): string {
		return "Notes Explorer";
	}

	getIcon(): string {
		return "layout-grid";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('notes-explorer-view');

		// Create toolbar container
		this.toolbar = container.createDiv({ cls: 'notes-explorer-toolbar' });
		
		// Create scale control
		this.createScaleControl(this.toolbar);
		
		// Create column control
		this.createColumnControl(this.toolbar);
		
		// Create zoom control
		this.createZoomControl(this.toolbar);
		
		// Create layout reset control
		this.createLayoutResetControl(this.toolbar);
		
		// Create sort and search control
		this.createSortAndSearchControl(this.toolbar);
		
		// Create hidden cards control
		this.createHiddenCardsControl(this.toolbar);
		
		// Create load all tabs control
		this.createLoadAllTabsControl(this.toolbar);

		this.cardsContainer = container.createDiv({ cls: 'notes-explorer-cards-container' });

		// Create drop indicator
		this.dropIndicator = this.cardsContainer.createDiv({ cls: 'notes-explorer-drop-indicator' });
		this.dropIndicator.style.display = 'none';

		// Add resize observer for masonry layout
		this.resizeObserver = new ResizeObserver(() => {
			this.layoutMasonryGrid();
		});
		this.resizeObserver.observe(this.cardsContainer);

		// Add keyboard shortcuts for zoom
		this.registerDomEvent(container as HTMLElement, 'keydown', (e: KeyboardEvent) => {
			// Ctrl/Cmd + Plus/Equals for zoom in
			if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
				e.preventDefault();
				this.zoomLevel = Math.min(this.maxZoom, this.zoomLevel + this.zoomStep);
				this.zoomLevel = Math.round(this.zoomLevel * 10) / 10;
				const zoomDisplay = this.toolbar.querySelector('.notes-explorer-zoom-display');
				if (zoomDisplay) {
					zoomDisplay.setText(`${Math.round(this.zoomLevel * 100)}%`);
				}
				this.applyZoom();
			}
			
			// Ctrl/Cmd + Minus for zoom out
			if ((e.ctrlKey || e.metaKey) && e.key === '-') {
				e.preventDefault();
				this.zoomLevel = Math.max(this.minZoom, this.zoomLevel - this.zoomStep);
				this.zoomLevel = Math.round(this.zoomLevel * 10) / 10;
				const zoomDisplay = this.toolbar.querySelector('.notes-explorer-zoom-display');
				if (zoomDisplay) {
					zoomDisplay.setText(`${Math.round(this.zoomLevel * 100)}%`);
				}
				this.applyZoom();
			}
			
			// Ctrl/Cmd + 0 for reset zoom
			if ((e.ctrlKey || e.metaKey) && e.key === '0') {
				e.preventDefault();
				this.zoomLevel = 1.0;
				const zoomDisplay = this.toolbar.querySelector('.notes-explorer-zoom-display');
				if (zoomDisplay) {
					zoomDisplay.setText('100%');
				}
				this.applyZoom();
			}
		});

		// Add mouse wheel zoom with Ctrl/Cmd modifier
		this.registerDomEvent(container as HTMLElement, 'wheel', (e: WheelEvent) => {
			// Only zoom if Ctrl/Cmd is held
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault();
				
				// Determine zoom direction based on wheel delta
				// Positive deltaY = scroll down = zoom out
				// Negative deltaY = scroll up = zoom in
				if (e.deltaY < 0) {
					// Scroll up - zoom in
					this.zoomLevel = Math.min(this.maxZoom, this.zoomLevel + this.zoomStep);
				} else {
					// Scroll down - zoom out
					this.zoomLevel = Math.max(this.minZoom, this.zoomLevel - this.zoomStep);
				}
				
				this.zoomLevel = Math.round(this.zoomLevel * 10) / 10;
				const zoomDisplay = this.toolbar.querySelector('.notes-explorer-zoom-display');
				if (zoomDisplay) {
					zoomDisplay.setText(`${Math.round(this.zoomLevel * 100)}%`);
				}
				this.applyZoom();
			}
		}, { passive: false });

		// Add auto-pan during drag operations
		this.registerDomEvent(this.cardsContainer, 'dragover', (e: DragEvent) => {
			this.handleAutoPan(e);
		});

		// Add click-outside handler to remove focused state
		this.registerDomEvent(document, 'click', (e: MouseEvent) => {
			const clickedCard = (e.target as HTMLElement).closest('.notes-explorer-card');
			if (!clickedCard) {
				// Clicked outside any card - remove all focused states
				this.cardsContainer.querySelectorAll('.notes-explorer-card.focused').forEach((c) => {
					c.removeClass('focused');
				});
			}
		});

		// Listen to workspace changes to update the view
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.debouncedUpdate();
			})
		);

		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				this.debouncedUpdate();
			})
		);

		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.debouncedUpdate();
			})
		);

		// Enable drop zone for files
		this.setupDropZone();

		// Setup tab-to-card highlighting
		this.setupTabToCardHighlighting();

		// Initial render
		this.updateCards();
	}

	private debouncedUpdate() {
		if (this.updateDebounceTimer !== null) {
		window.clearTimeout(this.updateDebounceTimer);
		}
		this.updateDebounceTimer = window.setTimeout(() => {
			this.updateCards();
			this.updateDebounceTimer = null;
		}, 100);
	}

	private setupDropZone() {
		const container = this.containerEl.children[1];
		
		// Listen only to the container (not cardsContainer) to catch all drops
		container.addEventListener('dragenter', (e: DragEvent) => {
			// Check if this is a file from explorer (not our own card)
			if (!this.draggedCard) {
				e.preventDefault();
				this.cardsContainer.addClass('drag-active');
			}
		});
		
		container.addEventListener('dragover', (e: DragEvent) => {
			// Only handle if not dragging our own card
			if (!this.draggedCard) {
				e.preventDefault();
				e.stopPropagation();
				if (e.dataTransfer) {
					e.dataTransfer.dropEffect = 'copy';
				}
			}
		});
		
		container.addEventListener('dragleave', (e: DragEvent) => {
			const rect = container.getBoundingClientRect();
			const x = e.clientX;
			const y = e.clientY;
			
			// Only remove highlight if mouse actually left the container
			if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
				this.cardsContainer.removeClass('drag-active');
			}
		});
		
		container.addEventListener('drop', async (e: DragEvent) => {
			this.cardsContainer.removeClass('drag-active');
			
			// Only process if we're NOT dragging an internal card
			if (!this.draggedCard) {
				e.preventDefault();
				e.stopPropagation();
				
				if (e.dataTransfer) {
					// Obsidian's file explorer uses 'text/plain' with the file path
					let filePath = e.dataTransfer.getData('text/plain');
					
					console.log('Drop detected, filePath:', filePath);
					
					if (filePath && filePath.trim() !== '') {
						await this.handleFileDropped(filePath);
					}
				}
			}
		});
	}

	private async handleFileDropped(filePath: string) {
		try {
			// Clean and normalize the path
			filePath = filePath.trim();
			filePath = decodeURIComponent(filePath);
			
			console.log('Attempting to open file:', filePath);
			
			// Get all files in vault
			const allFiles = this.app.vault.getMarkdownFiles();
			
			// Try exact match first
			let file = allFiles.find(f => f.path === filePath);
			
			// Try without leading slash
			if (!file && filePath.startsWith('/')) {
				file = allFiles.find(f => f.path === filePath.substring(1));
			}
			
			// Try adding .md extension
			if (!file && !filePath.endsWith('.md')) {
				file = allFiles.find(f => f.path === filePath + '.md');
			}
			
			// Try basename match as last resort
			if (!file) {
				const basename = filePath.split('/').pop()?.replace(/\.md$/, '');
				if (basename) {
					file = allFiles.find(f => f.basename === basename);
				}
			}
			
			if (file) {
				console.log('File found:', file.path);
				
				// Check if already open
				const openFiles = this.getOpenFiles();
				const existingInfo = openFiles.find(f => f.file.path === file!.path);
				
				if (existingInfo) {
					new Notice(`${file.name} is already open`);
					this.app.workspace.setActiveLeaf(existingInfo.leaf, { focus: false });
				} else {
					// Open in background tab
					const newLeaf = this.app.workspace.getLeaf('tab');
					await newLeaf.openFile(file, { active: false });
					new Notice(`Opened ${file.name}`);
					
					// Update cards after brief delay
					setTimeout(() => this.updateCards(), 200);
				}
			} else {
				console.error('File not found:', filePath);
				new Notice(`Could not find file: ${filePath}`);
			}
		} catch (error) {
			console.error('Error in handleFileDropped:', error);
			new Notice(`Failed to open file: ${(error as Error).message}`);
		}
	}
	
	private async updateCards() {
		// Clean up any lingering highlights
		document.querySelectorAll('.notes-explorer-highlight').forEach((el) => {
			el.removeClass('notes-explorer-highlight');
		});
		
		const openFiles = this.getOpenFiles();
		
		if (openFiles.length === 0) {
			// Clean up old components
			const oldCards = this.cardsContainer.querySelectorAll('.notes-explorer-card-content');
			oldCards.forEach((contentEl: HTMLElement) => {
				const component = (contentEl as any).component;
				if (component) {
					component.unload();
				}
			});
			
			this.cardsContainer.empty();
			const emptyDiv = this.cardsContainer.createDiv({ cls: 'notes-explorer-empty' });
			emptyDiv.setText('No notes are currently open. Open some notes to see them here.');
			return;
		}
		
		// Get existing cards to avoid recreating them
		const existingCards = new Map<string, HTMLElement>();
		const existingCardEls = this.cardsContainer.querySelectorAll('.notes-explorer-card');
		
		// Track duplicate detection
		const pathCounts = new Map<string, number>();
		
		existingCardEls.forEach((cardEl) => {
			const path = cardEl.getAttribute('data-path');
			if (path) {
				// Count occurrences
				pathCounts.set(path, (pathCounts.get(path) || 0) + 1);
				
				// Only keep first occurrence
				if (!existingCards.has(path)) {
					existingCards.set(path, cardEl as HTMLElement);
				} else {
					// This is a duplicate - remove it immediately
					console.log('Removing duplicate card for:', path);
					const contentEl = cardEl.querySelector('.notes-explorer-card-content') as HTMLElement;
					if (contentEl && (contentEl as any).component) {
						(contentEl as any).component.unload();
					}
					cardEl.remove();
				}
			}
		});
		
		// Log any duplicates found
		for (const [path, count] of pathCounts) {
			if (count > 1) {
				console.warn(`Found ${count} duplicate cards for: ${path}`);
			}
		}
		
		// Determine which cards to keep, add, or remove
		const currentPaths = new Set(openFiles.map(f => f.file.path));
		const existingPaths = new Set(existingCards.keys());
		
		// Remove cards for closed files or files no longer in the list
		for (const path of existingPaths) {
			if (!currentPaths.has(path)) {
				const cardEl = existingCards.get(path);
				const contentEl = cardEl?.querySelector('.notes-explorer-card-content') as HTMLElement;
				if (contentEl && (contentEl as any).component) {
					(contentEl as any).component.unload();
				}
				cardEl?.remove();
			}
		}
		
		// Add new cards only (don't recreate existing ones)
		for (const { file, leaf } of openFiles) {
			if (!existingCards.has(file.path)) {
				await this.createCard(file, leaf);
			} else {
				// Update active state for existing cards
				const cardEl = existingCards.get(file.path);
				const activeFile = this.app.workspace.getActiveFile();
				if (cardEl) {
					if (activeFile && activeFile.path === file.path) {
						cardEl.addClass('active');
					} else {
						cardEl.removeClass('active');
					}
				}
			}
		}
		
		// Layout only once after all cards are ready
		requestAnimationFrame(() => {
			this.layoutMasonryGrid();
		});
	}

	public getOpenFiles(): Array<{ file: TFile, leaf: WorkspaceLeaf }> {
		const openFiles: Array<{ file: TFile, leaf: WorkspaceLeaf }> = [];
		const seenPaths = new Set<string>();

		// Get all leaves in the workspace
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		
		console.log('Total markdown leaves found:', leaves.length);

		for (const leaf of leaves) {
			// Enhanced canvas detection
			let isInCanvas = false;
			
			// Method 1: Check parent view type
			const parentView = (leaf.parent?.parent as any)?.view;
			if (parentView && parentView.getViewType && parentView.getViewType() === 'canvas') {
				console.log('Skipping canvas leaf (method 1):', (leaf.view as any).file?.path);
				isInCanvas = true;
			}
			
			// Method 2: Check if leaf's view type includes canvas
			if ((leaf.view as any).getViewType && (leaf.view as any).getViewType().includes('canvas')) {
				console.log('Skipping canvas leaf (method 2):', (leaf.view as any).file?.path);
				isInCanvas = true;
			}
			
			// Method 3: Check containerEl for canvas-related classes
			if ((leaf as any).containerEl?.closest('.canvas-view')) {
				console.log('Skipping canvas leaf (method 3):', (leaf.view as any).file?.path);
				isInCanvas = true;
			}
			
			if (isInCanvas) continue;
			
			const file = (leaf.view as any).file;
			
			// Skip if not a TFile
			if (!(file instanceof TFile)) {
				console.log('Skipping non-TFile leaf');
				continue;
			}
			
			// Skip if hidden
			if (this.hiddenCards.has(file.path)) {
				console.log('Skipping hidden card:', file.path);
				continue;
			}
			
			// Skip if already seen (duplicate prevention)
			if (seenPaths.has(file.path)) {
				console.log('Skipping duplicate path:', file.path);
				continue;
			}
			
			seenPaths.add(file.path);
			openFiles.push({ file, leaf });
		}
		
		console.log('Final open files count:', openFiles.length);
		
		// Apply sorting
		switch(this.sortMethod) {
			case 'manual':
				// Use stable order
				openFiles.sort((a, b) => {
					const orderA = this.stableCardOrder.get(a.file.path) ?? Infinity;
					const orderB = this.stableCardOrder.get(b.file.path) ?? Infinity;
					return orderA - orderB;
				});
				break;
			case 'name-asc':
				openFiles.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
				break;
			case 'name-desc':
				openFiles.sort((a, b) => b.file.basename.localeCompare(a.file.basename));
				break;
			case 'size-asc':
				openFiles.sort((a, b) => a.file.stat.size - b.file.stat.size);
				break;
			case 'size-desc':
				openFiles.sort((a, b) => b.file.stat.size - a.file.stat.size);
				break;
			case 'modified':
				openFiles.sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
				break;
		}
		
		// Maintain stable order for manual
		if (this.sortMethod === 'manual') {
			// Assign order to new files
			openFiles.forEach(({ file }) => {
				if (!this.stableCardOrder.has(file.path)) {
					this.stableCardOrder.set(file.path, this.orderCounter++);
				}
			});
		}
		
		// Clean up closed files from stableCardOrder
		const currentPaths = new Set(openFiles.map(f => f.file.path));
		for (const [path] of this.stableCardOrder) {
			if (!currentPaths.has(path)) {
				this.stableCardOrder.delete(path);
			}
		}

		return openFiles;
	}

	private calculateCardHeight(fileSize: number): number {
		// fileSize is in characters
		// Calculate height as a percentage of file size relative to baseFileSize
		const heightPercentage = Math.min(fileSize / this.baseFileSize, 1.0);
		
		// Interpolate between min and max heights
		const calculatedHeight = this.minCardHeight + 
			(this.maxCardHeight - this.minCardHeight) * heightPercentage;
		
		return Math.floor(calculatedHeight);
	}

	private createScaleControl(toolbar: HTMLElement) {
		const scaleContainer = toolbar.createDiv({ cls: 'notes-explorer-scale-control' });
		
		// Label
		const label = scaleContainer.createEl('label', { 
			text: 'Card Scale: ',
			cls: 'notes-explorer-scale-label'
		});
		
		// Slider
		const slider = scaleContainer.createEl('input', {
			cls: 'notes-explorer-scale-slider',
			type: 'range'
		});
		slider.min = '0.5';
		slider.max = '1.0';
		slider.step = '0.1';
		slider.value = this.contentScale.toString();
		
		// Value display
		const valueDisplay = scaleContainer.createEl('span', {
			text: `${Math.round(this.contentScale * 100)}%`,
			cls: 'notes-explorer-scale-value'
		});
		
		// Slider event handler
		slider.addEventListener('input', (e: Event) => {
			const target = e.target as HTMLInputElement;
			this.contentScale = parseFloat(target.value);
			valueDisplay.setText(`${Math.round(this.contentScale * 100)}%`);
			this.applyScaleToCards();
		});
		
		// Reset button
		const resetBtn = scaleContainer.createEl('button', {
			text: 'Reset',
			cls: 'notes-explorer-scale-reset'
		});
		resetBtn.addEventListener('click', () => {
			this.contentScale = 1.0;
			slider.value = '1.0';
			valueDisplay.setText('100%');
			this.applyScaleToCards();
		});
	}

	private createColumnControl(toolbar: HTMLElement) {
		const columnContainer = toolbar.createDiv({ cls: 'notes-explorer-column-control' });
		
		// Label
		const label = columnContainer.createEl('label', { 
			text: 'Columns: ',
			cls: 'notes-explorer-column-label'
		});
		
		// Auto/Manual toggle
		const autoCheckbox = columnContainer.createEl('input', {
			type: 'checkbox',
			cls: 'notes-explorer-column-auto'
		});
		autoCheckbox.checked = this.manualColumns === null;
		autoCheckbox.id = 'column-auto';
		
		const autoLabel = columnContainer.createEl('label', {
			text: 'Auto',
			cls: 'notes-explorer-column-auto-label'
		});
		autoLabel.setAttribute('for', 'column-auto');
		
		// Number input for manual columns
		const columnInput = columnContainer.createEl('input', {
			type: 'number',
			cls: 'notes-explorer-column-input'
		});
		columnInput.min = '1';
		columnInput.max = '20';
		columnInput.value = this.manualColumns ? this.manualColumns.toString() : '3';
		columnInput.disabled = this.manualColumns === null;
		
		// Auto checkbox event
		autoCheckbox.addEventListener('change', () => {
			if (autoCheckbox.checked) {
				this.manualColumns = null;
				columnInput.disabled = true;
				this.layoutMasonryGrid();
			} else {
				this.manualColumns = parseInt(columnInput.value);
				columnInput.disabled = false;
				this.layoutMasonryGrid();
			}
		});
		
		// Column input event
		columnInput.addEventListener('input', () => {
			const value = parseInt(columnInput.value);
			if (value > 0 && value <= 20) {
				this.manualColumns = value;
				this.layoutMasonryGrid();
			}
		});
	}

	private createZoomControl(toolbar: HTMLElement) {
		const zoomContainer = toolbar.createDiv({ cls: 'notes-explorer-zoom-control' });
		
		// Zoom out button
		const zoomOutBtn = zoomContainer.createEl('button', {
			cls: 'notes-explorer-zoom-btn',
			title: 'Zoom Out'
		});
		zoomOutBtn.innerHTML = '−'; // Minus sign
		
		// Zoom level display
		const zoomDisplay = zoomContainer.createEl('span', {
			text: '100%',
			cls: 'notes-explorer-zoom-display'
		});
		
		// Zoom in button
		const zoomInBtn = zoomContainer.createEl('button', {
			cls: 'notes-explorer-zoom-btn',
			title: 'Zoom In'
		});
		zoomInBtn.innerHTML = '+'; // Plus sign
		
		// Reset zoom button
		const zoomResetBtn = zoomContainer.createEl('button', {
			text: 'Reset',
			cls: 'notes-explorer-zoom-reset',
			title: 'Reset Zoom to 100%'
		});
		
		// Zoom out event
		zoomOutBtn.addEventListener('click', () => {
			this.zoomLevel = Math.max(this.minZoom, this.zoomLevel - this.zoomStep);
			this.zoomLevel = Math.round(this.zoomLevel * 10) / 10; // Round to 1 decimal
			zoomDisplay.setText(`${Math.round(this.zoomLevel * 100)}%`);
			this.applyZoom();
		});
		
		// Zoom in event
		zoomInBtn.addEventListener('click', () => {
			this.zoomLevel = Math.min(this.maxZoom, this.zoomLevel + this.zoomStep);
			this.zoomLevel = Math.round(this.zoomLevel * 10) / 10; // Round to 1 decimal
			zoomDisplay.setText(`${Math.round(this.zoomLevel * 100)}%`);
			this.applyZoom();
		});
		
		// Reset zoom event
		zoomResetBtn.addEventListener('click', () => {
			this.zoomLevel = 1.0;
			zoomDisplay.setText('100%');
			this.applyZoom();
		});
	}

	private createLayoutResetControl(toolbar: HTMLElement) {
		const resetContainer = toolbar.createDiv({ cls: 'notes-explorer-layout-control' });
		
		const resetBtn = resetContainer.createEl('button', {
			text: 'Reset Layout',
			cls: 'notes-explorer-layout-reset',
			title: 'Reset to masonry layout'
		});
		
		resetBtn.addEventListener('click', () => {
			new Notice('Layout reset to masonry');
			this.layoutMasonryGrid();
		});
	}

	private createSortAndSearchControl(toolbar: HTMLElement) {
		const controlContainer = toolbar.createDiv({ cls: 'notes-explorer-sort-search-control' });
		
		// Sort dropdown
		const sortLabel = controlContainer.createEl('label', {
			text: 'Sort: ',
			cls: 'notes-explorer-sort-label'
		});
		
		const sortSelect = controlContainer.createEl('select', {
			cls: 'notes-explorer-sort-select'
		});
		
		const sortOptions = [
			{ value: 'manual', label: 'Manual Order' },
			{ value: 'name-asc', label: 'Name (A-Z)' },
			{ value: 'name-desc', label: 'Name (Z-A)' },
			{ value: 'size-asc', label: 'Size (Small to Large)' },
			{ value: 'size-desc', label: 'Size (Large to Small)' },
			{ value: 'modified', label: 'Recently Modified' }
		];
		
		sortOptions.forEach(opt => {
			const option = sortSelect.createEl('option', {
				value: opt.value,
				text: opt.label
			});
			if (opt.value === this.sortMethod) {
			 option.selected = true;
			}
		});
		
		sortSelect.addEventListener('change', () => {
			this.sortMethod = sortSelect.value;
			this.updateCards();
		});
		
		// Search input
		const searchLabel = controlContainer.createEl('label', {
			text: 'Search: ',
			cls: 'notes-explorer-search-label'
		});
		
		const searchInput = controlContainer.createEl('input', {
			type: 'text',
			cls: 'notes-explorer-search-input',
			placeholder: 'Filter cards...'
		});
		
		searchInput.value = this.searchQuery;
		
		searchInput.addEventListener('input', () => {
			this.searchQuery = searchInput.value.toLowerCase();
			this.filterCards();
		});
		
		// Clear search button
		const clearBtn = controlContainer.createEl('button', {
			text: '×',
			cls: 'notes-explorer-search-clear',
			title: 'Clear search'
		});
		
		clearBtn.addEventListener('click', () => {
			searchInput.value = '';
			this.searchQuery = '';
			this.filterCards();
		});
	}

	private createHiddenCardsControl(toolbar: HTMLElement) {
		const hiddenContainer = toolbar.createDiv({ cls: 'notes-explorer-hidden-control' });
		
		const hiddenBtn = hiddenContainer.createEl('button', {
			text: `Hidden (${this.hiddenCards.size})`,
			cls: 'notes-explorer-hidden-btn'
		});
		
		hiddenBtn.addEventListener('click', () => {
			// Show modal with list of hidden cards
			this.showHiddenCardsModal();
		});
	}

	private createLoadAllTabsControl(toolbar: HTMLElement) {
		const loadAllContainer = toolbar.createDiv({ cls: 'notes-explorer-load-all-control' });
		
		const loadAllBtn = loadAllContainer.createEl('button', {
			text: 'Load All Tabs',
			cls: 'notes-explorer-load-all-btn',
			title: 'Force load all open tabs as cards'
		});
		
		loadAllBtn.addEventListener('click', async () => {
			const allLeaves = this.app.workspace.getLeavesOfType('markdown');
			let loadedCount = 0;
			
			for (const leaf of allLeaves) {
				// Skip canvas leaves
				const parentView = (leaf.parent?.parent as any)?.view;
				if (parentView && parentView.getViewType && parentView.getViewType() === 'canvas') {
					continue;
				}
				
				const file = (leaf.view as any).file;
				if (file instanceof TFile && !this.hiddenCards.has(file.path)) {
					// Briefly activate each leaf to ensure it's fully loaded
					this.app.workspace.setActiveLeaf(leaf, { focus: false });
					loadedCount++;
				}
			}
			
			// Wait briefly for all leaves to settle
			await new Promise(resolve => setTimeout(resolve, 200));
			
			// Force complete card refresh
			this.updateCards();
			
			new Notice(`Loaded ${loadedCount} tabs as cards`);
		});
	}

	private showHiddenCardsModal() {
		const { Modal } = require('obsidian');
		const modal = new Modal(this.app);
		modal.titleEl.setText('Hidden Cards');
		
		const container = modal.contentEl.createDiv();
		
		if (this.hiddenCards.size === 0) {
			container.createEl('p', { text: 'No hidden cards' });
		} else {
			const list = container.createEl('ul');
			
			for (const path of this.hiddenCards) {
				const item = list.createEl('li');
				const file = this.app.vault.getAbstractFileByPath(path);
				
				if (file) {
					item.createSpan({ text: file.name });
					
					const showBtn = item.createEl('button', { 
						text: 'Show',
						cls: 'mod-cta'
					});
					showBtn.style.marginLeft = '10px';
					showBtn.addEventListener('click', () => {
						this.showCard(path);
						modal.close();
					});
				}
			}
		}
		
		const clearAllBtn = modal.contentEl.createEl('button', {
			text: 'Show All Hidden Cards',
			cls: 'mod-warning'
		});
		clearAllBtn.style.marginTop = '15px';
		clearAllBtn.addEventListener('click', () => {
			this.hiddenCards.clear();
			this.updateCards();
			modal.close();
		});
		
		modal.open();
	}

	private setupTabToCardHighlighting() {
		// Use MutationObserver to detect new tabs being added
		const observer = new MutationObserver(() => {
			this.attachTabHoverListeners();
		});
		
		observer.observe(document.body, {
			childList: true,
			subtree: true
		});
		
		// Initial attachment
		this.attachTabHoverListeners();
		
		// Store observer for cleanup
		this.tabObserver = observer;
	}

	private attachTabHoverListeners() {
		const tabHeaders = document.querySelectorAll('.workspace-tab-header');
		
		tabHeaders.forEach((tabHeader: Element) => {
			const tabHeaderEl = tabHeader as HTMLElement;
			
			// Skip if already has listener
			if (tabHeaderEl.hasAttribute('data-card-hover-attached')) return;
			
			tabHeaderEl.setAttribute('data-card-hover-attached', 'true');
			
			tabHeaderEl.addEventListener('mouseenter', () => {
				this.highlightCorrespondingCard(tabHeaderEl, true);
			});
			
			tabHeaderEl.addEventListener('mouseleave', () => {
				this.highlightCorrespondingCard(tabHeaderEl, false);
			});
		});
	}

	private highlightCorrespondingCard(tabHeader: HTMLElement, highlight: boolean) {
		try {
			// Get file path from tab
			const tabTitle = tabHeader.getAttribute('aria-label');
			const innerTitle = tabHeader.querySelector('.workspace-tab-header-inner-title');
			const fileName = tabTitle || (innerTitle ? innerTitle.textContent : null);
			
			if (!fileName) return;
			
			// Find corresponding card
			const cards = this.cardsContainer.querySelectorAll('.notes-explorer-card');
			
			for (const card of Array.from(cards)) {
				const cardTitle = card.querySelector('.notes-explorer-card-title')?.textContent;
				
				if (cardTitle && cardTitle === fileName) {
					if (highlight) {
						card.addClass('notes-explorer-tab-highlight');
						// Scroll card into view
						(card as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
					} else {
						card.removeClass('notes-explorer-tab-highlight');
					}
					break;
				}
			}
		} catch (error) {
			console.warn('Could not highlight card:', error);
		}
	}

	async onClose() {
		// Remove all tab highlights
		document.querySelectorAll('.notes-explorer-highlight').forEach((el) => {
			el.removeClass('notes-explorer-highlight');
		});
		
		// Clean up all components
		const contentEls = this.cardsContainer.querySelectorAll('.notes-explorer-card-content');
		contentEls.forEach((contentEl: HTMLElement) => {
			const component = (contentEl as any).component;
			if (component) {
				component.unload();
			}
		});
		
		// Clean up debounce timer
		if (this.updateDebounceTimer !== null) {
			window.clearTimeout(this.updateDebounceTimer);
		}
		
		// Clean up resize observer
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
		}
		
		// Clean up tab observer
		if (this.tabObserver) {
			this.tabObserver.disconnect();
		}
	}
}
