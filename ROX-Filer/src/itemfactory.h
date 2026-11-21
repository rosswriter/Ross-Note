/*
 * ROX-Filer: a small replacement for GTK 2's GtkItemFactory.
 *
 * GtkItemFactory built menus from a table of entries. GTK 3 removed it,
 * but ROX-Filer's menus (and the user's saved key bindings, which use the
 * same accelerator paths) are defined that way, so this provides just
 * enough of the old interface for ROX-Filer's own use.
 */

#ifndef _ITEMFACTORY_H
#define _ITEMFACTORY_H

#include <gtk/gtk.h>

typedef void (*GtkItemFactoryCallback)();

typedef struct _GtkItemFactoryEntry GtkItemFactoryEntry;
struct _GtkItemFactoryEntry {
	gchar		 *path;
	gchar		 *accelerator;
	GtkItemFactoryCallback callback;
	guint		 callback_action;
	/* NULL / "<Item>", "<StockItem>", "<ToggleItem>", "<CheckItem>",
	 * "<Separator>", "<Branch>" */
	gchar		 *item_type;
	gconstpointer	 extra_data;	/* Stock ID or icon name */
};

typedef struct _GtkItemFactory GtkItemFactory;

GtkItemFactory *rox_item_factory_new(const gchar *path,
				     GtkAccelGroup *accel_group);
void rox_item_factory_create_items(GtkItemFactory *factory, guint n_entries,
				   GtkItemFactoryEntry *entries,
				   gpointer callback_data);
GtkWidget *rox_item_factory_get_widget(GtkItemFactory *factory,
				       const gchar *path);

#define gtk_item_factory_new(type, path, accel) \
	rox_item_factory_new((path), (accel))
#define gtk_item_factory_create_items(f, n, e, d) \
	rox_item_factory_create_items((f), (n), (e), (d))
#define gtk_item_factory_get_widget(f, p) \
	rox_item_factory_get_widget((f), (p))

#endif /* _ITEMFACTORY_H */
