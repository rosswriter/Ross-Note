/*
 * ROX-Filer, filer for the ROX desktop project
 *
 * The side pane: a list of places down the left of each filer window
 * (Home, Desktop, Documents, Downloads, Music, Pictures, Videos, your
 * bookmarks and any drives), so you can jump to them with one click.
 * It uses GTK's own GtkPlacesSidebar, and can be turned off in
 * Options -> Filer windows or toggled with F9.
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation; either version 2 of the License, or (at your option)
 * any later version.
 */

#include "config.h"

#include <string.h>

#include "global.h"

#include "options.h"
#include "filer.h"
#include "bookmarks.h"
#include "gui_support.h"
#include "main.h"
#include "sidepane.h"

/* Narrowest the side pane can be dragged: about the width of its icons */
#define SIDE_PANE_MIN 44

Option o_filer_side_pane;
Option o_filer_side_pane_width;

void side_pane_init(void)
{
	option_add_int(&o_filer_side_pane, "filer_side_pane", TRUE);
	option_add_int(&o_filer_side_pane_width, "filer_side_pane_width", 170);
}

static void open_location(GtkPlacesSidebar *sidebar, GFile *location,
			  GtkPlacesOpenFlags flags, FilerWindow *filer_window)
{
	gchar *path;

	path = g_file_get_path(location);
	if (!path)
	{
		gchar *uri = g_file_get_uri(location);
		delayed_error(_("ROX-Filer can only open local folders, "
				"not '%s'."), uri);
		g_free(uri);
		return;
	}

	if (flags & (GTK_PLACES_OPEN_NEW_WINDOW | GTK_PLACES_OPEN_NEW_TAB))
		filer_opendir(path, filer_window, NULL);
	else
		filer_change_to(filer_window, path, NULL);

	g_free(path);
}

/* Add a shortcut for 'path' if it is a directory */
static void add_shortcut(GtkPlacesSidebar *sidebar, const gchar *path,
			 GHashTable *seen)
{
	GFile *file;

	if (!path || g_hash_table_contains(seen, path))
		return;
	if (!g_file_test(path, G_FILE_TEST_IS_DIR))
		return;

	g_hash_table_add(seen, g_strdup(path));
	file = g_file_new_for_path(path);
	gtk_places_sidebar_add_shortcut(sidebar, file);
	g_object_unref(file);
}

/* GtkPlacesSidebar already lists Home, Desktop and the XDG folders that
 * xdg-user-dirs knows about. If the user has no ~/.config/user-dirs.dirs,
 * add the usual folders ourselves, followed by the ROX bookmarks.
 */
static void add_shortcuts(GtkPlacesSidebar *sidebar)
{
	static const char *const standard[] = {
		"Documents", "Downloads", "Music", "Pictures", "Videos",
	};
	static const GUserDirectory xdg[] = {
		G_USER_DIRECTORY_DOCUMENTS, G_USER_DIRECTORY_DOWNLOAD,
		G_USER_DIRECTORY_MUSIC, G_USER_DIRECTORY_PICTURES,
		G_USER_DIRECTORY_VIDEOS,
	};
	GHashTable *seen;
	GList *bookmarks, *next;
	int i;

	seen = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, NULL);

	/* Places the sidebar shows by itself */
	g_hash_table_add(seen, g_strdup(g_get_home_dir()));
	g_hash_table_add(seen, g_strdup("/"));
	for (i = 0; i < G_USER_N_DIRECTORIES; i++)
	{
		const char *dir = g_get_user_special_dir(i);
		if (dir)
			g_hash_table_add(seen, g_strdup(dir));
	}

	for (i = 0; i < G_N_ELEMENTS(standard); i++)
	{
		if (!g_get_user_special_dir(xdg[i]))
		{
			gchar *path = g_build_filename(g_get_home_dir(),
						       standard[i], NULL);
			add_shortcut(sidebar, path, seen);
			g_free(path);
		}
	}

	bookmarks = bookmarks_get_paths();
	for (next = bookmarks; next; next = next->next)
		add_shortcut(sidebar, next->data, seen);
	g_list_free_full(bookmarks, g_free);

	g_hash_table_destroy(seen);
}

/* Create the side pane for this filer window. Returns the widget to pack. */
GtkWidget *side_pane_new(FilerWindow *filer_window)
{
	GtkWidget *sidebar;

	sidebar = gtk_places_sidebar_new();
	gtk_places_sidebar_set_open_flags(GTK_PLACES_SIDEBAR(sidebar),
			GTK_PLACES_OPEN_NORMAL | GTK_PLACES_OPEN_NEW_WINDOW);
	gtk_places_sidebar_set_show_recent(GTK_PLACES_SIDEBAR(sidebar), FALSE);
	gtk_places_sidebar_set_show_trash(GTK_PLACES_SIDEBAR(sidebar), FALSE);
	gtk_places_sidebar_set_show_other_locations(
			GTK_PLACES_SIDEBAR(sidebar), FALSE);
#if GTK_CHECK_VERSION(3, 22, 26)
	gtk_places_sidebar_set_show_starred_location(
			GTK_PLACES_SIDEBAR(sidebar), FALSE);
#endif
	gtk_widget_set_can_focus(sidebar, FALSE);

	/* GtkPlacesSidebar insists on being at least 140 pixels wide. Let it
	 * be narrower, cutting off the ends of long names rather than the
	 * icons, so the divider can be dragged further left. */
	gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(sidebar),
				       GTK_POLICY_EXTERNAL,
				       GTK_POLICY_AUTOMATIC);
	gtk_widget_set_size_request(sidebar, SIDE_PANE_MIN, -1);

	add_shortcuts(GTK_PLACES_SIDEBAR(sidebar));

	g_signal_connect(sidebar, "open-location",
			 G_CALLBACK(open_location), filer_window);

	filer_window->side_pane = sidebar;
	gtk_widget_set_no_show_all(sidebar, TRUE);
	gtk_widget_set_visible(sidebar, o_filer_side_pane.int_value);

	return sidebar;
}

/* Highlight the current folder in the side pane, if it is listed */
void side_pane_update(FilerWindow *filer_window)
{
	GFile *file;

	if (!filer_window->side_pane || !filer_window->real_path)
		return;

	file = g_file_new_for_path(filer_window->real_path);
	gtk_places_sidebar_set_location(
			GTK_PLACES_SIDEBAR(filer_window->side_pane), file);
	g_object_unref(file);
}

gboolean side_pane_visible(FilerWindow *filer_window)
{
	return filer_window->side_pane &&
		gtk_widget_get_visible(filer_window->side_pane);
}

void side_pane_set_visible(FilerWindow *filer_window, gboolean visible)
{
	if (!filer_window->side_pane)
		return;
	gtk_widget_set_visible(filer_window->side_pane, visible);
}

/* Starting width of the side pane */
int side_pane_default_width(void)
{
	return MAX(SIDE_PANE_MIN, o_filer_side_pane_width.int_value);
}

/* Width of the side pane, if shown (for sizing the window) */
int side_pane_width(FilerWindow *filer_window)
{
	GtkWidget *paned;

	if (!side_pane_visible(filer_window))
		return 0;

	paned = gtk_widget_get_parent(filer_window->side_pane);
	if (GTK_IS_PANED(paned) && gtk_widget_get_realized(paned))
		return gtk_paned_get_position(GTK_PANED(paned)) + 6;
	return side_pane_default_width() + 8;
}

/* --- Resizing ---
 * The side pane sits in a GtkPaned; drag the divider to resize it. The
 * width you choose is remembered for new windows (and next time). */

static guint save_width_timeout = 0;
static int pending_width = 0;

static gboolean save_width(gpointer data)
{
	save_width_timeout = 0;
	if (pending_width >= SIDE_PANE_MIN)
		option_store_int(&o_filer_side_pane_width, pending_width);
	return G_SOURCE_REMOVE;
}

static void pane_moved(GObject *paned, GParamSpec *pspec, gpointer data)
{
	GdkEvent *event;
	gboolean by_user = FALSE;

	/* Only remember widths the user chose by dragging, not ones GTK
	 * picked because the window was too narrow. */
	event = gtk_get_current_event();
	if (event)
	{
		by_user = event->type == GDK_MOTION_NOTIFY ||
			  event->type == GDK_BUTTON_RELEASE ||
			  event->type == GDK_BUTTON_PRESS ||
			  event->type == GDK_KEY_PRESS;
		gdk_event_free(event);
	}
	if (!by_user)
		return;

	pending_width = gtk_paned_get_position(GTK_PANED(paned));
	if (pending_width < SIDE_PANE_MIN)
	{
		gtk_paned_set_position(GTK_PANED(paned), SIDE_PANE_MIN);
		pending_width = SIDE_PANE_MIN;
	}
	if (save_width_timeout)
		g_source_remove(save_width_timeout);
	save_width_timeout = g_timeout_add(800, save_width, NULL);
}

/* Create the divided area: side pane on the left, 'content' on the right */
GtkWidget *side_pane_paned_new(FilerWindow *filer_window, GtkWidget *content)
{
	GtkWidget *paned = gtk_paned_new(GTK_ORIENTATION_HORIZONTAL);

	/* A wide handle is much easier to grab than GTK 3's 1-pixel line */
	gtk_paned_set_wide_handle(GTK_PANED(paned), TRUE);
	gtk_paned_pack1(GTK_PANED(paned), side_pane_new(filer_window),
			FALSE, FALSE);
	gtk_paned_pack2(GTK_PANED(paned), content, TRUE, FALSE);
	gtk_paned_set_position(GTK_PANED(paned), side_pane_default_width());
	gtk_widget_set_tooltip_text(paned, NULL);

	g_signal_connect(paned, "notify::position",
			 G_CALLBACK(pane_moved), NULL);

	return paned;
}
