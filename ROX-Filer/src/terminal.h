/*
 * ROX-Filer, filer for the ROX desktop project
 */

#ifndef _TERMINAL_H
#define _TERMINAL_H

#include <gtk/gtk.h>

void terminal_init(void);
GtkWidget *terminal_paned_new(FilerWindow *filer_window, GtkWidget *content);
gboolean terminal_visible(FilerWindow *filer_window);
void terminal_set_visible(FilerWindow *filer_window, gboolean visible);
void terminal_toggle(FilerWindow *filer_window);
void terminal_window_opened(FilerWindow *filer_window);
int terminal_height(FilerWindow *filer_window);
void terminal_follow_filer(FilerWindow *filer_window);
gboolean terminal_key_press(FilerWindow *filer_window, GtkWidget *focus,
			    GdkEventKey *event);

#endif /* _TERMINAL_H */
