#!/usr/bin/env python3
"""
Génère un PDF de toutes les textures WebP Parkland avec légendes.
Organisé par type de terrain, 4 colonnes par page A4.
"""

from fpdf import FPDF
from PIL import Image
import os, re, math
from collections import defaultdict

ROOT = '/home/roden/simgolf-web/public/assets/textures/parkland'
OUTPUT = '/home/roden/simgolf-web/parkland_textures.pdf'

# ---- Collecte des textures ----
by_type = defaultdict(list)
types_order = []  # preserve directory order

for dirpath, dirs, files in os.walk(ROOT):
    type_name = os.path.basename(dirpath)
    if not files:
        continue
    types_order.append(type_name)
    for f in sorted(files):
        if not f.endswith('.webp'):
            continue
        by_type[type_name].append({
            'file': f,
            'path': os.path.join(dirpath, f),
            'caption': f.replace('.webp', ''),
        })


class TexturePDF(FPDF):
    def __init__(self):
        super().__init__('P', 'mm', 'A4')
        self.set_auto_page_break(True, 15)
        self.textures_per_row = 4
        self.cell_w = 48  # mm per cell (A4 width ~190mm usable)
        self.cell_h = 52  # mm per cell (image + caption)

    def header(self):
        self.set_font('Helvetica', 'B', 10)
        self.cell(0, 6, 'SimGolf Parkland - Textures de terrain', align='C', new_x='LMARGIN', new_y='NEXT')
        self.ln(2)

    def footer(self):
        self.set_y(-12)
        self.set_font('Helvetica', 'I', 8)
        self.cell(0, 6, f'Page {self.page_no()}/{{nb}}', align='C')

    def add_type_page(self, type_name, textures):
        """Ajoute une ou plusieurs pages pour un type de terrain."""
        # Type title
        self.set_font('Helvetica', 'B', 14)
        title = f'{type_name.upper()} ({len(textures)} textures)'
        self.cell(0, 8, title, align='L', new_x='LMARGIN', new_y='NEXT')
        self.ln(2)

        # Subtitle with caption legend
        self.set_font('Helvetica', 'I', 8)
        suffixes = sorted(set(
            re.match(r'[A-Z]+(\d*)([A-E])\d{4}', t['caption'])
            and re.match(r'[A-Z]+(\d*)([A-E])\d{4}', t['caption']).group(2)
            or '?' for t in textures if re.match(r'[A-Z]+(\d*)([A-E])\d{4}', t['caption'])
        ))
        num_info = ', '.join(f'Suffixe {s}' for s in suffixes) if suffixes else ''
        variants = len(set(
            re.match(r'[A-Z]+(\d*)([A-E])(\d{4})', t['caption'])
            and re.match(r'[A-Z]+(\d*)([A-E])(\d{4})', t['caption']).group(3)
            or '?' for t in textures if re.match(r'[A-Z]+(\d*)([A-E])(\d{4})', t['caption'])
        ))
        self.cell(0, 5, f'Suffixes: {num_info}  |  Variations: {variants}', align='L',
                   new_x='LMARGIN', new_y='NEXT')
        self.ln(3)

        # Legend
        self.set_font('Helvetica', '', 7)
        legend = 'Nomenclature: PREFIXE[Suffixe][Variation4]  |  Ex: ROUGHA0003 = Rough, suffixe A (plat), variation 3'
        self.cell(0, 4, legend, align='L', new_x='LMARGIN', new_y='NEXT')
        self.ln(1)
        legend2 = 'Suffixes: A=plat B=pente N C=pente E D=pente S E=pente raide | Bordures: A=Nord B=Est C=Sud D=Ouest'
        self.cell(0, 4, legend2, align='L', new_x='LMARGIN', new_y='NEXT')
        self.ln(4)

        cols = self.textures_per_row
        img_size = self.cell_w

        for i, tex in enumerate(textures):
            col = i % cols
            row = i // cols

            x = self.l_margin + col * (img_size + 4)
            y = self.get_y()  # will be adjusted at row start

            if col == 0:
                # Starting a new row
                y = self.get_y()
                if y + self.cell_h > self.h - self.b_margin:
                    self.add_page()
                    # Re-print title on continued page
                    self.set_font('Helvetica', 'B', 12)
                    self.cell(0, 6, f'{type_name.upper()} (suite)', align='L',
                              new_x='LMARGIN', new_y='NEXT')
                    self.ln(3)
                    y = self.get_y()
            else:
                y = self.get_y() - self.cell_h

            # Place image
            img_x = x + (img_size - 24) / 2  # center 24mm image in 48mm cell
            try:
                self.image(tex['path'], x=img_x, y=y, w=24, h=24)
            except Exception as e:
                print(f"  Erreur chargement {tex['file']}: {e}")
                self.set_font('Helvetica', '', 6)
                self.set_xy(x + 2, y + 8)
                self.cell(img_size - 4, 10, '[ERR]', align='C')

            # Caption
            self.set_font('Courier', '', 6)
            cap_x = x
            cap_y = y + 26
            self.set_xy(cap_x + 1, cap_y)
            self.cell(img_size - 2, 8, tex['caption'], align='C')

            # After placing all items in row, advance to next row
            if col == cols - 1 or i == len(textures) - 1:
                self.set_y(self.get_y() + self.cell_h)
                if self.get_y() + self.cell_h > self.h - self.b_margin:
                    self.add_page()
                    self.set_font('Helvetica', 'B', 12)
                    self.cell(0, 6, f'{type_name.upper()} (suite)', align='L',
                              new_x='LMARGIN', new_y='NEXT')
                    self.ln(3)


# ---- Génération ----
pdf = TexturePDF()
pdf.alias_nb_pages()

for type_name in sorted(by_type.keys()):
    textures = by_type[type_name]
    print(f"Page: {type_name} ({len(textures)} textures)")
    pdf.add_page()
    pdf.add_type_page(type_name, textures)

pdf.output(OUTPUT)
print(f"\n✅ PDF généré: {OUTPUT}")
print(f"Pages: {pdf.page_no()}, Types: {len(by_type)}, Textures: {sum(len(v) for v in by_type.values())}")
