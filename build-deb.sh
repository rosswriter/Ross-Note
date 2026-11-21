#!/bin/sh
# Build a Debian package of ROX-Filer (GTK 3 version) for this machine's
# architecture (amd64, arm64, ...).
#
# Needs: build-essential pkg-config autoconf gettext dpkg-dev
#        libgtk-3-dev libvte-2.91-dev libxml2-dev libsm-dev libice-dev libx11-dev
#        shared-mime-info
# Optional (for the manual): xsltproc docbook-xsl
#
# Usage: ./build-deb.sh            (the .deb is written to ./output)

set -eu

TOP=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP="$TOP/ROX-Filer"
OUT="$TOP/output"
VERSION=$(sed -n 's/.*<Version>\([0-9.]*\)<\/Version>.*/\1/p' "$APP/AppInfo.xml" | head -n 1)
DEB_VERSION="${VERSION}-1"
ARCH=$(dpkg --print-architecture)
PKG="rox-filer1"
STAGE="$OUT/${PKG}_${DEB_VERSION}_${ARCH}"

echo "Building $PKG $DEB_VERSION for $ARCH"

# 1. Compile
cd "$APP/src"
if [ ! -x configure ] || [ configure.in -nt configure ]; then
	autoconf
fi
rm -rf "$APP/build"
mkdir -p "$APP/build"
cd "$APP/build"
"$APP/src/configure" --quiet
make -j"$(nproc 2>/dev/null || echo 2)"

# 2. Translations
cd "$APP/src/po"
for po in *.po; do
	./make-mo "${po%.po}" >/dev/null
done

# 3. Manual (HTML for Help -> Manual, and the rox(1) man page). Needs
#    xsltproc and docbook-xsl; skipped if they're missing.
MANPAGE=""
if command -v xsltproc >/dev/null 2>&1; then
	cd "$APP/src/Docs"
	for m in Manual Manual-fr Manual-it; do
		xsltproc --nonet -o "$APP/Help/$m.html" to_html.xsl "$m.xml" \
			2>/dev/null || rm -f "$APP/Help/$m.html"
	done
	if xsltproc --nonet -o "$OUT/rox.1" to_man.xsl Manual.xml 2>/dev/null
	then
		MANPAGE="$OUT/rox.1"
	fi
fi

# 4. Stage the package
rm -rf "$STAGE"
LIB="$STAGE/usr/lib/rox1/ROX-Filer"
mkdir -p "$LIB" "$STAGE/usr/bin" "$STAGE/usr/share/applications" \
	 "$STAGE/usr/share/pixmaps" "$STAGE/usr/share/doc/$PKG" "$STAGE/DEBIAN"

cd "$APP"
cp -a AppRun AppInfo.xml Options.xml Templates.ui style.css subclasses \
      .DirIcon Help Messages ROX images ROX-Filer "$LIB/"
rm -f "$LIB/Messages/README"
cp .DirIcon "$STAGE/usr/share/pixmaps/rox-filer1.png"

# The command is "rox1", so this can be installed alongside Rox-Filer2
# (which has its own "rox" command).
cat > "$STAGE/usr/bin/rox1" <<'EOF'
#!/bin/sh
exec /usr/lib/rox1/ROX-Filer/AppRun "$@"
EOF
chmod 755 "$STAGE/usr/bin/rox1"

cat > "$STAGE/usr/share/applications/rox-filer1.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=ROX-Filer 1
GenericName=File Manager
Comment=The classic ROX-Filer, on GTK 3
Exec=rox1 %U
Icon=rox-filer1
Terminal=false
Categories=System;FileTools;FileManager;GTK;
MimeType=inode/directory;
EOF

if [ -n "$MANPAGE" ]; then
	mkdir -p "$STAGE/usr/share/man/man1"
	gzip -9n < "$MANPAGE" > "$STAGE/usr/share/man/man1/rox1.1.gz"
	rm -f "$MANPAGE"
fi

cp "$TOP/README-GTK3.md" "$STAGE/usr/share/doc/$PKG/" 2>/dev/null || true
cp "$APP/Help/COPYING" "$STAGE/usr/share/doc/$PKG/copyright" 2>/dev/null || true

# 5. Dependencies, worked out from the libraries the program uses
mkdir -p "$OUT/shlibs/debian"
cat > "$OUT/shlibs/debian/control" <<EOF
Source: $PKG

Package: $PKG
Architecture: any
EOF
DEPENDS=$(cd "$OUT/shlibs" && dpkg-shlibdeps -O "$LIB/ROX-Filer" 2>/dev/null \
	| sed -n 's/^shlibs:Depends=//p')
rm -rf "$OUT/shlibs"
[ -n "$DEPENDS" ] || DEPENDS="libgtk-3-0t64 | libgtk-3-0, libxml2, libsm6, libice6, libx11-6"
SIZE=$(du -sk "$STAGE/usr" | cut -f1)

cat > "$STAGE/DEBIAN/control" <<EOF
Package: $PKG
Version: $DEB_VERSION
Architecture: $ARCH
Maintainer: ROX-Filer GTK 3 <rox@localhost>
Installed-Size: $SIZE
Depends: $DEPENDS, shared-mime-info
Recommends: yaru-theme-icon
Conflicts: rox-filer (<< 2.12)
Suggests: xterm
Section: utils
Priority: optional
Homepage: http://rox.sourceforge.net
Description: fast, simple graphical file manager (GTK 3 version)
 ROX-Filer is a fast and powerful graphical file manager, originally part
 of the ROX desktop. This version is ported from GTK 2 to GTK 3 so that it
 builds and runs on current Debian and Ubuntu releases.
 .
 It adds a side pane of places (Home, Documents, Downloads, bookmarks and
 drives) and a terminal panel (F4) that follows the current folder,
 uses the Yaru-red-dark icon theme by default when it is
 installed, and has wide scrollbars and larger toolbar icons. The pinboard
 and panels of the original are not included.
 .
 The command is "rox1", so this package can be installed alongside
 Rox-Filer2. It keeps its settings in Options-gtk3.
EOF

find "$STAGE" -type d -exec chmod 755 {} +
dpkg-deb --root-owner-group --build "$STAGE" "$OUT/${PKG}_${DEB_VERSION}_${ARCH}.deb"
rm -rf "$STAGE"
echo
echo "Done: $OUT/${PKG}_${DEB_VERSION}_${ARCH}.deb"
