import { App, ItemView, Plugin, TFile, WorkspaceLeaf, Notice, MarkdownRenderer, Component } from 'obsidian';
import { NotesExplorerMenuView, VIEW_TYPE_NOTES_EXPLORER_MENU } from './menu-view';

const VIEW_TYPE_NOTES_EXPLORER = "notes-explorer-view";

// Moved CardPosition to top-level so it's accessible throughout the file
interface CardPosition {
	file: TFile;
	x: number;
	y: number;
	width: number;
	height: number;
	groupId?: string;
}

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

		// Check if we're in a floating window (popout)
		const isFloatingWindow = this.app.workspace.activeLeaf?.getRoot() !== (this.app.workspace as any).rootSplit;
		if (isFloatingWindow) {
			console.log('Skipping menu view in floating window');
			return;
		}

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
	public transformContainer: HTMLElement;
	private canvasWrapper: HTMLElement;
	private panX: number = 0;
	private panY: number = 0;
	private isDraggingCanvas: boolean = false;
	private dragStartX: number = 0;
	private dragStartY: number = 0;
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
	private cardPositions: Map<string, CardPosition> = new Map();
	public cardConnections: Map<string, Set<string>>;
	public connectionGroups: Map<string, Set<string>>;
	public nextGroupId: number;
	public edgeHighlight: HTMLElement | null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);

		this.cardConnections = new Map(); // Map<filePath, Set<connectedPaths>>
		this.connectionGroups = new Map(); // Map<groupId, Set<filePaths>>
		this.nextGroupId = 0; // Counter for unique group IDs
		this.edgeHighlight = null; // DOM element for edge highlighting

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

		// Full reset including pan/zoom and card positions
		this.registerEvent((this.app.workspace as any).on('notes-explorer:reset-layout-full', () => {
			this.panX = 0;
			this.panY = 0;
			this.zoomLevel = 1;

			this.cardPositions.clear();
			this.stableCardOrder.clear();
			this.orderCounter = 0;

			this.updateTransform();
			this.layoutMasonryGrid();
			this.updateCards();

			console.log('Canvas fully reset to initial state');
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

		// Layout is no longer reset on scale/zoom changes
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
		// Column changes are visual only via CSS grid
		// Card positions are preserved from stored values
		console.log('Column layout applied, card positions preserved');
	}

	// Added optional index parameter default to 0 to avoid undefined usage
	async createCard(file: TFile, leaf: WorkspaceLeaf, prepend: boolean = false, index: number = 0) {
		const card = this.transformContainer.createDiv({ cls: ['card', 'notes-explorer-card'] });
		card.setAttribute('data-path', file.path);

		// Get saved position or calculate initial mosaic position
		let position = this.cardPositions.get(file.path);

		if (!position) {
			// Initialize position for masonry layout
			// Actual positioning will be done by layoutMasonryGrid()
			const offsetX = (index % 3) * 30;
			const offsetY = Math.floor(index / 3) * 30;
			
			position = {
				file,
				x: offsetX,  // Start at 0,0 - masonry will reposition
				y: offsetY,  // Staggered rows for initial visible separation
				width: 300,
				height: 200,
				groupId: undefined
			};
			this.cardPositions.set(file.path, position);

			console.log('New card initialized for masonry layout:', {
				filePath: file.path,
				index,
				initialX: position.x,
				initialY: position.y
			});
		}

		// Apply absolute positioning
		card.style.position = 'absolute';
		card.style.left = position.x + 'px';
		card.style.top = position.y + 'px';
		card.style.width = position.width + 'px';
		card.style.height = position.height + 'px';

		// Ensure visibility
		card.style.display = 'block';
		card.style.visibility = 'visible';
		card.style.opacity = '1';
		card.style.zIndex = '1';

		// Make draggable
		this.makeCardDraggable(card, file);

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
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);

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
		});

		// Focus on click with debounce to allow dblclick detection
		let clickTimer: number | null = null;
		card.addEventListener('click', (e: MouseEvent) => {
			if (clickTimer !== null) {
			window.clearTimeout(clickTimer);
				clickTimer = null;
				return; // dblclick incoming; skip single-click
			}

			clickTimer = window.setTimeout(() => {
				clickTimer = null;
				// Visual feedback only; do not change focus
				this.cardsContainer.querySelectorAll('.notes-explorer-card.focused').forEach((c) => {
					c.removeClass('focused');
				});
				card.addClass('focused');
			}, 250);
		});

		card.addEventListener('dblclick', async () => {
			if (clickTimer !== null) {
				window.clearTimeout(clickTimer);
				clickTimer = null;
			}
			// Only double-click changes focus
			const { workspace } = this.app;
			const leaves = workspace.getLeavesOfType('markdown');
			let leaf2 = leaves.find(l => l.getDisplayText() === file.basename);
			if (leaf2) {
				console.log('Double-click: Switching to existing leaf for', file.basename);
				workspace.setActiveLeaf(leaf2, { focus: true });
			} else {
				console.log('Double-click: Opening new leaf for', file.basename);
				const newLeaf = workspace.getLeaf('tab');
				await newLeaf.openFile(file);
				workspace.setActiveLeaf(newLeaf, { focus: true });
			}
		});


		if (prepend) {
			this.cardsContainer.prepend(card);
		} else {
			this.cardsContainer.appendChild(card);
		}

		// Card creation does not trigger layout reset
		// Card positions are preserved from cardPositions map
	}

	// Listen for window/container resize and reset canvas accordingly
	private setupResizeListener() {
		const resizeObserver = new ResizeObserver(() => {
			this.resetCanvasView();
		});
		resizeObserver.observe(this.containerEl);
		this.resizeObserver = resizeObserver;

		this.registerEvent(
			this.app.workspace.on('resize', () => {
				this.resetCanvasView();
			})
		);
	}

	// Preserve zoom/pan while adjusting sizes on resize
	private resetCanvasView() {
		const rect = this.canvasWrapper.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;

		// Keep wrapper full size
		this.canvasWrapper.style.width = '100%';
		this.canvasWrapper.style.height = '100%';

		// Container size changes no longer trigger layout reset
		// Only transform (pan/zoom) is updated to preserve position

		// Do NOT reset pan/zoom
		// this.panX = 0;
		// this.panY = 0;
		// this.zoomLevel = 1;

		// Apply current pan/zoom
		this.updateTransform();

		console.log('Canvas resized (zoom/pan preserved):', {
			width: rect.width,
			height: rect.height,
			zoom: this.zoomLevel,
			panX: this.panX,
			panY: this.panY
		});
	}

	private setupZoomControls(): void {
		this.registerDomEvent(this.containerEl, 'wheel', (e: WheelEvent) => {
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault();

				const delta = e.deltaY > 0 ? 0.9 : 1.1;
				this.zoomLevel = Math.max(0.1, Math.min(5, this.zoomLevel * delta));

				this.updateTransform();
			}
		}, { passive: false });
	}

	private updateTransform(): void {
		this.transformContainer.style.transform =
			`translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
	}

	private setupCanvasPanning(): void {
		this.registerDomEvent(this.canvasWrapper, 'mousedown', (e: MouseEvent) => {
			// Only pan with middle mouse or space+click
			if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
				e.preventDefault();
				this.isDraggingCanvas = true;
				this.dragStartX = e.clientX - this.panX;
				this.dragStartY = e.clientY - this.panY;
				this.canvasWrapper.style.cursor = 'grabbing';
			}
		});

		this.registerDomEvent(document, 'mousemove', (e: MouseEvent) => {
			if (this.isDraggingCanvas) {
				this.panX = e.clientX - this.dragStartX;
				this.panY = e.clientY - this.dragStartY;
				this.updateTransform();
			}
		});

		this.registerDomEvent(document, 'mouseup', () => {
			this.isDraggingCanvas = false;
			this.canvasWrapper.style.cursor = 'default';
		});
	}

	private makeCardDraggable(card: HTMLElement, file: TFile): void {
		let isDragging = false;
		let dragOccurred = false;
		let startX = 0;
		let startY = 0;
		let initialX = 0;
		let initialY = 0;
		let isEdgeAttachMode = false;
		let lastClientX = 0;
		let lastClientY = 0;
		let initialGroupPositions = new Map<string, { x: number, y: number }>(); // ← Move outside, declare once

		card.addEventListener("mousedown", (e: MouseEvent) => {
			if ((e.target as HTMLElement).closest(".card-close, .card-content")) {
				return;
			}
			e.stopPropagation();

			isDragging = true;
			dragOccurred = false;
			isEdgeAttachMode = e.altKey;

			let position = this.cardPositions.get(file.path);
			if (!position) {
				position = {
					file,
					x: card.offsetLeft,
					y: card.offsetTop,
					width: card.offsetWidth || 300,
					height: card.offsetHeight || 200,
					groupId: undefined
				};
				this.cardPositions.set(file.path, position);
			}

			initialX = position.x;
			initialY = position.y;
			
			// Store RAW screen coordinates (don't divide!)
			startX = e.clientX;
			startY = e.clientY;
			lastClientX = e.clientX;
			lastClientY = e.clientY;

			// Store INITIAL positions for ALL group members at start
			initialGroupPositions = new Map();
			const groupMembers = this.getGroupMembers(file.path);
			groupMembers.forEach((memberPath: string) => {
				const pos = this.cardPositions.get(memberPath);
				if (pos) {
					initialGroupPositions.set(memberPath, { 
						x: pos.x, 
						y: pos.y 
					});
				}
			});

			card.style.cursor = "grabbing";
			card.style.zIndex = "1000";
			card.addClass("dragging");
			this.cardsContainer.addClass("card-dragging");

			if (isEdgeAttachMode) {
				this.edgeHighlight = this.transformContainer.createDiv('notes-explorer-edge-highlight');
				this.edgeHighlight.style.display = 'none';
			}

			document.addEventListener("mousemove", onMouseMove);
			document.addEventListener("mouseup", onMouseUp);
		});

		const onMouseMove = (e: MouseEvent) => {
			if (!isDragging) return;
			e.preventDefault();

			lastClientX = e.clientX;
			lastClientY = e.clientY;

			// Calculate pure screen delta (movement on the screen)
			const screenDeltaX = e.clientX - startX;
			const screenDeltaY = e.clientY - startY;

			// Convert screen delta to container coordinate delta
			// Divide by zoom to account for zoom scaling
			const containerDeltaX = screenDeltaX / this.zoomLevel;
			const containerDeltaY = screenDeltaY / this.zoomLevel;

			// Calculate distance for drag threshold
			const distance = Math.sqrt(screenDeltaX * screenDeltaX + screenDeltaY * screenDeltaY);

			if (distance > 5) {
				dragOccurred = true;
			}

			if (!dragOccurred) return;

			// Move all cards in the group using stored initial positions
			const groupMembers = this.getGroupMembers(file.path);

			groupMembers.forEach((memberPath: string) => {
				const memberCard = this.transformContainer.querySelector(`[data-path="${memberPath}"]`) as HTMLElement;
				const memberPosition = this.cardPositions.get(memberPath);
				const initialPos = initialGroupPositions.get(memberPath);

				if (memberCard && memberPosition && initialPos) {
					// Apply the delta to the initial position
					memberPosition.x = initialPos.x + containerDeltaX;
					memberPosition.y = initialPos.y + containerDeltaY;
					memberCard.style.left = memberPosition.x + "px";
					memberCard.style.top = memberPosition.y + "px";
				}
			});

			// Edge highlighting during Alt+drag
			if (isEdgeAttachMode) {
				const nearest = this.findNearestEdge(card, e.clientX, e.clientY);
				
				if (nearest) {
					if (this.edgeHighlight) {
						this.edgeHighlight.className = `notes-explorer-edge-highlight ${nearest.edge}`;
						
						const cardWidth = nearest.cardWidth || 300;
						const cardHeight = nearest.cardHeight || 200;
						const targetPos = nearest.cardPos;

						switch (nearest.edge) {
							case "top":
								this.edgeHighlight.style.left = targetPos.x + "px";
								this.edgeHighlight.style.top = (targetPos.y - 2) + "px";
								this.edgeHighlight.style.width = cardWidth + "px";
								this.edgeHighlight.style.height = "4px";
								break;
							case "bottom":
								this.edgeHighlight.style.left = targetPos.x + "px";
								this.edgeHighlight.style.top = (targetPos.y + cardHeight) + "px";
								this.edgeHighlight.style.width = cardWidth + "px";
								this.edgeHighlight.style.height = "4px";
								break;
							case "left":
								this.edgeHighlight.style.left = (targetPos.x - 2) + "px";
								this.edgeHighlight.style.top = targetPos.y + "px";
								this.edgeHighlight.style.width = "4px";
								this.edgeHighlight.style.height = cardHeight + "px";
								break;
							case "right":
								this.edgeHighlight.style.left = (targetPos.x + cardWidth) + "px";
								this.edgeHighlight.style.top = targetPos.y + "px";
								this.edgeHighlight.style.width = "4px";
								this.edgeHighlight.style.height = cardHeight + "px";
								break;
						}

						this.edgeHighlight.style.display = "block";
						nearest.card.classList.add("notes-explorer-tab-highlight");
					}
				} else {
					if (this.edgeHighlight) {
						this.edgeHighlight.style.display = "none";
					}
					this.cardsContainer.querySelectorAll(".notes-explorer-tab-highlight")
						.forEach((c) => c.classList.remove("notes-explorer-tab-highlight"));
				}
			}
		};

		const onMouseUp = () => {
			if (!isDragging) return;

			isDragging = false;
			card.style.cursor = "grab";
			card.style.zIndex = "";
			card.removeClass("dragging");
			this.cardsContainer.removeClass("card-dragging");

			if (isEdgeAttachMode) {
				// Alt key is held
				if (dragOccurred) {
					// Alt + Drag = snap to nearby edge
					const nearest = this.findNearestEdge(card, lastClientX, lastClientY);
					if (nearest) {
						const targetPath = nearest.card.getAttribute('data-path');
						if (targetPath) {
							const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
							if (targetFile instanceof TFile) {
								this.snapCardToEdge(card, file, nearest.card, targetFile, nearest.edge);
							}
						}
					}
				} else {
					// ✅ FIXED: Alt + Click (no drag) = disconnect
					const connections = this.cardConnections.get(file.path);
					if (connections && connections.size > 0) {
						this.disconnectCard(file.path);
						new Notice(`Disconnected card: ${file.basename}`);
					}
				}
			}
			// If Alt NOT held, just save positions (normal drag)

			// Clean up edge highlight
			if (this.edgeHighlight) {
				this.edgeHighlight.remove();
				this.edgeHighlight = null;
			}

			this.cardsContainer
				.querySelectorAll('.notes-explorer-tab-highlight')
				.forEach((c) => c.classList.remove('notes-explorer-tab-highlight'));

			this.saveCardPositions();

			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
		};
	}

	public saveCardPositions() {
		// This is where you would persist the card positions to a file or Obsidian's data store.
		// For now, we'll just log them to the console.
		console.log('Saving card positions:', this.cardPositions);
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
		for (const [index, { file, leaf }] of openFiles.entries()) {
			if (!existingCards.has(file.path)) {
				await this.createCard(file, leaf, false, index);
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

		// Layout is preserved during card updates
		// Only sorting order is applied, not position reset
		requestAnimationFrame(() => {
			const cards = this.cardsContainer.querySelectorAll('.notes-explorer-card');
			const visible = Array.from(cards).filter(c => 
				window.getComputedStyle(c).display !== 'none' &&
				window.getComputedStyle(c).visibility !== 'hidden'
			).length;
			console.log('=== Cards Update Complete ===');
			console.log('DOM cards:', cards.length);
			console.log('Visible cards:', visible);
			console.log('Container size:', {
				width: this.transformContainer.style.width,
				height: this.transformContainer.style.height
			});
			this.app.workspace.trigger('notes-explorer:cards-count-updated', openFiles.length);
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

	async onOpen() {
		console.log('=== Cards View Opening ===');
		console.log('Window type:', this.leaf.getRoot() === (this.app.workspace as any).rootSplit ? 'main' : 'popout');
		console.log('Existing markdown leaves:', this.app.workspace.getLeavesOfType('markdown').length);
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();

		// Ensure parent container is properly sized
		container.style.padding = '0';
		container.style.margin = '0';
		container.style.height = '100%';
		container.style.width = '100%';
		container.style.display = 'block';
		container.style.position = 'relative';

		this.containerEl.addClass('cards-canvas-view');

		const canvasWrapper = container.createDiv('canvas-wrapper');
		this.canvasWrapper = canvasWrapper;

		canvasWrapper.style.width = '100%';
		canvasWrapper.style.height = '100%';
		canvasWrapper.style.overflow = 'auto';
		canvasWrapper.style.position = 'relative';
		canvasWrapper.style.display = 'block';
		canvasWrapper.style.border = '1px solid blue'; // debug

		const transformContainer = canvasWrapper.createDiv('transform-container');
		this.transformContainer = transformContainer;
		this.cardsContainer = transformContainer;

		transformContainer.style.width = '1000px';
		transformContainer.style.height = '1000px';
		transformContainer.style.position = 'relative';
		transformContainer.style.transformOrigin = '0 0';
		transformContainer.style.margin = '0';
		transformContainer.style.padding = '0';
		transformContainer.style.backgroundColor = 'rgba(0,0,0,0.02)'; // debug background

		// Call setup methods
		this.setupResizeListener();
		this.setupZoomControls();
		this.setupCanvasPanning();
		this.setupDropZone();

		// Initialize with masonry layout to prevent card overlap
		this.updateCards();
		requestAnimationFrame(() => {
			this.layoutMasonryGrid();
		});
	}
	
	async onClose() {
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
	}

	// Basic layout function to avoid missing method errors.
	// This can be expanded to implement a real masonry/grid layout.
	private layoutMasonryGrid() {
		const cards = this.cardsContainer.querySelectorAll('.notes-explorer-card') as NodeListOf<HTMLElement>;

		if (cards.length === 0) {
			this.transformContainer.style.width = '1000px';
			this.transformContainer.style.height = '1000px';
			return;
		}

		const columnCount = this.manualColumns !== null ? this.manualColumns : this.calculateAutoColumns();
		const cardWidth = 300;
		const gapX = 20;
		const gapY = 20;

		// Create array of columns to track height of each
		const columns = Array(columnCount).fill(0);
		const positions: Array<{ cardEl: HTMLElement; x: number; y: number }> = [];

		const combinedScale = this.zoomLevel * this.contentScale;

		// Place each visible card in the shortest column
		cards.forEach((cardEl) => {
			const isHidden = window.getComputedStyle(cardEl).display === 'none';

			if (!isHidden) {
				// Find column with smallest height
				let minHeight = columns[0];
				let minColumn = 0;

				for (let i = 1; i < columnCount; i++) {
					if (columns[i] < minHeight) {
						minHeight = columns[i];
						minColumn = i;
					}
				}

				// Calculate position in grid
				const x = minColumn * (cardWidth + gapX);
				const y = minHeight;

				positions.push({ cardEl, x, y });

				// Update column height
				const cardHeight = parseInt(cardEl.style.height) || 200;
				columns[minColumn] += cardHeight + gapY;
			}
		});

		// Apply positions to cards
		positions.forEach(({ cardEl, x, y }) => {
			const path = cardEl.getAttribute('data-path');
			if (path && this.cardPositions.has(path)) {
				const position = this.cardPositions.get(path);
				if (position) {
					position.x = x;
					position.y = y;
					this.cardPositions.set(path, position);
				}
			}

			cardEl.style.left = x + 'px';
			cardEl.style.top = y + 'px';
			cardEl.style.position = 'absolute';
			cardEl.style.visibility = 'visible';
			cardEl.style.display = 'block';
			cardEl.style.opacity = '1';
			cardEl.style.transform = `translate(0, 0) scale(${combinedScale})`;
			cardEl.style.transformOrigin = 'top left';
		});

		// Calculate container size based on actual layout
		let maxX = 0;
		let maxY = Math.max(...columns);

		for (let i = 0; i < columnCount; i++) {
			maxX = Math.max(maxX, (i + 1) * (cardWidth + gapX));
		}

		const paddedWidth = Math.max(maxX + 50, 1000);
		const paddedHeight = Math.max(maxY + 50, 1000);

		this.transformContainer.style.width = paddedWidth + 'px';
		this.transformContainer.style.height = paddedHeight + 'px';

		console.log('Masonry layout applied:', {
			cardsCount: cards.length,
			columnCount,
			containerWidth: paddedWidth,
			containerHeight: paddedHeight,
			zoom: this.zoomLevel,
			contentScale: this.contentScale,
			combinedScale
		});
	}

	private calculateAutoColumns(): number {
		const containerWidth = this.canvasWrapper.clientWidth || 1000;
		const cardWidth = 300;
		const gap = 20;
		const availableWidth = containerWidth / (this.zoomLevel * this.contentScale);
		const columns = Math.max(1, Math.floor(availableWidth / (cardWidth + gap)));
		return columns;
	}

	getViewType(): string {
		return VIEW_TYPE_NOTES_EXPLORER;
	}

	getDisplayText(): string {
		return 'Notes Explorer';
	}

	getIcon(): string {
		return 'layout-grid';
	}

	/**
	 * Find nearest edge of a card to given coordinates
	 * Accounts for pan/zoom transforms with zoom-adjusted threshold
	 */
	findNearestEdge(fromCard: HTMLElement, fromX: number, fromY: number, baseThreshold = 50): { card: HTMLElement, edge: string, distance: number, cardPos: CardPosition, cardWidth: number, cardHeight: number } | null {
		const fromPath = fromCard.getAttribute("data-path");
		const fromPos = fromPath ? this.cardPositions.get(fromPath) : null;
		
		if (!fromPos) return null;

		// Get the canvas/wrapper bounds
		const canvasRect = this.canvasWrapper.getBoundingClientRect();

		// Step 1: Convert screen coordinates to canvas-relative coordinates
		const screenDeltaX = fromX - canvasRect.left;
		const screenDeltaY = fromY - canvasRect.top;

		// Step 2: Reverse the transform: translate(panX, panY) scale(zoomLevel)
		// Formula: (screenCoord - panOffset) / zoomLevel + scrollOffset
		const scrollLeft = this.canvasWrapper.scrollLeft || 0;
		const scrollTop = this.canvasWrapper.scrollTop || 0;

		const containerX = (screenDeltaX - this.panX) / this.zoomLevel + scrollLeft;
		const containerY = (screenDeltaY - this.panY) / this.zoomLevel + scrollTop;

		// ✅ FIXED: Scale threshold inversely with zoom
		// At zoomLevel=1.0: threshold = 50/1.0 = 50px
		// At zoomLevel=0.5: threshold = 50/0.5 = 100px (compensates for zoom out)
		// At zoomLevel=1.5: threshold = 50/1.5 = 33px (compensates for zoom in)
		const zoomAdjustedThreshold = baseThreshold / this.zoomLevel;

		console.log("🔍 Edge Detection Debug:", {
			screenCoords: { x: Math.round(fromX), y: Math.round(fromY) },
			canvasRect: { left: Math.round(canvasRect.left), top: Math.round(canvasRect.top) },
			screenDelta: { x: Math.round(screenDeltaX), y: Math.round(screenDeltaY) },
			transform: { panX: this.panX, panY: this.panY, zoom: this.zoomLevel },
			containerCoords: { x: Math.round(containerX), y: Math.round(containerY) },
			scrollOffset: { left: scrollLeft, top: scrollTop },
			threshold: { base: baseThreshold, adjusted: Math.round(zoomAdjustedThreshold) }
		});

		const cards = Array.from(this.cardsContainer.querySelectorAll(".notes-explorer-card"))
			.filter((card) => card !== fromCard && !card.classList.contains("dragging"));

		let nearest: { card: HTMLElement, edge: string, distance: number, cardPos: CardPosition, cardWidth: number, cardHeight: number } | null = null;
		let minDistance = zoomAdjustedThreshold;

		cards.forEach((card: Element) => {
			const htmlCard = card as HTMLElement;
			const cardPath = htmlCard.getAttribute("data-path");
			const cardPos = cardPath ? this.cardPositions.get(cardPath) : null;
			
			if (!cardPos) return;

			const cardWidth = cardPos.width || 300;
			const cardHeight = cardPos.height || 200;

			// Calculate edges in CONTAINER coordinate space
			const edges = {
				top: Math.abs(containerY - cardPos.y),
				bottom: Math.abs(containerY - (cardPos.y + cardHeight)),
				left: Math.abs(containerX - cardPos.x),
				right: Math.abs(containerX - (cardPos.x + cardWidth))
			};

			// Find nearest edge
			for (const [edge, distance] of Object.entries(edges)) {
				if (distance < minDistance) {
					minDistance = distance;
					nearest = { 
						card: htmlCard, 
						edge, 
						distance, 
						cardPos,
						cardWidth,
						cardHeight
					};
				}
			}
		});

		return nearest;
	}

	/**
	 * Snap card to edge of target card
	 * Positions dragged card adjacent to the target's edge using stored positions
	 */
	snapCardToEdge(draggedCard: HTMLElement, draggedFile: TFile, targetCard: HTMLElement, targetFile: TFile, edge: string) {
	  const draggedPos = this.cardPositions.get(draggedFile.path);
	  const targetPos = this.cardPositions.get(targetFile.path);

	  if (!draggedPos || !targetPos) return;

	  // Use stored dimensions, not getBoundingClientRect()
	  const draggedWidth = draggedPos.width || 300;
	  const draggedHeight = draggedPos.height || 200;
	  const targetWidth = targetPos.width || 300;
	  const targetHeight = targetPos.height || 200;
	  
	  let newX = draggedPos.x;
	  let newY = draggedPos.y;
	  const gap = 10; // Small gap between cards

	  switch(edge) {
	    case "top":
	      // Place dragged card above target
	      newY = targetPos.y - draggedHeight - gap;
	      newX = targetPos.x; // Align left edges
	      break;
	    case "bottom":
	      // Place dragged card below target
	      newY = targetPos.y + targetHeight + gap;
	      newX = targetPos.x;
	      break;
	    case "left":
	      // Place dragged card to the left of target
	      newX = targetPos.x - draggedWidth - gap;
	      newY = targetPos.y; // Align top edges
	      break;
	    case "right":
	      // Place dragged card to the right of target
	      newX = targetPos.x + targetWidth + gap;
	      newY = targetPos.y;
	      break;
	  }

	  // Update position
	  draggedPos.x = newX;
	  draggedPos.y = newY;
	  draggedCard.style.left = newX + "px";
	  draggedCard.style.top = newY + "px";

	  // Create connection
	  this.connectCards(draggedFile.path, targetFile.path);
	  	
	  // Provide feedback
	  new Notice(`Connected: ${draggedFile.basename} to ${targetFile.basename}`);
	}

	/**
	 * Connect two cards - they will move together
	 */
	connectCards(filePath1: string, filePath2: string) {
	  // Initialize connections if needed
	  if (!this.cardConnections.has(filePath1)) {
	    this.cardConnections.set(filePath1, new Set());
	  }
	  if (!this.cardConnections.has(filePath2)) {
	    this.cardConnections.set(filePath2, new Set());
	  }

	  // Add bidirectional connections
	  const connections1 = this.cardConnections.get(filePath1);
	  const connections2 = this.cardConnections.get(filePath2);
	  	
	  if (connections1) connections1.add(filePath2);
	  if (connections2) connections2.add(filePath1);

	  // Find or create group
	  let groupId = this.getGroupId(filePath1);
	  if (!groupId) {
	    groupId = this.getGroupId(filePath2);
	  }
	  if (!groupId) {
	    groupId = `group_${this.nextGroupId++}`;
	  }

	  // Add both to group
	  if (!this.connectionGroups.has(groupId)) {
	    this.connectionGroups.set(groupId, new Set());
	  }
	  	
	  const group = this.connectionGroups.get(groupId);
	  if (group) {
	    group.add(filePath1);
	    group.add(filePath2);
	  }

	  // Update UI
	  this.updateCardConnectionUI(filePath1);
	  this.updateCardConnectionUI(filePath2);
	}

	/**
	 * Disconnect a card from all connected cards
	 */
	disconnectCard(filePath: string) {
		const connected = this.cardConnections.get(filePath);
		if (!connected) return;

		// Create a copy to iterate over, as we're modifying the set
		const connectedPaths = new Set(connected);

		connectedPaths.forEach(connectedPath => {
			const connectedSet = this.cardConnections.get(connectedPath);
			if (connectedSet) {
				connectedSet.delete(filePath);
				this.updateCardConnectionUI(connectedPath); // Update other cards
			}
		});

		this.cardConnections.delete(filePath);

		const groupId = this.getGroupId(filePath);
		if (groupId) {
			const group = this.connectionGroups.get(groupId);
			if (group) {
				group.delete(filePath);
				if (group.size <= 1) { // Groups of 1 are not groups
					this.connectionGroups.delete(groupId);
					// Update UI for the single remaining member, if any
					group.forEach(path => this.updateCardConnectionUI(path));
				}
			}
		}

		this.updateCardConnectionUI(filePath); // Update the disconnected card itself
	}

	/**
	 * Get the group ID for a card
	 */
	getGroupId(filePath: string) {
	  for (const [groupId, members] of this.connectionGroups.entries()) {
	    if (members.has(filePath)) {
	      return groupId;
	    }
	  }
	  return null;
	}

	/**
	 * Update visual appearance of connected cards
	 */
	updateCardConnectionUI(filePath: string) {
	  const card = this.transformContainer.querySelector(`[data-path="${filePath}"]`) as HTMLElement;
	  if (!card) return;

	  const connected = this.cardConnections.get(filePath);
	  const groupId = this.getGroupId(filePath);

	  if (connected && connected.size > 0) {
	    card.classList.add('connected');
	    if (groupId) {
	      card.classList.add('grouped');
	    }
	  } else {
	    card.classList.remove('connected');
	    card.classList.remove('grouped');
	  }
	}

	/**
	 * Get all cards in same group for movement
	 */
	getGroupMembers(filePath: string): string[] {
	  const groupId = this.getGroupId(filePath);
	  if (!groupId) return [filePath];

	  return Array.from(this.connectionGroups.get(groupId) || new Set());
	}
}
