/*
 * ROX-Filer, filer for the ROX desktop project
 */

#ifndef _SIDEPANE_H
#define _SIDEPANE_H

#include <gtk/gtk.h>

extern Option o_filer_side_pane;

void side_pane_init(void);
GtkWidget *side_pane_new(FilerWindow *filer_window);
void side_pane_update(FilerWindow *filer_window);
gboolean side_pane_visible(FilerWindow *filer_window);
void side_pane_set_visible(FilerWindow *filer_window, gboolean visible);
int side_pane_width(FilerWindow *filer_window);
int side_pane_default_width(void);
GtkWidget *side_pane_paned_new(FilerWindow *filer_window, GtkWidget *content);

#endif /* _SIDEPANE_H */
