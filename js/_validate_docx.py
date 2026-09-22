import zipfile, xml.dom.minidom as M, sys
z=zipfile.ZipFile(sys.argv[1])
bad=z.testzip()
print('ZIP_OK' if bad is None else 'ZIP_BAD')
print('PARTS=' + str(len(z.namelist())))
[M.parseString(z.read(n)) for n in z.namelist() if n.endswith('.xml')]
print('XML_OK')
