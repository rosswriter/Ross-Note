/*
 * ROX-Filer: a small replacement for GTK 2's GtkItemFactory.
 * See itemfactory.h.
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation; either version 2 of the License, or (at your option)
 * any later version.
 */

#include "config.h"

#include <string.h>
#include <gtk/gtk.h>

#include "itemfactory.h"

struct _GtkItemFactory {
	gchar		*root;		/* e.g. "<filer>" */
	GtkAccelGroup	*accel_group;
	GtkWidget	*menu;		/* The top-level GtkMenu */
	GHashTable	*widgets;	/* Full path -> GtkWidget */
};

typedef struct {
	GtkItemFactoryCallback	callback;
	guint			action;
	gpointer		data;
} Activate;

typedef void (*ItemCallback)(gpointer data, guint action, GtkWidget *widget);

static void item_activated(GtkWidget *item, Activate *act)
{
	if (act->callback)
		((ItemCallback) act->callback)(act->data, act->action, item);
}

/* Remove '_' mnemonic markers so that paths match as GTK 2 did. */
static gchar *strip_path(const gchar *path)
{
	GString *s = g_string_new(NULL);

	for (; *path; path++)
	{
		if (*path == '_')
		{
			if (path[1] == '_')
				path++;
			else
				continue;
		}
		g_string_append_c(s, *path);
	}
	return g_string_free(s, FALSE);
}

GtkItemFactory *rox_item_factory_new(const gchar *path,
				     GtkAccelGroup *accel_group)
{
	GtkItemFactory *factory;

	factory = g_new0(GtkItemFactory, 1);
	factory->root = g_strdup(path);
	factory->accel_group = accel_group ? g_object_ref(accel_group)
					   : gtk_accel_group_new();
	factory->menu = gtk_menu_new();
	g_object_ref_sink(factory->menu);
	gtk_menu_set_accel_group(GTK_MENU(factory->menu),
				 factory->accel_group);
	factory->widgets = g_hash_table_new_full(g_str_hash, g_str_equal,
						 g_free, NULL);
	g_hash_table_insert(factory->widgets, g_strdup(path), factory->menu);

	return factory;
}

/* Returns the GtkMenu that should contain the item at 'path' */
static GtkWidget *parent_menu(GtkItemFactory *factory, const gchar *full)
{
	const gchar *slash;
	gchar *parent;
	GtkWidget *menu;

	slash = strrchr(full, '/');
	if (!slash)
		return factory->menu;

	parent = g_strndup(full, slash - full);
	menu = g_hash_table_lookup(factory->widgets, parent);
	g_free(parent);

	return menu ? menu : factory->menu;
}

static GtkWidget *make_image(const gchar *id)
{
	if (!id)
		return NULL;
	if (gtk_icon_factory_lookup_default(id))
		return gtk_image_new_from_stock(id, GTK_ICON_SIZE_MENU);
	return gtk_image_new_from_icon_name(id, GTK_ICON_SIZE_MENU);
}

void rox_item_factory_create_items(GtkItemFactory *factory, guint n_entries,
				   GtkItemFactoryEntry *entries,
				   gpointer callback_data)
{
	guint i;

	for (i = 0; i < n_entries; i++)
	{
		GtkItemFactoryEntry *e = &entries[i];
		const gchar *type = e->item_type;
		const gchar *label;
		gchar *path, *full;
		GtkWidget *item, *menu;

		path = strip_path(e->path);
		full = g_strconcat(factory->root, path, NULL);
		label = strrchr(e->path, '/');
		label = label ? label + 1 : e->path;

		menu = parent_menu(factory, full);

		if (type && strcmp(type, "<Separator>") == 0)
		{
			item = gtk_separator_menu_item_new();
		}
		else if (type && (strcmp(type, "<ToggleItem>") == 0 ||
				  strcmp(type, "<CheckItem>") == 0))
		{
			item = gtk_check_menu_item_new_with_label(label);
		}
		else if (type && (strcmp(type, "<StockItem>") == 0 ||
				  strcmp(type, "<ImageItem>") == 0 ||
				  strcmp(type, "<IconItem>") == 0))
		{
			GtkWidget *image;

			item = gtk_image_menu_item_new_with_label(label);
			image = make_image(e->extra_data);
			if (image)
			{
				gtk_image_menu_item_set_image(
					GTK_IMAGE_MENU_ITEM(item), image);
				gtk_image_menu_item_set_always_show_image(
					GTK_IMAGE_MENU_ITEM(item), TRUE);
			}
		}
		else
		{
			item = gtk_menu_item_new_with_label(label);
		}

		gtk_menu_shell_append(GTK_MENU_SHELL(menu), item);
		gtk_widget_show(item);

		if (type && strcmp(type, "<Branch>") == 0)
		{
			GtkWidget *sub = gtk_menu_new();

			gtk_menu_set_accel_group(GTK_MENU(sub),
						 factory->accel_group);
			gtk_menu_item_set_submenu(GTK_MENU_ITEM(item), sub);
			g_hash_table_insert(factory->widgets,
					    g_strdup(full), sub);
		}
		else if (!type || strcmp(type, "<Separator>") != 0)
		{
			guint key = 0;
			GdkModifierType mods = 0;

			/* Accelerator paths let the user's saved key
			 * bindings (and GTK's accel map) find each item.
			 * Add the default key first: setting the path
			 * creates an empty entry if there isn't one, and a
			 * binding the user saved (loaded already) wins. */
			if (!gtk_accel_map_lookup_entry(full, NULL))
			{
				if (e->accelerator && *e->accelerator)
					gtk_accelerator_parse(e->accelerator,
							      &key, &mods);
				gtk_accel_map_add_entry(full, key, mods);
			}
			gtk_menu_item_set_accel_path(GTK_MENU_ITEM(item), full);

			if (e->callback)
			{
				Activate *act = g_new(Activate, 1);

				act->callback = e->callback;
				act->action = e->callback_action;
				act->data = callback_data;
				g_signal_connect_data(item, "activate",
					G_CALLBACK(item_activated), act,
					(GClosureNotify) g_free, 0);
			}
			g_hash_table_insert(factory->widgets,
					    g_strdup(full), item);
		}

		g_free(path);
		g_free(full);
	}
}

GtkWidget *rox_item_factory_get_widget(GtkItemFactory *factory,
				       const gchar *path)
{
	gchar *stripped;
	GtkWidget *widget;

	g_return_val_if_fail(factory != NULL, NULL);
	g_return_val_if_fail(path != NULL, NULL);

	stripped = strip_path(path);
	widget = g_hash_table_lookup(factory->widgets, stripped);
	g_free(stripped);

	return widget;
}
