import { App, ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import NotesExplorerPlugin, { NotesExplorerView } from './main';

export const VIEW_TYPE_NOTES_EXPLORER_MENU = "notes-explorer-menu-view";

export class NotesExplorerMenuView extends ItemView {
    plugin: NotesExplorerPlugin;
    private menuContainer: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: NotesExplorerPlugin) {
        super(leaf);
        this.plugin = plugin;

        // Listen for cards view creation
        this.registerEvent(
            this.app.workspace.on('notes-explorer:view-state-changed', () => {
                this.drawUI();
            })
        );

        this.registerEvent(
            this.app.workspace.on('notes-explorer:zoom-changed', (newZoom: number) => {
                const zoomDisplay = this.menuContainer.querySelector('.notes-explorer-zoom-display');
                if (zoomDisplay) {
                    zoomDisplay.setText(`${Math.round(newZoom * 100)}%`);
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on("notes-explorer:hidden-cards-updated", () => {
                this.updateHiddenFilesCount();
            })
        );

    }

    getViewType(): string {
        return VIEW_TYPE_NOTES_EXPLORER_MENU;
    }

    getDisplayText(): string {
        return "Cards Menu";
    }

    getIcon(): string {
        return "menu";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('notes-explorer-menu-view');
        this.menuContainer = container.createDiv({ cls: 'notes-explorer-menu-container' });

        this.drawUI();
    }

    private drawUI() {
        this.menuContainer.empty();

        const view = this.plugin.getNotesExplorerView();

        if (view) {
            this.createToolbarControls(this.menuContainer);

            // Create or update the card count display
            const total = view.stableCardOrder.size;
            this.menuContainer.createDiv({
                cls: 'notes-explorer-total-count',
                text: `Total cards: ${total}`
            });
        } else {
            this.createMissingViewMessage(this.menuContainer);
        }
    }

    private createToolbarControls(container: HTMLElement) {
        const view = this.plugin.getNotesExplorerView();
        if (!view) return;

        this.createScaleControl(container, view);
        this.createColumnControl(container, view);
        this.createZoomControl(container, view);
        this.createLayoutResetControl(container, view);
        this.createSortAndSearchControl(container, view);
        this.createHiddenCardsControl(container, view);
        this.createLoadAllTabsControl(container, view);
    }

    private createScaleControl(toolbar: HTMLElement, view: NotesExplorerView) {
		const scaleContainer = toolbar.createDiv({ cls: 'notes-explorer-scale-control' });
		scaleContainer.createEl('label', { text: 'Card Scale: ', cls: 'notes-explorer-scale-label' });
		const slider = scaleContainer.createEl('input', { cls: 'notes-explorer-scale-slider', type: 'range' });
		slider.min = '0.5';
		slider.max = '1.0';
		slider.step = '0.1';
		slider.value = view.contentScale.toString();
		const valueDisplay = scaleContainer.createEl('span', {
			text: `${Math.round(view.contentScale * 100)}%`,
			cls: 'notes-explorer-scale-value'
		});
		slider.addEventListener('input', (e: Event) => {
			const target = e.target as HTMLInputElement;
			const newScale = parseFloat(target.value);
			valueDisplay.setText(`${Math.round(newScale * 100)}%`);
			this.app.workspace.trigger('notes-explorer:set-scale', newScale);
		});
		const resetBtn = scaleContainer.createEl('button', { text: 'Reset', cls: 'notes-explorer-scale-reset' });
		resetBtn.addEventListener('click', () => {
			slider.value = '1.0';
			valueDisplay.setText('100%');
			this.app.workspace.trigger('notes-explorer:set-scale', 1.0);
		});
	}

	private createColumnControl(toolbar: HTMLElement, view: NotesExplorerView) {
		const columnContainer = toolbar.createDiv({ cls: 'notes-explorer-column-control' });
		columnContainer.createEl('label', { text: 'Columns: ', cls: 'notes-explorer-column-label' });
		const autoCheckbox = columnContainer.createEl('input', { type: 'checkbox', cls: 'notes-explorer-column-auto' });
		autoCheckbox.checked = view.manualColumns === null;
		autoCheckbox.id = 'column-auto';
		const autoLabel = columnContainer.createEl('label', { text: 'Auto', cls: 'notes-explorer-column-auto-label' });
		autoLabel.setAttribute('for', 'column-auto');
		const columnInput = columnContainer.createEl('input', { type: 'number', cls: 'notes-explorer-column-input' });
		columnInput.min = '1';
		columnInput.max = '20';
		columnInput.value = view.manualColumns ? view.manualColumns.toString() : '3';
		columnInput.disabled = view.manualColumns === null;
		autoCheckbox.addEventListener('change', () => {
			if (autoCheckbox.checked) {
				columnInput.disabled = true;
				this.app.workspace.trigger('notes-explorer:set-columns', null);
			} else {
				columnInput.disabled = false;
				this.app.workspace.trigger('notes-explorer:set-columns', parseInt(columnInput.value));
			}
		});
		columnInput.addEventListener('input', () => {
			const value = parseInt(columnInput.value);
			if (value > 0 && value <= 20) {
				this.app.workspace.trigger('notes-explorer:set-columns', value);
			}
		});
	}

	private createZoomControl(toolbar: HTMLElement, view: NotesExplorerView) {
		const zoomContainer = toolbar.createDiv({ cls: 'notes-explorer-zoom-control' });
		const zoomOutBtn = zoomContainer.createEl('button', { cls: 'notes-explorer-zoom-btn', title: 'Zoom Out' });
		zoomOutBtn.innerHTML = '−';
		const zoomDisplay = zoomContainer.createEl('span', { text: '100%', cls: 'notes-explorer-zoom-display' });
		const zoomInBtn = zoomContainer.createEl('button', { cls: 'notes-explorer-zoom-btn', title: 'Zoom In' });
		zoomInBtn.innerHTML = '+';
		const zoomResetBtn = zoomContainer.createEl('button', { text: 'Reset', cls: 'notes-explorer-zoom-reset', title: 'Reset Zoom to 100%' });

		const updateZoom = (newZoom: number) => {
			zoomDisplay.setText(`${Math.round(newZoom * 100)}%`);
			this.app.workspace.trigger('notes-explorer:set-zoom', newZoom);
		};

		zoomOutBtn.addEventListener('click', () => {
			let newZoom = Math.max(view.minZoom, view.zoomLevel - view.zoomStep);
			newZoom = Math.round(newZoom * 10) / 10;
			updateZoom(newZoom);
		});

		zoomInBtn.addEventListener('click', () => {
			let newZoom = Math.min(view.maxZoom, view.zoomLevel + view.zoomStep);
			newZoom = Math.round(newZoom * 10) / 10;
			updateZoom(newZoom);
		});

		zoomResetBtn.addEventListener('click', () => {
			updateZoom(1.0);
		});
	}

	private createLayoutResetControl(toolbar: HTMLElement, view: NotesExplorerView) {
		const resetContainer = toolbar.createDiv({ cls: 'notes-explorer-layout-control' });
		const resetBtn = resetContainer.createEl('button', {
			text: 'Reset Layout',
			cls: 'notes-explorer-layout-reset',
			title: 'Reset to masonry layout'
		});
		resetBtn.addEventListener('click', () => {
			new Notice('Layout reset to masonry');
			this.app.workspace.trigger('notes-explorer:reset-layout');
		});
	}

	private createSortAndSearchControl(toolbar: HTMLElement, view: NotesExplorerView) {
		const controlContainer = toolbar.createDiv({ cls: 'notes-explorer-sort-search-control' });
		controlContainer.createEl('label', { text: 'Sort: ', cls: 'notes-explorer-sort-label' });
		const sortSelect = controlContainer.createEl('select', { cls: 'notes-explorer-sort-select' });
		const sortOptions = [
			{ value: 'manual', label: 'Manual Order' },
			{ value: 'name-asc', label: 'Name (A-Z)' },
			{ value: 'name-desc', label: 'Name (Z-A)' },
			{ value: 'size-asc', label: 'Size (Small to Large)' },
			{ value: 'size-desc', label: 'Size (Large to Small)' },
			{ value: 'modified', label: 'Recently Modified' }
		];
		sortOptions.forEach(opt => {
			const option = sortSelect.createEl('option', { value: opt.value, text: opt.label });
			if (opt.value === view.sortMethod) {
				option.selected = true;
			}
		});
		sortSelect.addEventListener('change', () => {
			this.app.workspace.trigger('notes-explorer:set-sort', sortSelect.value);
		});

		controlContainer.createEl('label', { text: 'Search: ', cls: 'notes-explorer-search-label' });
		const searchInput = controlContainer.createEl('input', { type: 'text', cls: 'notes-explorer-search-input', placeholder: 'Filter cards...' });
		searchInput.value = view.searchQuery;
		searchInput.addEventListener('input', () => {
			this.app.workspace.trigger('notes-explorer:set-search', searchInput.value);
		});

		const clearBtn = controlContainer.createEl('button', { text: '×', cls: 'notes-explorer-search-clear', title: 'Clear search' });
		clearBtn.addEventListener('click', () => {
			searchInput.value = '';
			this.app.workspace.trigger('notes-explorer:set-search', '');
		});
	}

	private createHiddenCardsControl(toolbar: HTMLElement, view: NotesExplorerView) {
		const hiddenContainer = toolbar.createDiv({ cls: 'notes-explorer-hidden-control' });
		const hiddenBtn = hiddenContainer.createEl('button', {
			text: `Hidden (${view.hiddenCards.size})`,
			cls: 'notes-explorer-hidden-btn'
		});
		hiddenBtn.addEventListener('click', () => {
			this.app.workspace.trigger('notes-explorer:show-hidden-modal');
		});
	}

	private createLoadAllTabsControl(toolbar: HTMLElement, view: NotesExplorerView) {
		const loadAllContainer = toolbar.createDiv({ cls: 'notes-explorer-load-all-control' });
		const loadAllBtn = loadAllContainer.createEl('button', {
			text: 'Load All Tabs',
			cls: 'notes-explorer-load-all-btn',
			title: 'Force load all open tabs as cards'
		});
		loadAllBtn.addEventListener('click', () => {
			this.app.workspace.trigger('notes-explorer:load-all-tabs');
		});
	}

    private createMissingViewMessage(container: HTMLElement) {
        const messageContainer = container.createDiv({ cls: 'missing-view-message' });
        messageContainer.createEl('p', { text: 'Cards view is not open.' });
        const createBtn = messageContainer.createEl('button', { text: 'Create View' });
        createBtn.addEventListener("click", () => {
            this.plugin.activateView();
            // The activateView method now triggers the event, so the menu will auto-refresh
        });
    }

    public updateView() {
        this.drawUI();
    }

    updateHiddenFilesCount() {
        const view = this.plugin.getNotesExplorerView();
        if (view) {
            const hiddenBtn = this.menuContainer.querySelector('.notes-explorer-hidden-btn');
            if (hiddenBtn) {
                hiddenBtn.setText(`Hidden (${view.hiddenCards.size})`);
            }
        }
    }
}
