# Notes Explorer - Obsidian Plugin

An Obsidian plugin that provides a card-based view of your currently open notes with advanced management features.

## Features

### 📋 View Open Notes as Cards
- **Card View**: All notes currently open in tabs are displayed as interactive cards
- **Visual Preview**: Each card shows the note title and a preview of its content
- **Active Tab Highlight**: The card for the currently active note is visually highlighted

### 🖱️ Click to Navigate
- **Tab Activation**: Click on any card to switch to and highlight its corresponding tab
- **Instant Focus**: Automatically brings the selected note into focus in the editor

### 🔄 Drag and Drop Reordering
- **Visual Reordering**: Drag cards to reorder them in the card view
- **Smooth Interaction**: Visual feedback shows where the card will be dropped
- **Intuitive**: Reorder your cards to match your workflow

### 📂 Drop Files to Open
- **Quick Open**: Drag files from Obsidian's file explorer and drop them into the Notes Explorer
- **Background Opening**: Dropped files open as new tabs in the background
- **Non-intrusive**: Continue working while new notes open

### ❌ Close Notes from Cards
- **Close Button**: Each card has a close button (×) in the top-right corner
- **Quick Cleanup**: Close notes directly from the card view without switching tabs
- **Confirmation**: Visual feedback when notes are closed

## Installation

### Manual Installation
1. Download the latest release files (`main.js`, `manifest.json`, `styles.css`)
2. Create a folder named `obsidian-notes-explorer` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into the folder
4. Reload Obsidian
5. Enable "Notes Explorer" in Settings → Community Plugins

### From Source
```bash
git clone https://github.com/aikruger/cards-view-of-open-notes.git
cd cards-view-of-open-notes
npm install
npm run build
```

## Usage

1. **Open the View**: Click the grid icon in the ribbon or use the command palette (Ctrl/Cmd+P) and search for "Open Notes Explorer"
2. **View Your Open Notes**: The sidebar will display cards for all currently open notes
3. **Interact with Cards**:
   - Click a card to switch to that note
   - Drag cards to reorder them
   - Click the × button to close a note
   - Drag files from the file explorer into the view to open them

## Development

### Build
```bash
npm run build
```

### Development Mode (with auto-rebuild)
```bash
npm run dev
```

## Requirements
- Obsidian v0.15.0 or higher

## License
MIT

## Author
aikruger

## Support
If you encounter any issues or have suggestions, please open an issue on GitHub.
