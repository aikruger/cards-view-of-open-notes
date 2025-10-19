import { App, ItemView, Plugin, TFile, WorkspaceLeaf, Notice, MarkdownRenderer, Component } from 'obsidian';
import { NotesExplorerMenuView, VIEW_TYPE_NOTES_EXPLORER_MENU } from './menu-view';

const VIEW_TYPE_NOTES_EXPLORER = "notes-explorer-view";

export default class NotesExplorerPlugin extends Plugin {
	async onload() {
		// Register the custom view
		this.registerView(
			VIEW_TYPE_NOTES_EXPLORER,
			(leaf) => new NotesExplorerView(leaf)
		);

		// Register the menu view
		this.registerView(
			VIEW_TYPE_NOTES_EXPLORER_MENU,
			(leaf) => new NotesExplorerMenuView(leaf, this)
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

		this.app.workspace.onLayoutReady(() => {
			this.activateMenuView();
		});
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

		// Trigger event to notify menu view
		this.app.workspace.trigger('notes-explorer:view-state-changed');
	}

	async activateMenuView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_NOTES_EXPLORER_MENU);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_NOTES_EXPLORER_MENU, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	getNotesExplorerView(): NotesExplorerView | null {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_NOTES_EXPLORER);
		if (leaves.length > 0) {
			return leaves[0].view as NotesExplorerView;
		}
		return null;
	}
}

export class NotesExplorerView extends ItemView {
	public cardsContainer: HTMLElement;
	private toolbar: HTMLElement;
	public draggedCard: HTMLElement | null = null;
	public draggedFile: TFile | null = null;
	public draggedLeaf: WorkspaceLeaf | null = null;
	public updateDebounceTimer: number | null = null;
	public minCardHeight: number = 150;  // Minimum card height in pixels
	public maxCardHeight: number = 500;  // Maximum card height in pixels
	public baseFileSize: number = 5000;  // File size (in characters) that maps to maxCardHeight
	public contentScale: number = 1.0;  // Scale property (1.0 = 100%, 0.5 = 50%, etc.)
	public resizeObserver: ResizeObserver | null = null;  // Add resize observer
	public stableCardOrder: Map<string, number> = new Map();  // Map of file.path -> order index
	public orderCounter: number = 0;  // Counter for assigning stable order
	public dropIndicator: HTMLElement | null = null;  // Drop position indicator
	public dropPosition: string | null = null;  // 'top', 'right', 'bottom', 'left'
	public manualColumns: number | null = null;  // null = auto, number = fixed columns
	public cardWidth: number = 220;  // Base card width
	public zoomLevel: number = 1.0;  // 1.0 = 100%, 0.5 = 50%, 1.5 = 150%, etc.
	public minZoom: number = 0.5;
	public maxZoom: number = 2.0;
	public zoomStep: number = 0.1;
	public sortMethod: string = 'manual';  // 'manual', 'name-asc', 'name-desc', 'size-asc', 'size-desc', 'modified'
	public searchQuery: string = '';  // Search query for filtering cards
	public hiddenCards: Set<string> = new Set();  // Track hidden card paths
	public customCardSizes: Map<string, {width: number, height: number}> = new Map(); // Map<filePath, {width, height}>
	public tabObserver: MutationObserver | null = null;  // Observer for tab changes

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);

		// Listen for custom events from the menu
		this.registerEvent(this.app.workspace.on('notes-explorer:set-zoom', (newZoom: number) => {
			this.zoomLevel = newZoom;
			this.applyZoom();
		}));

		this.registerEvent(this.app.workspace.on('notes-explorer:set-scale', (newScale: number) => {
			this.contentScale = newScale;
			this.applyScaleToCards();
		}));

		this.registerEvent(this.app.workspace.on('notes-explorer:set-columns', (newColumns: number | null) => {
			this.manualColumns = newColumns;
			this.applyColumns();
		}));

		this.registerEvent(this.app.workspace.on('notes-explorer:set-sort', (newSort: string) => {
			this.sortMethod = newSort;
			this.updateCards();
		}));

		this.registerEvent(this.app.workspace.on('notes-explorer:set-search', (newSearch: string) => {
			this.searchQuery = newSearch;
			this.filterCards();
		}));

		this.registerEvent(this.app.workspace.on('notes-explorer:reload', () => {
			this.updateCards();
		}));

		this.registerEvent(this.app.workspace.on('notes-explorer:reset-layout', () => {
			this.layoutMasonryGrid();
		}));

		this.registerEvent(this.app.workspace.on('notes-explorer:show-hidden-modal', () => {
			this.showHiddenCardsModal();
		}));

		this.registerEvent(this.app.workspace.on('notes-explorer:load-all-tabs', async () => {
			const allLeaves = this.app.workspace.getLeavesOfType('markdown');
			let loadedCount = 0;

			for (const leaf of allLeaves) {
				const parentView = (leaf.parent?.parent as any)?.view;
				if (parentView && parentView.getViewType && parentView.getViewType() === 'canvas') {
					continue;
				}

				const file = (leaf.view as any).file;
				if (file instanceof TFile && !this.hiddenCards.has(file.path)) {
					this.app.workspace.setActiveLeaf(leaf, { focus: false });
					loadedCount++;
				}
			}

			await new Promise(resolve => setTimeout(resolve, 200));

			this.updateCards();

			new Notice(`Loaded ${loadedCount} tabs as cards`);
		}));
	}

	public applyZoom() {
		// This now only applies the transform to individual cards and triggers a layout update.
		// It no longer scales the container.
		this.applyScaleToCards();
		this.app.workspace.trigger('notes-explorer:zoom-changed', this.zoomLevel);
	}

	public applyScaleToCards() {
		const cards = this.cardsContainer.querySelectorAll(".notes-explorer-card") as NodeListOf<HTMLElement>;
		const combinedScale = this.zoomLevel * this.contentScale;

		cards.forEach(card => {
			card.style.transform = `scale(${combinedScale})`;
			card.style.transformOrigin = "top left";
		});

		// After scaling, recompute masonry layout
		requestAnimationFrame(() => this.layoutMasonryGrid());
	}

	public layoutMasonryGrid() {
		if (!this.cardsContainer) return;

		let cards = Array.from(
			this.cardsContainer.querySelectorAll('.notes-explorer-card')
		) as HTMLElement[];

		// If sorting manually, we must sort the array before calculating layout
		if (this.sortMethod === 'manual') {
			cards.sort((a, b) => {
				const orderA = this.stableCardOrder.get(a.dataset.path!) ?? Infinity;
				const orderB = this.stableCardOrder.get(b.dataset.path!) ?? Infinity;
				return orderA - orderB;
			});
		}

		if (cards.length === 0) return;

		// Compute effective widths based on combined zoom and content scale
		const effectiveScale = this.zoomLevel * this.contentScale;
		// Use the original (100%) container width, then scale it
		const rawContainerWidth = this.cardsContainer.clientWidth;
		const containerWidth = rawContainerWidth * effectiveScale;

		// Card width before transform
		const baseCardWidth = this.cardWidth;
		const scaledCardWidth = baseCardWidth * effectiveScale;

		// Determine columns by fitting scaled cards into scaled container
		const columnCount = this.manualColumns ||
			Math.max(1, Math.floor(containerWidth / (scaledCardWidth + 10)));

		const gap = 10;
		const columnWidth = this.cardWidth; // Base width for styling

		// Initialize column heights
		const columnHeights = new Array(columnCount).fill(0);

		// Position each card
		cards.forEach((card) => {
			// Find the shortest column
			const shortestColumnIndex = columnHeights.indexOf(Math.min(...columnHeights));

			// The card's offsetWidth/Height already reflect the transformation, so we can use them directly
			const cardHeight = card.offsetHeight;

			// Calculate position
			const left = shortestColumnIndex * (scaledCardWidth + gap);
			const top = columnHeights[shortestColumnIndex];

			// Apply position (note: width is set on the card, not scaled here)
			card.style.left = `${left}px`;
			card.style.top = `${top}px`;
			card.style.width = `${columnWidth}px`; // Use base width for the element style

			// Update column height
			columnHeights[shortestColumnIndex] += cardHeight + gap;
		});

		// Set container height to tallest column
		const tallestColumn = Math.max(...columnHeights);
		this.cardsContainer.style.height = `${tallestColumn}px`;
	}

	public filterCards() {
		const cards = this.cardsContainer.querySelectorAll('.notes-explorer-card');
		cards.forEach((card: HTMLElement) => {
			const path = card.dataset.path;
			if (path && path.toLowerCase().includes(this.searchQuery)) {
				card.style.display = '';
			} else {
				card.style.display = 'none';
			}
		});
		this.layoutMasonryGrid();
	}

	public handleAutoPan(e: DragEvent) {
		const container = this.cardsContainer;
		const scrollSpeed = 15;
		const threshold = 50; // pixels from edge

		const rect = container.getBoundingClientRect();
		const x = e.clientX;
		const y = e.clientY;

		if (x < rect.left + threshold) {
			container.scrollLeft -= scrollSpeed;
		} else if (x > rect.right - threshold) {
			container.scrollLeft += scrollSpeed;
		}

		if (y < rect.top + threshold) {
			container.scrollTop -= scrollSpeed;
		} else if (y > rect.bottom - threshold) {
			container.scrollTop += scrollSpeed;
		}
	}

	public hideCard(path: string) {
		this.hiddenCards.add(path);
		this.updateCards();
		this.app.workspace.trigger('notes-explorer:hidden-cards-updated', this.hiddenCards.size);
	}

	public showCard(path: string) {
		if (this.hiddenCards.has(path)) {
			this.hiddenCards.delete(path);
			this.updateCards();

			// Update button text in menu view
			this.app.workspace.trigger('notes-explorer:hidden-cards-updated', this.hiddenCards.size);
		}
	}

	public applyColumns() {
		this.layoutMasonryGrid();
	}

	async createCard(file: TFile, leaf: WorkspaceLeaf, prepend: boolean = false) {
		const card = this.cardsContainer.createDiv({ cls: 'notes-explorer-card' });
		card.setAttribute('data-path', file.path);

		// Draggable attribute
		card.setAttribute('draggable', 'true');

		// Add stable order attribute for manual sorting
		if (!this.stableCardOrder.has(file.path)) {
			this.stableCardOrder.set(file.path, this.orderCounter++);
		}
		card.style.order = (this.stableCardOrder.get(file.path) ?? 0).toString();

		// Set active state
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && activeFile.path === file.path) {
			card.addClass('active');
		}

		// Header
		const header = card.createDiv({ cls: 'notes-explorer-card-header' });

		// Click to focus tab
		header.addEventListener('click', () => {
			this.app.workspace.setActiveLeaf(leaf, { focus: true });
		});

		// Title
		header.createDiv({
			cls: 'notes-explorer-card-title',
			text: file.basename
		});

		// Controls (close button)
		const controls = header.createDiv({ cls: 'notes-explorer-card-controls' });

		const hideBtn = controls.createDiv({ cls: 'notes-explorer-card-control' });
		hideBtn.setAttribute('aria-label', 'Hide card');
		hideBtn.innerHTML = 'H'; // Hide icon
		hideBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.hideCard(file.path);
		});

		const closeBtn = controls.createDiv({ cls: 'notes-explorer-card-control' });
		closeBtn.setAttribute('aria-label', 'Close note');
		closeBtn.innerHTML = '×'; // Close icon
		closeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			leaf.detach(); // Close the tab
			this.updateCards();
		});

		// Content
		const content = card.createDiv({ cls: 'notes-explorer-card-content' });

		// Attach a component for proper lifecycle management
		const component = new Component();
		(content as any).component = component;

		try {
			const fileContent = await this.app.vault.cachedRead(file);
			await MarkdownRenderer.render(this.app, fileContent, content, file.path, component);
			component.load();

			// Wait for content to render, then recalculate layout
			requestAnimationFrame(() => {
				this.layoutMasonryGrid();
			});
		} catch (e) {
			content.setText(`Error loading content: ${e}`);
		}

		// Calculate height and apply scale
		const fileSize = (await this.app.vault.cachedRead(file)).length;
		const height = this.calculateCardHeight(fileSize);
		card.style.height = `${height}px`;

		// Custom resizer
		const resizer = card.createDiv({ cls: 'notes-explorer-card-resizer' });
		let isResizing = false;
		let startX: number, startY: number, startWidth: number, startHeight: number;

		resizer.addEventListener('mousedown', (e: MouseEvent) => {
			isResizing = true;
			startX = e.clientX;
			startY = e.clientY;
			startWidth = card.offsetWidth;
			startHeight = card.offsetHeight;

			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
		});

		const onMouseMove = (e: MouseEvent) => {
			if (!isResizing) return;
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;

			card.style.width = `${startWidth + dx}px`;
			card.style.height = `${startHeight + dy}px`;

			// Disable masonry layout while resizing
			this.cardsContainer.style.gridTemplateRows = 'auto';
		};

		const onMouseUp = () => {
			isResizing = false;
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);

			// Store custom size
			this.customCardSizes.set(file.path, {
				width: card.offsetWidth,
				height: card.offsetHeight
			});

			// Force immediate layout recalculation
			requestAnimationFrame(() => {
				this.layoutMasonryGrid();
			});
		};

		// Drag and drop handling
		card.addEventListener('dragstart', (e: DragEvent) => {
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = 'move';
				e.dataTransfer.setData('text/plain', file.path);
			}
			this.draggedCard = card;
			this.draggedFile = file;
			this.draggedLeaf = leaf;
			card.addClass('dragging');
			this.cardsContainer.addClass('card-dragging');
		});

		card.addEventListener('dragend', () => {
			this.draggedCard?.removeClass('dragging');
			this.draggedCard = null;
			this.draggedFile = null;
			this.draggedLeaf = null;
			this.cardsContainer.removeClass('card-dragging');
			this.dropIndicator!.style.display = 'none';
		});

		card.addEventListener('dragover', (e: DragEvent) => {
			e.preventDefault();
			if (this.draggedCard && this.draggedCard !== card) {
				const rect = card.getBoundingClientRect();
				const x = e.clientX - rect.left;
				const y = e.clientY - rect.top;

				const dropThreshold = 0.25; // 25% of the card's dimension

				// Default to horizontal (left/right) if card is wider than tall
				let isWider = card.offsetWidth > card.offsetHeight;

				if (x < rect.width * dropThreshold) {
					this.dropPosition = 'left';
					this.dropIndicator!.style.display = 'block';
					this.dropIndicator!.style.left = `${card.offsetLeft}px`;
					this.dropIndicator!.style.top = `${card.offsetTop}px`;
					this.dropIndicator!.style.width = '4px';
					this.dropIndicator!.style.height = `${card.offsetHeight}px`;
				} else if (x > rect.width * (1 - dropThreshold)) {
					this.dropPosition = 'right';
					this.dropIndicator!.style.display = 'block';
					this.dropIndicator!.style.left = `${card.offsetLeft + card.offsetWidth - 4}px`;
					this.dropIndicator!.style.top = `${card.offsetTop}px`;
					this.dropIndicator!.style.width = '4px';
					this.dropIndicator!.style.height = `${card.offsetHeight}px`;
				} else if (y < rect.height * dropThreshold) {
					this.dropPosition = 'top';
					this.dropIndicator!.style.display = 'block';
					this.dropIndicator!.style.left = `${card.offsetLeft}px`;
					this.dropIndicator!.style.top = `${card.offsetTop}px`;
					this.dropIndicator!.style.width = `${card.offsetWidth}px`;
					this.dropIndicator!.style.height = '4px';
				} else if (y > rect.height * (1 - dropThreshold)) {
					this.dropPosition = 'bottom';
					this.dropIndicator!.style.display = 'block';
					this.dropIndicator!.style.left = `${card.offsetLeft}px`;
					this.dropIndicator!.style.top = `${card.offsetTop + card.offsetHeight - 4}px`;
					this.dropIndicator!.style.width = `${card.offsetWidth}px`;
					this.dropIndicator!.style.height = '4px';
				} else {
					this.dropPosition = null;
					this.dropIndicator!.style.display = 'none';
				}
			}
		});

		card.addEventListener('drop', (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();

			if (this.draggedCard && this.draggedCard !== card) {
				const draggedOrder = this.stableCardOrder.get(this.draggedFile!.path)!;
				const targetOrder = this.stableCardOrder.get(file.path)!;

				// Update order values for all affected cards
				for (const [path, order] of this.stableCardOrder.entries()) {
					if (draggedOrder < targetOrder) { // Dragged down
						if (order > draggedOrder && order <= targetOrder) {
							this.stableCardOrder.set(path, order - 1);
						}
					} else { // Dragged up
						if (order < draggedOrder && order >= targetOrder) {
							this.stableCardOrder.set(path, order + 1);
						}
					}
				}

				// Place the dragged card at the target position
				this.stableCardOrder.set(this.draggedFile!.path, targetOrder);

				// Update card order styles
				this.cardsContainer.querySelectorAll('.notes-explorer-card').forEach((c: HTMLElement) => {
					const path = c.dataset.path;
					if (path && this.stableCardOrder.has(path)) {
						c.style.order = (this.stableCardOrder.get(path) ?? 0).toString();
					}
				});

				// Re-sort and re-layout
				//this.updateCards();
				requestAnimationFrame(() => this.layoutMasonryGrid());
			}

			this.dropIndicator!.style.display = 'none';
		});

		// Focus on click
		card.addEventListener('click', (e: MouseEvent) => {
			// Remove 'focused' from all other cards
			this.cardsContainer.querySelectorAll('.notes-explorer-card.focused').forEach((c) => {
				c.removeClass('focused');
			});
			// Add 'focused' to the clicked card
			card.addClass('focused');
		});

		card.addEventListener("dblclick", async () => {
			const { workspace, vault } = this.app;
			const leaves = workspace.getLeavesOfType("markdown"); // Only markdown leaves
			let leaf = leaves.find(l => l.getDisplayText() === file.basename);

			if (leaf) {
				workspace.setActiveLeaf(leaf);
			} else {
				const newLeaf = workspace.getLeaf("tab");
				await newLeaf.openFile(file);
				workspace.setActiveLeaf(newLeaf);
			}
		});

		if (prepend) {
			this.cardsContainer.prepend(card);
		} else {
			this.cardsContainer.appendChild(card);
		}
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

		this.cardsContainer = container.createDiv({ cls: 'notes-explorer-cards-container' });

		// Create drop indicator
		this.dropIndicator = this.cardsContainer.createDiv({ cls: 'notes-explorer-drop-indicator' });
		this.dropIndicator.style.display = 'none';

		// Add resize observer for masonry layout
		this.resizeObserver = new ResizeObserver(() => {
			this.layoutMasonryGrid();
		});
		this.resizeObserver.observe(this.cardsContainer);

		// Add auto-pan during drag operations
		this.registerDomEvent(this.cardsContainer, 'dragover', (e: DragEvent) => {
			this.handleAutoPan(e);
		});

		// Add keyboard shortcuts for zoom
		this.registerDomEvent(container as HTMLElement, 'keydown', (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
				e.preventDefault();
				this.zoomLevel = Math.min(this.maxZoom, this.zoomLevel + this.zoomStep);
				this.zoomLevel = Math.round(this.zoomLevel * 10) / 10;
				this.applyZoom();
			}

			if ((e.ctrlKey || e.metaKey) && e.key === '-') {
				e.preventDefault();
				this.zoomLevel = Math.max(this.minZoom, this.zoomLevel - this.zoomStep);
				this.zoomLevel = Math.round(this.zoomLevel * 10) / 10;
				this.applyZoom();
			}

			if ((e.ctrlKey || e.metaKey) && e.key === '0') {
				e.preventDefault();
				this.zoomLevel = 1.0;
				this.applyZoom();
			}
		});

		// Add mouse wheel zoom with Ctrl/Cmd modifier
		this.registerDomEvent(container as HTMLElement, 'wheel', (e: WheelEvent) => {
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault();

				if (e.deltaY < 0) {
					this.zoomLevel = Math.min(this.maxZoom, this.zoomLevel + this.zoomStep);
				} else {
					this.zoomLevel = Math.max(this.minZoom, this.zoomLevel - this.zoomStep);
				}

				this.zoomLevel = Math.round(this.zoomLevel * 10) / 10;
				this.applyZoom();
			}
		}, { passive: false });

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

	public debouncedUpdate() {
		if (this.updateDebounceTimer !== null) {
		window.clearTimeout(this.updateDebounceTimer);
		}
		this.updateDebounceTimer = window.setTimeout(() => {
			this.updateCards();
			this.updateDebounceTimer = null;
		}, 100);
	}

	public setupDropZone() {
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

	public async handleFileDropped(filePath: string) {
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

	public async updateCards() {
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

		// Trigger event to update card count in menu
		this.app.workspace.trigger('notes-explorer:cards-count-updated', openFiles.length);
		this.app.workspace.trigger('notes-explorer:view-state-changed');
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

	public calculateCardHeight(fileSize: number): number {
		// fileSize is in characters
		// Calculate height as a percentage of file size relative to baseFileSize
		const heightPercentage = Math.min(fileSize / this.baseFileSize, 1.0);
		
		// Interpolate between min and max heights
		const calculatedHeight = this.minCardHeight + 
			(this.maxCardHeight - this.minCardHeight) * heightPercentage;
		
		return Math.floor(calculatedHeight);
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

	public setupTabToCardHighlighting() {
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

	public attachTabHoverListeners() {
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

	public highlightCorrespondingCard(tabHeader: HTMLElement, highlight: boolean) {
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
