# Features Overview

## Architecture

```
┌─────────────────────────────────────────────┐
│         Obsidian Workspace                  │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐      │
│  │ Tab1 │ │ Tab2 │ │ Tab3 │ │ Tab4 │      │
│  └──────┘ └──────┘ └──────┘ └──────┘      │
│         ↓ monitors ↓                        │
│  ┌─────────────────────────────────────┐   │
│  │    Notes Explorer Sidebar           │   │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐  │   │
│  │  │Card1│ │Card2│ │Card3│ │Card4│  │   │
│  │  │  ×  │ │  ×  │ │  ×  │ │  ×  │  │   │
│  │  └─────┘ └─────┘ └─────┘ └─────┘  │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## Feature Details

### 1. Live Synchronization
```
Open Tab ────────> Card Appears
Close Tab ───────> Card Disappears  
Switch Tab ──────> Card Highlighted
```

**How it works:**
- Monitors workspace events: `active-leaf-change`, `file-open`, `layout-change`
- Debounced updates (100ms) for performance
- Only shows markdown files currently open in tabs

### 2. Card Interaction
```
┌──────────────────────┐
│ Note Title        × │  ← Close button
├──────────────────────┤
│ Preview text here... │  ← Content preview
│ Lorem ipsum dolor... │
│ sit amet...          │
└──────────────────────┘
     ↓ Click
Activates corresponding tab
```

**Actions:**
- **Click card** → Activates & focuses the tab
- **Click ×** → Closes the tab
- **Drag card** → Reorders cards visually

### 3. Drag and Drop to Reorder
```
Before:
┌─────┐ ┌─────┐ ┌─────┐
│ A   │ │ B   │ │ C   │
└─────┘ └─────┘ └─────┘

Drag B to the left:
┌─────┐ ┌─────┐ ┌─────┐
│ B   │ │ A   │ │ C   │
└─────┘ └─────┘ └─────┘
```

**Visual Feedback:**
- Dragging: Card becomes semi-transparent
- Drop target: Dashed border appears
- Release: Cards reorder smoothly

### 4. Drop Files to Open
```
File Explorer          Notes Explorer
┌──────────┐          ┌──────────────┐
│ 📄 Note1 │───drag──>│ Drop Zone    │
│ 📄 Note2 │          │              │
│ 📄 Note3 │          │ ┌────┐ ┌────┐│
└──────────┘          │ │Card│ │Card││
                      └──────────────┘
                            ↓
                      Opens in background tab
```

**Behavior:**
- Drag from Obsidian file explorer
- Drop anywhere in Notes Explorer
- File opens as new tab (not focused)
- Notification confirms the action

### 5. Visual States

**Normal Card:**
```
┌──────────────────────┐
│ My Note          ×   │
├──────────────────────┤
│ Content preview...   │
└──────────────────────┘
```

**Active Card (highlighted):**
```
╔══════════════════════╗
║ My Note          ×   ║  ← Blue accent border
╠══════════════════════╣
║ Content preview...   ║
╚══════════════════════╝
```

**Hovering:**
```
┌──────────────────────┐
│ My Note          ×   │  ← Slightly elevated
├──────────────────────┤  ← Shadow deepens
│ Content preview...   │
└──────────────────────┘
```

**Dragging:**
```
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐
│ My Note          ×  │  ← Semi-transparent
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤
│ Content preview...  │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘
```

## Responsive Layout

Cards use flexbox to adapt to different sidebar widths:

**Wide Sidebar:**
```
┌─────┐ ┌─────┐ ┌─────┐
│Card1│ │Card2│ │Card3│
└─────┘ └─────┘ └─────┘
┌─────┐ ┌─────┐
│Card4│ │Card5│
└─────┘ └─────┘
```

**Narrow Sidebar:**
```
┌─────┐
│Card1│
└─────┘
┌─────┐
│Card2│
└─────┘
┌─────┐
│Card3│
└─────┘
```

## Event Flow

```
User Action
    ↓
Event Listener (click, drag, drop)
    ↓
Update Function
    ↓
Re-render Cards
    ↓
Apply Active State
    ↓
Visual Feedback
```

## Performance Optimizations

1. **Debounced Updates**: 100ms delay prevents excessive re-renders
2. **Efficient DOM Updates**: Only affected cards are updated
3. **Event Delegation**: Minimal event listeners
4. **CSS Transitions**: Hardware-accelerated animations
5. **Lazy Preview Loading**: File content loaded asynchronously

## Theme Integration

The plugin uses Obsidian CSS variables for seamless theme integration:

- `--background-primary`: Card background
- `--background-secondary`: Hover/drag states
- `--background-modifier-border`: Card borders
- `--text-normal`: Card titles
- `--text-muted`: Card previews
- `--interactive-accent`: Active card highlight
- `--text-error`: Close button hover
