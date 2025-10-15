import { App, ItemView, Plugin, TFile, WorkspaceLeaf, Notice } from 'obsidian';

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

		// Open the view on startup if it was open before
		this.app.workspace.onLayoutReady(() => {
			this.activateView();
		});
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_NOTES_EXPLORER);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			// Our view could not be found in the workspace, create a new leaf
			// in the right sidebar for it
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_NOTES_EXPLORER, active: true });
		}

		// Reveal the leaf in case it is in a collapsed sidebar
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}
}

class NotesExplorerView extends ItemView {
	private cardsContainer: HTMLElement;
	private draggedCard: HTMLElement | null = null;
	private draggedFile: TFile | null = null;
	private updateDebounceTimer: number | null = null;

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

		this.cardsContainer = container.createDiv({ cls: 'notes-explorer-cards-container' });

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
		
		container.addEventListener('dragover', (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'copy';
			}
		});

		container.addEventListener('drop', async (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			
			if (e.dataTransfer) {
				const files = e.dataTransfer.files;
				const data = e.dataTransfer.getData('text/plain');
				
				// Handle external file drops
				if (files.length > 0) {
					new Notice('External file drops are not supported. Please drag files from the file explorer.');
					return;
				}
				
				// Handle internal file drops (from Obsidian file explorer)
				if (data) {
					const file = this.app.vault.getAbstractFileByPath(data);
					if (file instanceof TFile) {
						// Open the file in a new tab in the background
						const leaf = this.app.workspace.getLeaf('tab');
						await leaf.openFile(file, { active: false });
						new Notice(`Opened ${file.name} in background`);
						this.updateCards();
					}
				}
			}
		});
	}

	private async updateCards() {
		this.cardsContainer.empty();

		// Get all open files from all leaves
		const openFiles = this.getOpenFiles();

		if (openFiles.length === 0) {
			const emptyDiv = this.cardsContainer.createDiv({ cls: 'notes-explorer-empty' });
			emptyDiv.setText('No notes are currently open. Open some notes to see them here.');
			return;
		}

		// Create a card for each open file
		for (const fileInfo of openFiles) {
			this.createCard(fileInfo.file, fileInfo.leaf);
		}
	}

	private getOpenFiles(): Array<{ file: TFile, leaf: WorkspaceLeaf }> {
		const openFiles: Array<{ file: TFile, leaf: WorkspaceLeaf }> = [];
		const seenPaths = new Set<string>();

		// Get all leaves in the workspace
		const leaves = this.app.workspace.getLeavesOfType('markdown');

		for (const leaf of leaves) {
			const file = (leaf.view as any).file;
			if (file instanceof TFile && !seenPaths.has(file.path)) {
				seenPaths.add(file.path);
				openFiles.push({ file, leaf });
			}
		}

		return openFiles;
	}

	private createCard(file: TFile, leaf: WorkspaceLeaf) {
		const card = this.cardsContainer.createDiv({ cls: 'notes-explorer-card' });
		card.setAttribute('data-path', file.path);
		card.draggable = true;

		// Check if this is the active file
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && activeFile.path === file.path) {
			card.addClass('active');
		}

		// Card header with title and close button
		const header = card.createDiv({ cls: 'notes-explorer-card-header' });
		
		const title = header.createDiv({ cls: 'notes-explorer-card-title' });
		title.setText(file.basename);

		const closeBtn = header.createEl('button', { cls: 'notes-explorer-card-close' });
		closeBtn.innerHTML = '×';
		closeBtn.setAttribute('aria-label', 'Close note');
		
		closeBtn.addEventListener('click', async (e) => {
			e.stopPropagation();
			// Close the leaf
			leaf.detach();
			new Notice(`Closed ${file.name}`);
			this.updateCards();
		});

		// Card content - show file preview
		const content = card.createDiv({ cls: 'notes-explorer-card-content' });
		this.loadFilePreview(file, content);

		// Click to activate/highlight the tab
		card.addEventListener('click', () => {
			this.app.workspace.setActiveLeaf(leaf, { focus: true });
		});

		// Drag and drop handlers
		this.setupCardDragAndDrop(card, file);
	}

	private async loadFilePreview(file: TFile, contentEl: HTMLElement) {
		try {
			const content = await this.app.vault.cachedRead(file);
			// Get first few lines as preview, remove markdown syntax
			const preview = content
				.split('\n')
				.filter(line => line.trim().length > 0)
				.slice(0, 3)
				.join(' ')
				.replace(/[#*_\[\]()]/g, '')
				.substring(0, 150);
			
			contentEl.setText(preview || 'Empty note');
		} catch (error) {
			contentEl.setText('Unable to load preview');
		}
	}

	private setupCardDragAndDrop(card: HTMLElement, file: TFile) {
		card.addEventListener('dragstart', (e: DragEvent) => {
			this.draggedCard = card;
			this.draggedFile = file;
			card.addClass('dragging');
			
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = 'move';
				e.dataTransfer.setData('text/plain', file.path);
			}
		});

		card.addEventListener('dragend', () => {
			card.removeClass('dragging');
			this.draggedCard = null;
			this.draggedFile = null;
			
			// Remove all drag-over classes
			const allCards = this.cardsContainer.querySelectorAll('.notes-explorer-card');
			allCards.forEach(c => c.removeClass('drag-over'));
		});

		card.addEventListener('dragover', (e: DragEvent) => {
			e.preventDefault();
			
			if (this.draggedCard && this.draggedCard !== card) {
				card.addClass('drag-over');
			}
		});

		card.addEventListener('dragleave', () => {
			card.removeClass('drag-over');
		});

		card.addEventListener('drop', (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			card.removeClass('drag-over');
			
			if (this.draggedCard && this.draggedCard !== card) {
				// Reorder the cards in the DOM
				const draggedIndex = Array.from(this.cardsContainer.children).indexOf(this.draggedCard);
				const targetIndex = Array.from(this.cardsContainer.children).indexOf(card);
				
				if (draggedIndex < targetIndex) {
					card.after(this.draggedCard);
				} else {
					card.before(this.draggedCard);
				}
			}
		});
	}

	async onClose() {
		// Clean up
		if (this.updateDebounceTimer !== null) {
			window.clearTimeout(this.updateDebounceTimer);
		}
	}
}
