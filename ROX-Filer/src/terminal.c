/*
 * ROX-Filer, filer for the ROX desktop project
 *
 * The terminal panel: a shell running along the bottom of a filer window
 * (like Dolphin's F4 terminal).
 *
 * - F4, or Display -> Show Terminal, shows or hides it.
 * - The terminal follows the filer: open a folder and the shell cd's
 *   there (only when the shell is waiting at its prompt, so a running
 *   program is never interrupted).
 * - The filer follows the terminal: cd somewhere in the shell and the
 *   window moves there too.
 * - Drop files on it to type their (quoted) paths at the cursor.
 * - While it has the focus, every key goes to the terminal, so shell keys
 *   such as Ctrl+A, Ctrl+X and Ctrl+H aren't taken by ROX's menus.
 *   Ctrl+Shift+C / Ctrl+Shift+V copy and paste.
 * - Drag the divider to resize it; the height is remembered.
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation; either version 2 of the License, or (at your option)
 * any later version.
 */

#include "config.h"

#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <vte/vte.h>

#include "global.h"

#include "options.h"
#include "filer.h"
#include "gui_support.h"
#include "terminal.h"

#define MIN_HEIGHT 60

Option o_filer_terminal;
Option o_filer_terminal_height;
Option o_terminal_font;

typedef struct {
	FilerWindow	*filer_window;
	GtkWidget	*paned;
	GtkWidget	*box;		/* Holds the terminal and its scrollbar */
	GtkWidget	*vte;		/* NULL until first shown */
	GPid		pid;		/* The shell; 0 if not running */
	guint		poll;		/* Timeout watching the shell's folder */
	gchar		*last_cwd;	/* Shell's folder when last checked */
	gint64		ignore_until;	/* Waiting for our own cd to happen */
	gboolean	follow_pending;	/* Filer moved while shell was busy */
} Terminal;

static void terminal_options_changed(void);

void terminal_init(void)
{
	option_add_int(&o_filer_terminal, "filer_terminal", FALSE);
	option_add_int(&o_filer_terminal_height, "filer_terminal_height", 200);
	option_add_string(&o_terminal_font, "terminal_font", "Monospace 11");
	option_add_notify(terminal_options_changed);
}

static Terminal *get_terminal(FilerWindow *filer_window)
{
	if (!filer_window || !filer_window->window)
		return NULL;
	return g_object_get_data(G_OBJECT(filer_window->window),
				 "rox-terminal");
}

static void set_font(Terminal *term)
{
	PangoFontDescription *font;

	font = pango_font_description_from_string(o_terminal_font.value);
	vte_terminal_set_font(VTE_TERMINAL(term->vte), font);
	pango_font_description_free(font);
}

static void terminal_options_changed(void)
{
	GList *next;

	if (!o_terminal_font.has_changed)
		return;

	for (next = all_filer_windows; next; next = next->next)
	{
		Terminal *term = get_terminal(next->data);
		if (term && term->vte)
			set_font(term);
	}
}

/* Is the shell waiting at its prompt (not running a program)? */
static gboolean shell_is_idle(Terminal *term)
{
	VtePty *pty;
	int fd;

	if (!term->vte || !term->pid)
		return FALSE;
	pty = vte_terminal_get_pty(VTE_TERMINAL(term->vte));
	if (!pty)
		return FALSE;
	fd = vte_pty_get_fd(pty);
	return fd >= 0 && tcgetpgrp(fd) == term->pid;
}

/* The shell's current folder, or NULL */
static gchar *shell_cwd(Terminal *term)
{
	gchar *link, *cwd;

	if (!term->pid)
		return NULL;
	link = g_strdup_printf("/proc/%d/cwd", (int) term->pid);
	cwd = g_file_read_link(link, NULL);
	g_free(link);
	return cwd;
}

/* Every so often, see whether the shell has changed folder; if so, take the
 * filer window there too. */
static gboolean poll_cwd(gpointer data)
{
	Terminal *term = data;
	FilerWindow *filer_window = term->filer_window;
	gchar *cwd;

	if (!term->pid || !shell_is_idle(term))
		return G_SOURCE_CONTINUE;

	/* The window moved while a program was running; now the shell is
	 * free again, take it to the window's folder. */
	if (term->follow_pending)
	{
		term->follow_pending = FALSE;
		terminal_follow_filer(filer_window);
		return G_SOURCE_CONTINUE;
	}

	cwd = shell_cwd(term);
	if (!cwd)
		return G_SOURCE_CONTINUE;

	if (term->last_cwd && strcmp(cwd, term->last_cwd) == 0)
	{
		term->ignore_until = 0;
		g_free(cwd);
		return G_SOURCE_CONTINUE;
	}

	/* We've just asked the shell to cd; wait for it to get there
	 * rather than dragging the filer back to the old folder. */
	if (term->ignore_until && g_get_monotonic_time() < term->ignore_until)
	{
		g_free(cwd);
		return G_SOURCE_CONTINUE;
	}
	term->ignore_until = 0;

	g_free(term->last_cwd);
	term->last_cwd = cwd;

	if (filer_window->real_path &&
	    strcmp(cwd, filer_window->real_path) != 0 &&
	    g_file_test(cwd, G_FILE_TEST_IS_DIR))
		filer_change_to(filer_window, cwd, NULL);

	return G_SOURCE_CONTINUE;
}

static void spawned(VteTerminal *vte, GPid pid, GError *error, gpointer data)
{
	Terminal *term = data;

	if (error)
	{
		delayed_error(_("Couldn't start the shell: %s"),
			      error->message);
		return;
	}
	term->pid = pid;
	g_free(term->last_cwd);
	term->last_cwd = shell_cwd(term);
}

static void destroy_vte(Terminal *term)
{
	if (term->poll)
	{
		g_source_remove(term->poll);
		term->poll = 0;
	}
	term->pid = 0;
	if (term->vte)
	{
		GList *kids, *next;

		kids = gtk_container_get_children(GTK_CONTAINER(term->box));
		for (next = kids; next; next = next->next)
			gtk_widget_destroy(next->data);
		g_list_free(kids);
		term->vte = NULL;
	}
}

/* The shell exited (e.g. the user typed 'exit'): hide the panel. Showing it
 * again starts a new shell. */
static void child_exited(VteTerminal *vte, gint status, Terminal *term)
{
	term->pid = 0;
	terminal_set_visible(term->filer_window, FALSE);
	destroy_vte(term);
}

/* Files dropped on the terminal: type their paths at the cursor */
static void drag_data_received(GtkWidget *widget, GdkDragContext *context,
			       gint x, gint y, GtkSelectionData *data,
			       guint info, guint time, Terminal *term)
{
	gchar **uris;
	GString *text;
	int i;

	uris = gtk_selection_data_get_uris(data);
	if (!uris)
		return;

	text = g_string_new(NULL);
	for (i = 0; uris[i]; i++)
	{
		gchar *path, *quoted;

		path = g_filename_from_uri(uris[i], NULL, NULL);
		if (!path)
			continue;
		quoted = g_shell_quote(path);
		g_string_append(text, quoted);
		g_string_append_c(text, ' ');
		g_free(quoted);
		g_free(path);
	}
	g_strfreev(uris);

	if (text->len)
	{
		vte_terminal_feed_child(VTE_TERMINAL(term->vte),
					text->str, text->len);
		gtk_widget_grab_focus(term->vte);
	}
	g_string_free(text, TRUE);
}

static void copy_cb(GtkWidget *item, Terminal *term)
{
	vte_terminal_copy_clipboard_format(VTE_TERMINAL(term->vte),
					   VTE_FORMAT_TEXT);
}

static void paste_cb(GtkWidget *item, Terminal *term)
{
	vte_terminal_paste_clipboard(VTE_TERMINAL(term->vte));
}

static void open_here_cb(GtkWidget *item, Terminal *term)
{
	terminal_follow_filer(term->filer_window);
}

/* Right-click menu: Copy / Paste */
static gboolean button_press(GtkWidget *widget, GdkEventButton *event,
			     Terminal *term)
{
	GtkWidget *menu, *item;

	if (event->type != GDK_BUTTON_PRESS || event->button != 3)
		return FALSE;

	menu = gtk_menu_new();

	item = gtk_menu_item_new_with_label(_("Copy"));
	gtk_widget_set_sensitive(item,
		vte_terminal_get_has_selection(VTE_TERMINAL(term->vte)));
	g_signal_connect(item, "activate", G_CALLBACK(copy_cb), term);
	gtk_menu_shell_append(GTK_MENU_SHELL(menu), item);

	item = gtk_menu_item_new_with_label(_("Paste"));
	g_signal_connect(item, "activate", G_CALLBACK(paste_cb), term);
	gtk_menu_shell_append(GTK_MENU_SHELL(menu), item);

	gtk_menu_shell_append(GTK_MENU_SHELL(menu),
			      gtk_separator_menu_item_new());

	item = gtk_menu_item_new_with_label(_("Go to This Window's Folder"));
	g_signal_connect(item, "activate", G_CALLBACK(open_here_cb), term);
	gtk_menu_shell_append(GTK_MENU_SHELL(menu), item);

	gtk_widget_show_all(menu);
	g_signal_connect(menu, "selection-done",
			 G_CALLBACK(gtk_widget_destroy), NULL);
	gtk_menu_popup_at_pointer(GTK_MENU(menu), (GdkEvent *) event);

	return TRUE;
}

static void create_vte(Terminal *term)
{
	FilerWindow *filer_window = term->filer_window;
	GtkTargetEntry targets[] = {
		{"text/uri-list", 0, 0},
	};
	GtkWidget *scrollbar;
	char *argv[2];

	term->vte = vte_terminal_new();
	vte_terminal_set_scrollback_lines(VTE_TERMINAL(term->vte), 10000);
	vte_terminal_set_scroll_on_keystroke(VTE_TERMINAL(term->vte), TRUE);
	vte_terminal_set_mouse_autohide(VTE_TERMINAL(term->vte), TRUE);
	set_font(term);
	gtk_widget_set_size_request(term->vte, 100, MIN_HEIGHT);

	scrollbar = gtk_scrollbar_new(GTK_ORIENTATION_VERTICAL,
		gtk_scrollable_get_vadjustment(GTK_SCROLLABLE(term->vte)));

	gtk_box_pack_start(GTK_BOX(term->box), term->vte, TRUE, TRUE, 0);
	gtk_box_pack_start(GTK_BOX(term->box), scrollbar, FALSE, TRUE, 0);

	/* Accept files (copy or link only: never let a drag source think
	 * the file was moved here and delete it). */
	gtk_drag_dest_set(term->vte, GTK_DEST_DEFAULT_ALL,
			  targets, G_N_ELEMENTS(targets),
			  GDK_ACTION_COPY | GDK_ACTION_LINK);
	g_signal_connect(term->vte, "drag-data-received",
			 G_CALLBACK(drag_data_received), term);
	g_signal_connect(term->vte, "button-press-event",
			 G_CALLBACK(button_press), term);
	g_signal_connect(term->vte, "child-exited",
			 G_CALLBACK(child_exited), term);

	argv[0] = vte_get_user_shell();
	if (!argv[0])
		argv[0] = g_strdup("/bin/sh");
	argv[1] = NULL;

	vte_terminal_spawn_async(VTE_TERMINAL(term->vte), VTE_PTY_DEFAULT,
			filer_window->real_path, argv, NULL,
			G_SPAWN_SEARCH_PATH, NULL, NULL, NULL,
			-1, NULL, spawned, term);
	g_free(argv[0]);

	term->poll = g_timeout_add(400, poll_cwd, term);

	/* (show_all does nothing on term->box: it's no-show-all, so that the
	 * window's own show_all doesn't reveal the panel) */
	gtk_widget_show(term->vte);
	gtk_widget_show(scrollbar);
}

/* --- Height --- */

static guint save_height_timeout = 0;
static int pending_height = 0;

static gboolean save_height(gpointer data)
{
	save_height_timeout = 0;
	if (pending_height >= MIN_HEIGHT)
		option_store_int(&o_filer_terminal_height,
				 MIN(pending_height, 2000));
	return G_SOURCE_REMOVE;
}

static int terminal_alloc_height(Terminal *term)
{
	return gtk_widget_get_allocated_height(term->paned) -
		gtk_paned_get_position(GTK_PANED(term->paned)) - 6;
}

static void pane_moved(GObject *paned, GParamSpec *pspec, Terminal *term)
{
	GdkEvent *event;
	gboolean by_user = FALSE;

	if (!gtk_widget_get_visible(term->box))
		return;

	event = gtk_get_current_event();
	if (event)
	{
		by_user = event->type == GDK_MOTION_NOTIFY ||
			  event->type == GDK_BUTTON_RELEASE ||
			  event->type == GDK_BUTTON_PRESS;
		gdk_event_free(event);
	}
	if (!by_user)
		return;

	pending_height = terminal_alloc_height(term);
	if (save_height_timeout)
		g_source_remove(save_height_timeout);
	save_height_timeout = g_timeout_add(800, save_height, NULL);
}

/* Once the window has its new size, give the terminal its height */
static gboolean place_divider(gpointer data)
{
	GtkWidget *paned = data;	/* (we hold a reference) */
	int total = gtk_widget_get_allocated_height(paned);
	int h = MAX(MIN_HEIGHT, o_filer_terminal_height.int_value);

	if (total > 1)
		gtk_paned_set_position(GTK_PANED(paned),
				       MAX(80, total - h - 6));
	g_object_unref(paned);
	return G_SOURCE_REMOVE;
}

/* --- Closing --- */

/* Ask before closing a window whose terminal is running a program */
static gboolean window_delete(GtkWidget *window, GdkEvent *event,
			      Terminal *term)
{
	GtkWidget *dialog;
	gint response;

	if (!term->vte || !term->pid || shell_is_idle(term))
		return FALSE;

	dialog = gtk_message_dialog_new(GTK_WINDOW(window), GTK_DIALOG_MODAL,
			GTK_MESSAGE_QUESTION, GTK_BUTTONS_NONE,
			_("A program is still running in this window's "
			  "terminal."));
	gtk_message_dialog_format_secondary_text(GTK_MESSAGE_DIALOG(dialog),
			_("Closing the window will stop it."));
	gtk_dialog_add_buttons(GTK_DIALOG(dialog),
			_("_Cancel"), GTK_RESPONSE_CANCEL,
			_("Close Anyway"), GTK_RESPONSE_OK, NULL);
	gtk_dialog_set_default_response(GTK_DIALOG(dialog),
					GTK_RESPONSE_CANCEL);
	response = gtk_dialog_run(GTK_DIALOG(dialog));
	gtk_widget_destroy(dialog);

	return response != GTK_RESPONSE_OK;
}

static void terminal_free(gpointer data)
{
	Terminal *term = data;

	if (term->poll)
		g_source_remove(term->poll);
	g_free(term->last_cwd);
	g_free(term);
}

static void focus_when_mapped(GtkWidget *vte, gpointer data)
{
	g_signal_handlers_disconnect_by_func(vte,
			G_CALLBACK(focus_when_mapped), data);
	gtk_widget_grab_focus(vte);
}

/* --- Public --- */

/* Create the divided area: 'content' above, the (hidden) terminal below */
GtkWidget *terminal_paned_new(FilerWindow *filer_window, GtkWidget *content)
{
	Terminal *term;

	term = g_new0(Terminal, 1);
	term->filer_window = filer_window;
	term->paned = gtk_paned_new(GTK_ORIENTATION_VERTICAL);
	gtk_paned_set_wide_handle(GTK_PANED(term->paned), TRUE);

	term->box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
	gtk_widget_set_no_show_all(term->box, TRUE);

	gtk_paned_pack1(GTK_PANED(term->paned), content, TRUE, FALSE);
	gtk_paned_pack2(GTK_PANED(term->paned), term->box, FALSE, FALSE);

	g_signal_connect(term->paned, "notify::position",
			 G_CALLBACK(pane_moved), term);
	g_signal_connect(filer_window->window, "delete-event",
			 G_CALLBACK(window_delete), term);

	g_object_set_data_full(G_OBJECT(filer_window->window), "rox-terminal",
			       term, terminal_free);

	gtk_widget_show(term->paned);

	return term->paned;
}

gboolean terminal_visible(FilerWindow *filer_window)
{
	Terminal *term = get_terminal(filer_window);

	return term && gtk_widget_get_visible(term->box);
}

void terminal_set_visible(FilerWindow *filer_window, gboolean visible)
{
	Terminal *term = get_terminal(filer_window);

	if (!term || terminal_visible(filer_window) == visible)
		return;

	if (visible)
	{
		int w, h, extra;
		GdkRectangle mon;
		GtkWidget *window = filer_window->window;

		if (!term->vte)
			create_vte(term);
		gtk_widget_show(term->box);

		/* Make room: grow the window so the files keep their space
		 * (as far as the screen allows). */
		gtk_window_get_size(GTK_WINDOW(window), &w, &h);
		extra = MAX(MIN_HEIGHT, o_filer_terminal_height.int_value) + 6;
		if (gtk_widget_get_realized(window))
		{
			gdk_monitor_get_workarea(
				gdk_display_get_monitor_at_window(
					gtk_widget_get_display(window),
					gtk_widget_get_window(window)),
				&mon);
			gtk_window_resize(GTK_WINDOW(window), w,
					  MIN(h + extra, mon.height - 40));
		}
		g_timeout_add(100, place_divider, g_object_ref(term->paned));

		/* Give it the focus once it's on screen (focusing it before
		 * it's realised makes GTK warn about the F4 key-release). */
		if (gtk_widget_get_mapped(term->vte))
			gtk_widget_grab_focus(term->vte);
		else
			g_signal_connect(term->vte, "map",
					 G_CALLBACK(focus_when_mapped), NULL);
		terminal_follow_filer(filer_window);
	}
	else
	{
		gboolean had_focus = term->vte && gtk_widget_has_focus(term->vte);
		GtkWidget *window = filer_window->window;
		int w, h, shrink;

		/* Give back the room the terminal took */
		shrink = gtk_widget_get_allocated_height(term->box) + 6;
		gtk_widget_hide(term->box);
		gtk_window_get_size(GTK_WINDOW(window), &w, &h);
		if (h - shrink > 150)
			gtk_window_resize(GTK_WINDOW(window), w, h - shrink);
		if (had_focus && filer_window->view)
			gtk_widget_grab_focus(GTK_WIDGET(filer_window->view));
	}
}

void terminal_toggle(FilerWindow *filer_window)
{
	terminal_set_visible(filer_window, !terminal_visible(filer_window));
}

/* Show the terminal in a new window, if the user wants that */
void terminal_window_opened(FilerWindow *filer_window)
{
	if (o_filer_terminal.int_value)
		terminal_set_visible(filer_window, TRUE);
}

/* Height of the terminal, if shown (for sizing the window) */
int terminal_height(FilerWindow *filer_window)
{
	if (!terminal_visible(filer_window))
		return 0;
	return MAX(MIN_HEIGHT, o_filer_terminal_height.int_value) + 6;
}

/* The filer window has moved to a new folder: take the shell there too,
 * if it's waiting at its prompt. */
void terminal_follow_filer(FilerWindow *filer_window)
{
	Terminal *term = get_terminal(filer_window);
	gchar *cwd, *quoted, *command;

	if (!term || !term->vte || !term->pid || !filer_window->real_path)
		return;
	if (!shell_is_idle(term))
	{
		term->follow_pending = TRUE;
		return;
	}
	term->follow_pending = FALSE;

	cwd = shell_cwd(term);
	if (cwd && strcmp(cwd, filer_window->real_path) == 0)
	{
		g_free(cwd);
		return;
	}
	g_free(cwd);

	/* Ctrl+E Ctrl+U clears anything half-typed at the prompt. The
	 * leading space keeps the command out of bash's history (Debian's
	 * default HISTCONTROL=ignoreboth). */
	quoted = g_shell_quote(filer_window->real_path);
	command = g_strdup_printf("\005\025 cd -- %s\r", quoted);
	vte_terminal_feed_child(VTE_TERMINAL(term->vte), command, -1);
	g_free(command);
	g_free(quoted);

	g_free(term->last_cwd);
	term->last_cwd = g_strdup(filer_window->real_path);
	term->ignore_until = g_get_monotonic_time() + 2 * G_USEC_PER_SEC;
}

/* Called from the filer window's key handler. If the terminal has the
 * focus, it gets every key (apart from a few of ROX's own); returns TRUE
 * if the key has been dealt with. */
gboolean terminal_key_press(FilerWindow *filer_window, GtkWidget *focus,
			    GdkEventKey *event)
{
	Terminal *term = get_terminal(filer_window);
	guint mods;

	if (!term || !term->vte || focus != term->vte ||
	    !gtk_widget_get_realized(term->vte))
		return FALSE;

	mods = event->state & (GDK_CONTROL_MASK | GDK_SHIFT_MASK |
			       GDK_MOD1_MASK | GDK_SUPER_MASK);

	if (mods == 0 && event->keyval == GDK_KEY_F4)
	{
		terminal_toggle(filer_window);
		return TRUE;
	}
	if (mods == (GDK_CONTROL_MASK | GDK_SHIFT_MASK) &&
	    (event->keyval == GDK_KEY_C || event->keyval == GDK_KEY_c))
	{
		copy_cb(NULL, term);
		return TRUE;
	}
	if (mods == (GDK_CONTROL_MASK | GDK_SHIFT_MASK) &&
	    (event->keyval == GDK_KEY_V || event->keyval == GDK_KEY_v))
	{
		paste_cb(NULL, term);
		return TRUE;
	}

	gtk_widget_event(term->vte, (GdkEvent *) event);
	return TRUE;
}
