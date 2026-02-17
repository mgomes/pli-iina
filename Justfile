set shell := ["bash", "-cu"]

# Package the IINA plugin as an installable .iinaplgz file.
pack:
	/Applications/IINA.app/Contents/MacOS/iina-plugin pack .
