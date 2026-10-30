import pymupdf
import os

SRC = "Southern Farmhouse - Drawing Set - Jay Osborne 2023-02-01.pdf"
OUT = "southern-farmhouse"
PNG_DIR = os.path.join(OUT, "png")
SVG_DIR = os.path.join(OUT, "svg")
os.makedirs(PNG_DIR, exist_ok=True)
os.makedirs(SVG_DIR, exist_ok=True)

doc = pymupdf.open(SRC)
print(f"pages: {len(doc)}")
for i, page in enumerate(doc):
    n = f"{i + 1:02d}"
    pix = page.get_pixmap(matrix=pymupdf.Matrix(200 / 72, 200 / 72))
    png_path = os.path.join(PNG_DIR, f"page-{n}.png")
    pix.save(png_path)
    svg = page.get_svg_image()
    svg_path = os.path.join(SVG_DIR, f"page-{n}.svg")
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(svg)
    print(f"page {n}: {os.path.getsize(png_path)} B png, {os.path.getsize(svg_path)} B svg")
doc.close()
print("done")
