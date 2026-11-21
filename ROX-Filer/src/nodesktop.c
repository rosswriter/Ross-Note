/* Stubs replacing the pinboard and panels, which this build leaves out. */
#include "config.h"
#include <stdlib.h>
#include <string.h>
#include <gtk/gtk.h>
#include "global.h"

/* --- GDK 2 input handlers, implemented with GIOChannel --- */

typedef struct {
	GdkInputFunction func;
	gpointer	 data;
	GDestroyNotify	 destroy;
} RoxInput;

static gboolean rox_input_cb(GIOChannel *source, GIOCondition cond,
			     gpointer data)
{
	RoxInput *in = data;
	GdkInputCondition c = 0;

	if (cond & (G_IO_IN | G_IO_HUP | G_IO_ERR))
		c |= GDK_INPUT_READ;
	if (cond & (G_IO_OUT | G_IO_ERR))
		c |= GDK_INPUT_WRITE;
	if (cond & G_IO_PRI)
		c |= GDK_INPUT_EXCEPTION;

	in->func(in->data, g_io_channel_unix_get_fd(source), c);
	return TRUE;
}

static void rox_input_free(gpointer data)
{
	RoxInput *in = data;

	if (in->destroy)
		in->destroy(in->data);
	g_free(in);
}

guint gdk_input_add_full(gint source, GdkInputCondition condition,
			 GdkInputFunction function, gpointer data,
			 GDestroyNotify destroy)
{
	GIOChannel *chan;
	GIOCondition cond = 0;
	RoxInput *in;
	guint tag;

	if (condition & GDK_INPUT_READ)
		cond |= G_IO_IN | G_IO_HUP | G_IO_ERR;
	if (condition & GDK_INPUT_WRITE)
		cond |= G_IO_OUT | G_IO_ERR;
	if (condition & GDK_INPUT_EXCEPTION)
		cond |= G_IO_PRI;

	in = g_new(RoxInput, 1);
	in->func = function;
	in->data = data;
	in->destroy = destroy;

	chan = g_io_channel_unix_new(source);
	tag = g_io_add_watch_full(chan, G_PRIORITY_DEFAULT, cond,
				  rox_input_cb, in, rox_input_free);
	g_io_channel_unref(chan);

	return tag;
}

/* gtk_quit_add() ran a function as the main loop quit. ROX only uses it
 * to tidy up the session manager connection, so run it at exit. */
static GSList *quit_funcs = NULL;

static void run_quit_funcs(void)
{
	GSList *next;

	for (next = quit_funcs; next; next = next->next->next)
		((GSourceFunc) next->data)(next->next->data);
}

void gtk_quit_add(guint level, GSourceFunc function, gpointer data)
{
	if (!quit_funcs)
		atexit(run_quit_funcs);
	quit_funcs = g_slist_append(quit_funcs, function);
	quit_funcs = g_slist_append(quit_funcs, data);
}

/* --- The pinboard and panels ---
 *
 * This build of ROX-Filer leaves out the pinboard (icons on the desktop
 * background) and the panels (icon bars along the screen edges). These
 * stand-ins keep the rest of the filer, its command-line options and its
 * SOAP interface working; requests to show a pinboard or panel just say
 * that they are not available.
 */

#include "pinboard.h"
#include "panel.h"
#include "icon.h"

Pinboard *current_pinboard = NULL;
Icon *pinboard_drag_in_progress = NULL;
Panel *current_panel[PANEL_NUMBER_OF_SIDES] = {NULL};

static void not_available(const char *what)
{
	static gboolean warned_pinboard = FALSE, warned_panel = FALSE;
	gboolean *warned = what[1] == 'i' ? &warned_pinboard : &warned_panel;

	if (*warned)
		return;
	*warned = TRUE;
	g_message("The %s is not available in this version of ROX-Filer.",
		  what);
}

void pinboard_init(void) {}
void pinboard_activate(const gchar *name)
{
	if (name && *name)
		not_available("pinboard");
}
void pinboard_pin(const gchar *path, const gchar *name, int x, int y,
		  const gchar *shortcut)
{
	not_available("pinboard");
}
void pinboard_pin_with_args(const gchar *path, const gchar *name, int x,
			    int y, const gchar *shortcut, const char *arg,
			    gboolean locked, gboolean update)
{
	not_available("pinboard");
}
gboolean pinboard_remove(const gchar *path, const gchar *name)
{
	return FALSE;
}
void pinboard_move_icons(void) {}
const gchar *pinboard_get_name(void) { return NULL; }
void pinboard_set_backdrop_app(const gchar *app)
{
	not_available("pinboard");
}
void pinboard_set_backdrop(const gchar *path, BackdropStyle style)
{
	not_available("pinboard");
}
void pinboard_update_size(void) {}

void panel_init(void) {}
Panel *panel_new(const gchar *name, PanelSide side)
{
	if (name && *name)
		not_available("panel");
	return NULL;
}
gboolean panel_add(PanelSide side, const gchar *path, const gchar *label,
		   gboolean after, const gchar *shortcut, const gchar *args,
		   gboolean locked)
{
	not_available("panel");
	return FALSE;
}
gboolean panel_remove_item(PanelSide side, const gchar *path,
			   const gchar *label)
{
	return FALSE;
}
void panel_update_size(void) {}
PanelSide panel_name_to_side(gchar *side)
{
	if (side && strcmp(side, "Top") == 0)
		return PANEL_TOP;
	else if (side && strcmp(side, "Bottom") == 0)
		return PANEL_BOTTOM;
	else if (side && strcmp(side, "Left") == 0)
		return PANEL_LEFT;
	else if (side && strcmp(side, "Right") == 0)
		return PANEL_RIGHT;
	return PANEL_DEFAULT_SIDE;
}

/* Icons (shared by the pinboard and panels) */
gboolean icons_require(const gchar *path) { return FALSE; }
void icons_may_update(const gchar *path) {}
