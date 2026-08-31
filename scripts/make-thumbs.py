#!/usr/bin/env python3
"""Broadcast slates for Cuecast demo events — geometric, no people, no logos."""
from __future__ import annotations

import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

OUT = "/workspace/public/thumbs"
W, H = 1600, 900
RED = (225, 29, 46)
CREAM = (243, 238, 230)
MUTED = (154, 145, 136)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    path = (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    )
    return ImageFont.truetype(path, size)


def grain(img: Image.Image, amount: float = 0.08) -> Image.Image:
    arr = np.asarray(img).astype(np.float32)
    noise = np.random.default_rng(7).normal(0, 18, arr.shape).astype(np.float32)
    mixed = np.clip(arr + noise * amount * 10, 0, 255).astype(np.uint8)
    return Image.fromarray(mixed, "RGB")


def vignette(img: Image.Image, strength: float = 0.55) -> Image.Image:
    x = np.linspace(-1, 1, W)
    y = np.linspace(-1, 1, H)
    xx, yy = np.meshgrid(x, y)
    r = np.sqrt(xx * xx * 0.7 + yy * yy)
    mask = np.clip(1 - (r - 0.2) * strength, 0.35, 1)
    arr = np.asarray(img).astype(np.float32)
    arr *= mask[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def base(rgb: tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGB", (W, H), rgb)
    overlay = Image.new("RGB", (W, H), (0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for i in range(8):
        c = 8 + i * 2
        draw.ellipse(
            (-200 + i * 40, -120 + i * 20, W + 80, H + 200),
            fill=(c, c - 2, c - 4),
        )
    return Image.blend(img, overlay, 0.35)


def tally(draw: ImageDraw.ImageDraw, live: bool) -> None:
    draw.rounded_rectangle((48, 44, 48 + 18, 44 + 18), 3, fill=RED)
    label = "ON AIR" if live else "SLATE"
    draw.text((78, 42), label, font=font(22, True), fill=RED if live else MUTED)


def type_block(draw: ImageDraw.ImageDraw, title: str, meta: str, y: int = 620) -> None:
    draw.text((56, y), title, font=font(44, True), fill=CREAM)
    draw.text((56, y + 70), meta, font=font(22), fill=MUTED)
    draw.rectangle((56, y - 18, 56 + 72, y - 12), fill=RED)


def night_shift() -> Image.Image:
    img = base((10, 14, 20))
    d = ImageDraw.Draw(img, "RGBA") if False else ImageDraw.Draw(img)
    # two monitor rectangles with cool glow
    for x, y, w, h in ((430, 210, 340, 210), (800, 218, 340, 210)):
        glow = Image.new("RGB", (W, H), (0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gd.rounded_rectangle((x - 30, y - 30, x + w + 30, y + h + 30), 8, fill=(40, 90, 130))
        glow = glow.filter(ImageFilter.GaussianBlur(28))
        img = Image.blend(img, glow, 0.28)
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((x, y, x + w, y + h), 6, fill=(18, 28, 38), outline=(70, 110, 140), width=2)
        d.rectangle((x + 18, y + 18, x + w - 18, y + h - 28), fill=(8, 16, 24))
        # scanlines as geometry
        for i in range(8):
            yy = y + 30 + i * 18
            d.rectangle((x + 28, yy, x + w - 28, yy + 4), fill=(36, 72, 96))
    d.rectangle((430, 430, 1140, 442), fill=(28, 28, 30))  # desk line
    tally(d, True)
    type_block(d, "Night Shift: Shipping in Public", "02:00  ·  Desk 1  ·  LIVE")
    return vignette(grain(img, 0.1))


def founder_ama() -> Image.Image:
    img = base((22, 16, 12))
    d = ImageDraw.Draw(img)
    # two chair-like blocks, a table, a red lamp as geometry
    d.rounded_rectangle((430, 360, 670, 560), 18, fill=(72, 42, 28))
    d.rounded_rectangle((930, 360, 1170, 560), 18, fill=(72, 42, 28))
    d.rectangle((520, 430, 1080, 470), fill=(92, 58, 36))
    # lamp
    d.ellipse((776, 250, 824, 298), fill=RED)
    d.rectangle((796, 298, 804, 430), fill=(40, 20, 16))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((680, 160, 920, 400), fill=(180, 40, 40))
    glow = glow.filter(ImageFilter.GaussianBlur(40))
    img = Image.blend(img, glow, 0.22)
    d = ImageDraw.Draw(img)
    tally(d, False)
    type_block(d, "Founder AMA: From Calendar to Air", "01:15  ·  Studio B")
    return vignette(grain(img, 0.09))


def design_desk() -> Image.Image:
    img = base((20, 18, 14))
    d = ImageDraw.Draw(img)
    # sheets as rectangles
    papers = [
        (280, 180, 720, 620, (232, 224, 210)),
        (640, 210, 1080, 650, (236, 228, 214)),
        (980, 160, 1380, 560, (228, 220, 206)),
    ]
    for x0, y0, x1, y1, c in papers:
        d.rectangle((x0, y0, x1, y1), fill=c)
        d.rectangle((x0 + 28, y0 + 36, x1 - 28, y0 + 48), fill=(40, 36, 32))
        for i in range(5):
            d.rectangle((x0 + 28, y0 + 80 + i * 28, x1 - 80, y0 + 88 + i * 28), fill=(180, 170, 158))
    d.rectangle((240, 700, 1360, 720), fill=(48, 36, 24))
    tally(d, False)
    type_block(d, "Design Desk: Thumbnail Critique", "00:45  ·  Edit bay", y=760)
    return vignette(grain(img, 0.07), 0.4)


def launch_window() -> Image.Image:
    img = base((8, 8, 8))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((560, -40, 1040, 520), fill=(255, 214, 150))
    gd.polygon([(800, 80), (560, 900), (1040, 900)], fill=(255, 200, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(18))
    img = Image.blend(img, glow, 0.38)
    d = ImageDraw.Draw(img)
    d.ellipse((780, 70, 820, 110), fill=(255, 240, 210))
    d.rectangle((0, 820, W, H), fill=(12, 10, 10))
    tally(d, False)
    type_block(d, "Launch Window: Cuecast 1.0", "01:30  ·  Main stage")
    return vignette(grain(img, 0.11), 0.7)


def studio_recap() -> Image.Image:
    img = base((12, 14, 16))
    d = ImageDraw.Draw(img)
    # a bank of monitors
    rng = random.Random(3)
    for row, y in enumerate((180, 360)):
        for col in range(5):
            x = 180 + col * 250
            d.rounded_rectangle((x, y, x + 230, y + 150), 4, fill=(16, 18, 20), outline=(50, 54, 58), width=2)
            inner = (20 + col * 8, 28 + row * 10, 36)
            d.rectangle((x + 10, y + 10, x + 220, y + 128), fill=inner)
            if col == 2 and row == 0:
                d.rectangle((x + 8, y + 8, x + 14, y + 18), fill=RED)
    d.rectangle((160, 540, 1440, 556), fill=(28, 30, 32))
    tally(d, False)
    type_block(d, "Studio Recap: Week in Review", "00:50  ·  Control room")
    return vignette(grain(img, 0.1))


def save(name: str, img: Image.Image) -> None:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    img = ImageEnhance.Contrast(img).enhance(1.08)
    img = ImageEnhance.Color(img).enhance(0.92)
    img.save(path, "JPEG", quality=88, optimize=True)
    print("wrote", path, img.size)


if __name__ == "__main__":
    save("night-shift.jpg", night_shift())
    save("founder-ama.jpg", founder_ama())
    save("design-desk.jpg", design_desk())
    save("launch-window.jpg", launch_window())
    save("studio-recap.jpg", studio_recap())
