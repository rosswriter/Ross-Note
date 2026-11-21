# ROX-Filer 2.12.0 (GTK 3 version)

This is Thomas Leonard's ROX-Filer moved from GTK 2 to GTK 3, so that it
builds and runs on current Debian and Ubuntu releases. GTK 2 has been
unmaintained since 2020 and Debian plans to remove it before Debian 14
("forky").

## What's new

- **GTK 3.** Builds against GTK 3.22 or later (Debian 12/13, Ubuntu 22.04
  and later). On Wayland desktops it runs through XWayland, because ROX
  uses X11 for session management, window placement and talking to an
  already-running copy of itself.
- **Side pane.** A list of places down the left of each window: Home,
  Desktop, Documents, Downloads, Music, Pictures, Videos, your ROX
  bookmarks and any drives. Click to go there; middle-click (or
  Ctrl+click) opens a new window. Drag the divider to resize it, as
  narrow as icon width or as wide as you like; the width you choose is
  remembered for new windows and next time. Show or
  hide it with **F9** or *Display → Show Side Pane*; set the default and
  starting width in *Options → Filer windows → Side pane*.
- **Terminal panel** along the bottom of the window, like Dolphin's.
  Press **F4** (or *Display → Show Terminal*) to show or hide it.
  - It follows the window: open a folder and the shell `cd`s there. It
    only does this when the shell is at its prompt, never in the middle
    of a running program; it catches up when the program finishes.
  - The window follows it: `cd` somewhere in the terminal and the window
    goes there too.
  - Drop files or folders on it to type their full paths, quoted, at the
    cursor. Nothing is run until you press Enter.
  - While the terminal has the focus, every key goes to the shell (so
    Ctrl+A, Ctrl+X, Ctrl+H and so on behave as normal there). Copy and
    paste with **Ctrl+Shift+C** / **Ctrl+Shift+V**, or right-click.
  - Drag the divider to resize it; the height is remembered. Closing a
    window asks first if a program is still running in its terminal.
  - Set whether new windows open with it, its height and its font in
    *Options → Filer windows → Terminal*.
- **Yaru-red-dark icons by default**, if the theme is installed
  (`sudo apt install yaru-theme-icon`). Otherwise ROX's own icons are used.
  Change it in *Options → Types → Icon theme*. The same theme is used for
  the toolbar, menus and side pane.
- **Wide scrollbars**: 16 pixels by default, always visible (no thin
  overlay scrollbars). Change it in *Options → Filer windows → Display →
  Scrollbar width*.
- **Bigger toolbar icons**: 32 pixels by default (24 before). Change it in
  *Options → Filer windows → Tools/Minibuffer → Toolbar icon size*.
- **Mouse wheel** scrolls both the icon view and the list view, including
  smooth scrolling from touchpads.
- **Goto bar**: `/` and **Ctrl+G** open it with the cursor at the end of
  the current path (GTK 3 would otherwise select the whole path, so typing
  replaced it).

## Living alongside Rox-Filer2

- The command is **`rox1`** and the package is **`rox-filer1`**, so it can
  be installed together with Rox-Filer2 (which has its own `rox`).
- It keeps its settings in `~/.config/rox.sourceforge.net/ROX-Filer/Options-gtk3`
  (copied from the shared `Options` file the first time), so the two
  versions no longer overwrite each other's settings.
- If a copy of ROX-Filer 1 is already running but doesn't answer (for
  example one left stuck from an earlier session), `rox1` now waits 3
  seconds and then opens its own window, instead of giving up with
  "Existing ROX-Filer process is not responding! Try with -n".

## Removed

The **pinboard** (icons on the desktop background) and the **panels**
(icon bars along the screen edges) are not included. Their command-line
options (`-p`, `-b`, `-t`, `-B`, `-l`, `-r`, `-S`) are accepted but
ignored, so existing session scripts still start the filer.

## Fixes to bugs in the original

- File type descriptions (Properties box, list view) showed in a random
  language, such as Chinese, with newer shared-mime-info. They now use your
  language, or English.
- The fast `mime.cache` file is now used for type detection.

## Building and installing

Install the build tools (Debian 13 / Ubuntu 24.04 or later):

    sudo apt install build-essential pkg-config autoconf gettext dpkg-dev \
        libgtk-3-dev libvte-2.91-dev libxml2-dev libsm-dev libice-dev \
        libx11-dev shared-mime-info yaru-theme-icon xsltproc docbook-xsl

Then either:

- **Make a .deb package** for this machine (AMD64, ARM64, ...):

      ./build-deb.sh
      sudo apt install ./output/rox-filer1_2.12.0-1_*.deb

  This installs to `/usr/lib/rox1/ROX-Filer` with a `rox1` command and a
  "ROX-Filer 1" menu entry.

- **Or run it in place**, the traditional ROX way:

      ./ROX-Filer/AppRun --compile
      ./ROX-Filer/AppRun

### Packages for both AMD64 and ARM64 on GitHub

`.github/workflows/build-debs.yml` builds Debian 13 packages for AMD64 and
ARM64 on GitHub's own machines. Push this project to a GitHub repository,
open the **Actions** tab, choose **Build Debian 13 packages** and click
**Run workflow**. The two `.deb` files appear under **Artifacts** on the
run's page.

## For developers

- `src/gtk3compat.h` maps the GTK 2 idioms used throughout the code onto
  GTK 3, so most of the original source is unchanged.
- `src/itemfactory.c` is a small replacement for GTK 2's GtkItemFactory,
  which built all of ROX's menus. Menu paths and saved key bindings are
  unchanged.
- Drawing in the icon view (`collection.c`, `view_collection.c`,
  `display.c`) and list view (`view_details.c`, `cell_icon.c`) now uses
  cairo.
- `src/sidepane.c` is the side pane, `src/terminal.c` the terminal
  panel (using VTE); `src/nodesktop.c` holds the
  stand-ins for the removed pinboard and panels.
