import 'obsidian';

declare module 'obsidian' {
  interface Workspace {
    on(name: 'notes-explorer:set-zoom', callback: (newZoom: number) => void): EventRef;
    on(name: 'notes-explorer:set-scale', callback: (newScale: number) => void): EventRef;
    on(name: 'notes-explorer:set-columns', callback: (newColumns: number | null) => void): EventRef;
    on(name: 'notes-explorer:set-sort', callback: (newSort: string) => void): EventRef;
    on(name: 'notes-explorer:set-search', callback: (newSearch: string) => void): EventRef;
    on(name: 'notes-explorer:reload', callback: () => void): EventRef;
    on(name: 'notes-explorer:reset-layout', callback: () => void): EventRef;
    on(name: 'notes-explorer:hidden-cards-updated', callback: (count: number) => void): EventRef;
    on(name: 'notes-explorer:show-hidden-modal', callback: () => void): EventRef;
    on(name: 'notes-explorer:load-all-tabs', callback: () => void): EventRef;
    on(name: 'notes-explorer:view-state-changed', callback: () => void): EventRef;
    on(name: 'notes-explorer:zoom-changed', callback: (newZoom: number) => void): EventRef;

    trigger(name: 'notes-explorer:set-zoom', data: number): void;
    trigger(name: 'notes-explorer:set-scale', data: number): void;
    trigger(name: 'notes-explorer:set-columns', data: number | null): void;
    trigger(name: 'notes-explorer:set-sort', data: string): void;
    trigger(name: 'notes-explorer:set-search', data: string): void;
    trigger(name: 'notes-explorer:reload'): void;
    trigger(name: 'notes-explorer:reset-layout'): void;
    trigger(name: 'notes-explorer:hidden-cards-updated', data: number): void;
    trigger(name: 'notes-explorer:show-hidden-modal'): void;
    trigger(name: 'notes-explorer:load-all-tabs'): void;
    trigger(name: 'notes-explorer:view-state-changed'): void;
    trigger(name: 'notes-explorer:zoom-changed', data: number): void;
  }
}
