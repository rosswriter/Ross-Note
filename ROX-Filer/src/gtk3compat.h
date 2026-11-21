/*
 * ROX-Filer GTK 3 compatibility helpers.
 *
 * ROX-Filer was written for GTK 2. GTK 2 is no longer maintained and is
 * being removed from Debian and other distributions, so the filer now
 * builds against GTK 3. This header maps the small GTK 2 idioms that are
 * used throughout the code onto their GTK 3 equivalents, so that the rest
 * of the source can stay close to the original.
 */

#ifndef _GTK3COMPAT_H
#define _GTK3COMPAT_H

#include <locale.h>
#include <gtk/gtk.h>
#include <gtk/gtkx.h>
#include <gdk/gdkx.h>

#include <gdk/gdkkeysyms-compat.h>

#include "itemfactory.h"

/* Raster operations; ROX only uses these to say how a lasso affects
 * the selection. Values as in GTK 2. */
typedef enum {
	GDK_COPY, GDK_INVERT, GDK_XOR, GDK_CLEAR, GDK_AND, GDK_AND_REVERSE,
	GDK_AND_INVERT, GDK_NOOP, GDK_OR, GDK_EQUIV, GDK_OR_REVERSE,
	GDK_COPY_INVERT, GDK_OR_INVERT, GDK_NAND, GDK_NOR, GDK_SET
} GdkFunction;

/* GDK input handlers became GIOChannel watches */
typedef enum {
	GDK_INPUT_READ		= 1 << 0,
	GDK_INPUT_WRITE		= 1 << 1,
	GDK_INPUT_EXCEPTION	= 1 << 2
} GdkInputCondition;
typedef void (*GdkInputFunction)(gpointer data, gint source,
				 GdkInputCondition condition);
guint gdk_input_add_full(gint source, GdkInputCondition condition,
			 GdkInputFunction function, gpointer data,
			 GDestroyNotify destroy);
#define gdk_input_add(s, c, f, d) gdk_input_add_full((s), (c), (f), (d), NULL)
#define gdk_input_remove(tag)	g_source_remove(tag)
void gtk_quit_add(guint level, GSourceFunc function, gpointer data);

/* GdkRegion became cairo_region_t */
typedef cairo_region_t GdkRegion;
#define gdk_region_new()		cairo_region_create()
#define gdk_region_destroy(r)		cairo_region_destroy(r)
#define gdk_region_copy(r)		cairo_region_copy(r)
#define gdk_region_rectangle(rect)	cairo_region_create_rectangle(rect)
#define gdk_region_union_with_rect(r, rect) cairo_region_union_rectangle((r), (rect))
#define gdk_region_union(a, b)		cairo_region_union((a), (b))
#define gdk_region_subtract(a, b)	cairo_region_subtract((a), (b))
#define gdk_region_intersect(a, b)	cairo_region_intersect((a), (b))
#define gdk_region_offset(r, x, y)	cairo_region_translate((r), (x), (y))
#define gdk_region_get_clipbox(r, rect)	cairo_region_get_extents((r), (rect))
#define gdk_region_empty(r)		cairo_region_is_empty(r)
#define gdk_region_point_in(r, x, y)	cairo_region_contains_point((r), (x), (y))

/* Old type-system macros */
#define GTK_CHECK_CAST		G_TYPE_CHECK_INSTANCE_CAST
#define GTK_CHECK_CLASS_CAST	G_TYPE_CHECK_CLASS_CAST
#define GTK_CHECK_TYPE		G_TYPE_CHECK_INSTANCE_TYPE
#define GTK_CHECK_CLASS_TYPE	G_TYPE_CHECK_CLASS_TYPE
#define GTK_CHECK_GET_CLASS	G_TYPE_INSTANCE_GET_CLASS
#define GTK_OBJECT(o)		G_OBJECT(o)
#define GTK_OBJECT_CLASS(c)	G_OBJECT_CLASS(c)
#define GtkObject		GObject
#define GtkObjectClass		GObjectClass
#define GtkType			GType
#define GTK_SIGNAL_FUNC(f)	G_CALLBACK(f)
#define GtkFunction		GSourceFunc
#define gtk_type_class(t)	g_type_class_peek(t)

#define gtk_widget_ref(w)	g_object_ref(w)
#define gtk_widget_unref(w)	g_object_unref(w)
#define gtk_object_sink(o)	g_object_ref_sink(o)

/* Widget flags */
#define GTK_WIDGET_REALIZED(w)	 gtk_widget_get_realized(GTK_WIDGET(w))
#define GTK_WIDGET_MAPPED(w)	 gtk_widget_get_mapped(GTK_WIDGET(w))
#define GTK_WIDGET_VISIBLE(w)	 gtk_widget_get_visible(GTK_WIDGET(w))
#define GTK_WIDGET_HAS_FOCUS(w)	 gtk_widget_has_focus(GTK_WIDGET(w))
#define GTK_WIDGET_SENSITIVE(w)	 gtk_widget_get_sensitive(GTK_WIDGET(w))
#define GTK_WIDGET_IS_SENSITIVE(w) gtk_widget_is_sensitive(GTK_WIDGET(w))
#define GTK_WIDGET_DRAWABLE(w)	 gtk_widget_is_drawable(GTK_WIDGET(w))
#define GTK_WIDGET_TOPLEVEL(w)	 gtk_widget_is_toplevel(GTK_WIDGET(w))
#define GTK_WIDGET_NO_WINDOW(w)	 (!gtk_widget_get_has_window(GTK_WIDGET(w)))
#define GTK_WIDGET_STATE(w)	 gtk_widget_get_state(GTK_WIDGET(w))

/* GTK 2 widget flags, mapped onto the GTK 3 setters */
enum {
	GTK_CAN_FOCUS		= 1 << 0,
	GTK_CAN_DEFAULT		= 1 << 1,
	GTK_NO_WINDOW		= 1 << 2,
	GTK_REALIZED		= 1 << 3,
	GTK_APP_PAINTABLE	= 1 << 4,
	GTK_DOUBLE_BUFFERED	= 1 << 5,
	GTK_SENSITIVE		= 1 << 6,
	GTK_MAPPED		= 1 << 7,
	GTK_VISIBLE		= 1 << 8,
};
static inline void rox_widget_set_flags(GtkWidget *w, guint flags, gboolean on)
{
	if (flags & GTK_CAN_FOCUS)	gtk_widget_set_can_focus(w, on);
	if (flags & GTK_CAN_DEFAULT)	gtk_widget_set_can_default(w, on);
	if (flags & GTK_NO_WINDOW)	gtk_widget_set_has_window(w, !on);
	if (flags & GTK_REALIZED)	gtk_widget_set_realized(w, on);
	if (flags & GTK_APP_PAINTABLE)	gtk_widget_set_app_paintable(w, on);
	if (flags & GTK_SENSITIVE)	gtk_widget_set_sensitive(w, on);
	if (flags & GTK_MAPPED)		gtk_widget_set_mapped(w, on);
	if (flags & GTK_VISIBLE)	gtk_widget_set_visible(w, on);
}
static inline guint rox_widget_get_flags(GtkWidget *w)
{
	guint f = 0;
	if (gtk_widget_get_can_focus(w))	f |= GTK_CAN_FOCUS;
	if (gtk_widget_get_can_default(w))	f |= GTK_CAN_DEFAULT;
	if (!gtk_widget_get_has_window(w))	f |= GTK_NO_WINDOW;
	if (gtk_widget_get_realized(w))		f |= GTK_REALIZED;
	if (gtk_widget_get_app_paintable(w))	f |= GTK_APP_PAINTABLE;
	if (gtk_widget_get_sensitive(w))	f |= GTK_SENSITIVE;
	if (gtk_widget_get_mapped(w))		f |= GTK_MAPPED;
	if (gtk_widget_get_visible(w))		f |= GTK_VISIBLE;
	return f;
}
#define GTK_WIDGET_SET_FLAGS(w, f)	rox_widget_set_flags(GTK_WIDGET(w), (f), TRUE)
#define GTK_WIDGET_UNSET_FLAGS(w, f)	rox_widget_set_flags(GTK_WIDGET(w), (f), FALSE)
#define GTK_WIDGET_FLAGS(w)		rox_widget_get_flags(GTK_WIDGET(w))

#define gdk_drawable_get_display(d)	gdk_window_get_display(d)
#define gdk_drawable_get_screen(d)	gdk_window_get_screen(d)
#define GDK_WINDOW_DESTROYED(w)		gdk_window_is_destroyed(w)
#define gdk_display			(GDK_DISPLAY_XDISPLAY(gdk_display_get_default()))
#define gdk_window_foreign_new(xid) \
	gdk_x11_window_foreign_new_for_display(gdk_display_get_default(), (xid))

/* Timeouts and input handlers */
#define gtk_timeout_add(t, f, d)	g_timeout_add((t), (GSourceFunc) (f), (d))
#define gtk_timeout_remove(t)		g_source_remove(t)
#define gtk_idle_add(f, d)		g_idle_add((GSourceFunc) (f), (d))
#define gtk_idle_remove(t)		g_source_remove(t)

#define GTK_DIALOG_NO_SEPARATOR	0
#define gtk_signal_connect_object(o, s, f, d) \
	g_signal_connect_swapped((o), (s), (f), (d))
#define gtk_widget_push_colormap(c)	((void) 0)
#define gtk_widget_pop_colormap()	((void) 0)
#define gdk_x11_drawable_get_xdisplay(w) GDK_WINDOW_XDISPLAY(w)
#define gdk_set_sm_client_id(id)	gdk_x11_set_sm_client_id(id)
#define gdk_window_lookup(xid) \
	gdk_x11_window_lookup_for_display(gdk_display_get_default(), (xid))
#define gdk_window_clear(w)		gdk_window_invalidate_rect((w), NULL, TRUE)
#define gtk_set_locale()	setlocale(LC_ALL, "")

#define gtk_box_pack_start_defaults(box, w) \
	gtk_box_pack_start((box), (w), TRUE, TRUE, 0)
#define gtk_dialog_set_has_separator(d, s)	((void) 0)

#define GDK_WINDOW_XWINDOW(w)	GDK_WINDOW_XID(w)
#define gdk_x11_drawable_get_xid(w) GDK_WINDOW_XID(w)

/* Tooltips: GTK 3 tooltips are set directly on each widget. */
typedef struct _GtkTooltips GtkTooltips;
#define gtk_tooltips_new()	((GtkTooltips *) NULL)
#define gtk_tooltips_set_tip(t, w, text, priv) \
	gtk_widget_set_tooltip_text(GTK_WIDGET(w), (text))

/* Widget size */
static inline gint rox_widget_width(GtkWidget *w)
{
	return gtk_widget_get_allocated_width(w);
}
static inline gint rox_widget_height(GtkWidget *w)
{
	return gtk_widget_get_allocated_height(w);
}
static inline GtkAllocation rox_widget_alloc(GtkWidget *w)
{
	GtkAllocation a;
	gtk_widget_get_allocation(w, &a);
	return a;
}
static inline GtkRequisition rox_widget_req(GtkWidget *w)
{
	GtkRequisition r;
	gtk_widget_get_preferred_size(w, &r, NULL);
	return r;
}

/* Replacement for gdk_drawable_get_size() on GdkWindows */
static inline void rox_window_get_size(GdkWindow *win, gint *w, gint *h)
{
	if (w)
		*w = gdk_window_get_width(win);
	if (h)
		*h = gdk_window_get_height(win);
}
#define gdk_drawable_get_size(d, w, h) rox_window_get_size((d), (w), (h))

/* Pointer position, replacing gdk_window_get_pointer() */
static inline GdkWindow *rox_window_get_pointer(GdkWindow *win,
					gint *x, gint *y,
					GdkModifierType *mask)
{
	GdkDisplay *display;
	GdkSeat *seat;
	GdkDevice *pointer;

	if (!win)
		win = gdk_get_default_root_window();
	display = gdk_window_get_display(win);
	seat = gdk_display_get_default_seat(display);
	pointer = gdk_seat_get_pointer(seat);
	return gdk_window_get_device_position(win, pointer, x, y, mask);
}
#define gdk_window_get_pointer(w, x, y, m) rox_window_get_pointer((w), (x), (y), (m))

static inline void rox_display_get_pointer(gint *x, gint *y,
					   GdkModifierType *mask)
{
	rox_window_get_pointer(gdk_get_default_root_window(), x, y, mask);
}

/* Grabs */
static inline GdkGrabStatus rox_pointer_grab(GdkWindow *win,
					     gboolean owner_events,
					     GdkEventMask mask,
					     GdkCursor *cursor,
					     guint32 time)
{
	GdkSeat *seat = gdk_display_get_default_seat(gdk_window_get_display(win));
	(void) time;
	return gdk_seat_grab(seat, win, GDK_SEAT_CAPABILITY_ALL_POINTING,
			     owner_events, cursor, NULL, NULL, NULL);
}
#define gdk_pointer_grab(w, oe, mask, confine, cursor, t) \
	rox_pointer_grab((w), (oe), (mask), (cursor), (t))
static inline void rox_pointer_ungrab(guint32 time)
{
	GdkSeat *seat = gdk_display_get_default_seat(gdk_display_get_default());
	(void) time;
	gdk_seat_ungrab(seat);
}
#define gdk_pointer_ungrab(t) rox_pointer_ungrab(t)
#define gdk_keyboard_ungrab(t) rox_pointer_ungrab(t)

/* Paint a GdkPixbuf onto a cairo context at (x, y) */
static inline void rox_cairo_pixbuf(cairo_t *cr, GdkPixbuf *pixbuf,
				    gint x, gint y)
{
	gdk_cairo_set_source_pixbuf(cr, pixbuf, x, y);
	cairo_rectangle(cr, x, y,
			gdk_pixbuf_get_width(pixbuf),
			gdk_pixbuf_get_height(pixbuf));
	cairo_fill(cr);
}

/* Paint at most width x height of a pixbuf at (x, y); -1 means all */
static inline void rox_cairo_pixbuf_size(cairo_t *cr, GdkPixbuf *pixbuf,
					 gint x, gint y,
					 gint width, gint height)
{
	if (width < 0)
		width = gdk_pixbuf_get_width(pixbuf);
	if (height < 0)
		height = gdk_pixbuf_get_height(pixbuf);
	cairo_save(cr);
	gdk_cairo_set_source_pixbuf(cr, pixbuf, x, y);
	cairo_rectangle(cr, x, y, width, height);
	cairo_fill(cr);
	cairo_restore(cr);
}

#endif /* _GTK3COMPAT_H */
