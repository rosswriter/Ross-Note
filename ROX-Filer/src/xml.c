/*
 * ROX-Filer, filer for the ROX desktop project
 * Copyright (C) 2006, Thomas Leonard and others (see changelog for details).
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation; either version 2 of the License, or (at your option)
 * any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program; if not, write to the Free Software Foundation, Inc., 59 Temple
 * Place, Suite 330, Boston, MA  02111-1307  USA
 */

/* xml.c - A GObject wrapper for libxml documents */

#include "config.h"

#include <string.h>

#include <libxml/parser.h>

#include "global.h"

#include "i18n.h"
#include "xml.h"

static gpointer parent_class = NULL;

/* Static prototypes */
static xmlNode *best_lang(xmlNode *first);
static void xml_wrapper_finialize(GObject *object);
static void xml_wrapper_class_init(gpointer gclass, gpointer data);
static void xml_wrapper_init(GTypeInstance *object, gpointer gclass);
static GType xml_wrapper_get_type(void);

/****************************************************************
 *			EXTERNAL INTERFACE			*
 ****************************************************************/

XMLwrapper *xml_new(const char *pathname)
{
	xmlDocPtr doc = NULL;
	XMLwrapper *xml_data;

	if (pathname)
	{
		doc = xmlParseFile(pathname);
		if (!doc)
			return NULL;	/* Bad XML */
	}

	xml_data = g_object_new(xml_wrapper_get_type(), NULL);
	xml_data->doc = doc;

	return xml_data;
}

/* Return the first child of the root node with this name */
xmlNode *xml_get_section(XMLwrapper *xml, const gchar *ns, const gchar *name)
{
	g_return_val_if_fail(xml != NULL, NULL);
	g_return_val_if_fail(xml->doc != NULL, NULL);

	return get_subnode(xmlDocGetRootElement(xml->doc), ns, name);
}

/* Return the (first) child of this node with the given name.
 * NULL if not found.
 * If there are several consecutive nodes with the same name but different
 * xml:lang attributes, then the one matching the current locale is used,
 * or the first one if none match.
 */
xmlNode *get_subnode(xmlNode *node, const char *namespaceURI, const char *name)
{
	for (node = node->xmlChildrenNode; node; node = node->next)
	{
		if (node->type != XML_ELEMENT_NODE)
			continue;

		if (strcmp(node->name, name))
			continue;

		if (node->ns == NULL || namespaceURI == NULL)
		{
			if (node->ns == NULL && namespaceURI == NULL)
				return best_lang(node);
			continue;
		}
		
		if (strcmp(node->ns->href, namespaceURI) == 0)
			return best_lang(node);
	}

	return NULL;
}

/****************************************************************
 *			INTERNAL FUNCTIONS			*
 ****************************************************************/

/* Taking this node and each following sibling with the same name,
 * return the one which matches the current LANG.
 * If nothing matches, return the one with no xml:lang (the untranslated
 * text), or the first node if every one has a language. (Newer versions of
 * shared-mime-info put the untranslated comment last, after the
 * translations, so "the first one" would be in some random language.)
 */
static xmlNode *best_lang(xmlNode *first)
{
	xmlNode *node = first;
	xmlNode *fallback = NULL;
	xmlNode *untagged = NULL;
	const char *target_lang = current_lang ? current_lang : "en";
	char *territory;
	
	g_return_val_if_fail(first != NULL, NULL);

	territory = strchr(target_lang, '_');

	for (node = first; node; node = node->next)
	{
		char *lang;

		if (node->type != XML_ELEMENT_NODE)
			continue;

		/* Skip other elements (the translations may be split into
		 * several groups with other elements between them)... */
		if (strcmp(node->name, first->name))
			continue;

		/* Check namespaces match... */
		if ((node->ns == NULL) != (first->ns == NULL))
			continue;

		if (node->ns && first->ns)
			if (strcmp(node->ns->href, first->ns->href))
				continue;

		lang = xmlNodeGetLang(node);
		
		if (!lang)
		{
			if (!untagged)
				untagged = node;
			continue;
		}
		if (strcmp(lang, target_lang) == 0)
		{
			xmlFree(lang);
			return node;
		}
		if (!fallback && strlen(lang) == (territory ? territory - target_lang
						   : strlen(target_lang)) &&
		    strncmp(lang, target_lang, strlen(lang)) == 0)
		{
			fallback = node;
		}
		xmlFree(lang);
	}

	if (fallback)
		return fallback;
	return untagged ? untagged : first;
}

static void xml_wrapper_finialize(GObject *object)
{
	XMLwrapper *xml = (XMLwrapper *) object;

	if (xml->doc)
	{
		xmlFreeDoc(xml->doc);
		xml->doc = NULL;
	}

	G_OBJECT_CLASS(parent_class)->finalize(object);
}

static void xml_wrapper_class_init(gpointer gclass, gpointer data)
{
	GObjectClass *object = (GObjectClass *) gclass;

	parent_class = g_type_class_peek_parent(gclass);

	object->finalize = xml_wrapper_finialize;
}

static void xml_wrapper_init(GTypeInstance *object, gpointer gclass)
{
	XMLwrapper *wrapper = (XMLwrapper *) object;

	wrapper->doc = NULL;
}

static GType xml_wrapper_get_type(void)
{
	static GType type = 0;

	if (!type)
	{
		static const GTypeInfo info =
		{
			sizeof (XMLwrapperClass),
			NULL,			/* base_init */
			NULL,			/* base_finalise */
			xml_wrapper_class_init,
			NULL,			/* class_finalise */
			NULL,			/* class_data */
			sizeof(XMLwrapper),
			0,			/* n_preallocs */
			xml_wrapper_init
		};

		type = g_type_register_static(G_TYPE_OBJECT, "XMLwrapper",
					      &info, 0);
	}

	return type;
}

