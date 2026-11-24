#!/usr/bin/env python3
"""Builds the optional slideshow video of the "internet" demonstration lesson.

Original slides drawn with Pillow (app palette), one per paragraph of the narration, switched
at the paragraph's first segment start (read from timing.json, written by build-audio.py).
The soundtrack is the lesson's own audio.mp3, so captions and transcript times stay valid.

Run build-audio.py first, then:  python scripts/demo-lessons/build-video.py
and build-audio.py again so lesson.json records the video's size.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
FOLDER = ROOT / "database" / "demo-lessons" / "internet"
FFMPEG = Path(os.environ.get("FFMPEG_PATH", ROOT / "backend/node_modules/ffmpeg-static/ffmpeg"))

W, H = 1280, 720
LAVENDER = "#8f7ec7"
MATCHA = "#9bb08a"
HONEY = "#e3b866"
ROSE = "#e2a3b0"
INK = "#2b2840"
PAPER = "#f7f5fb"
SOFT_INK = "#5d5878"
LINE = "#ddd8ea"
WHITE = "#ffffff"

FONT_DIRS = [Path("/usr/share/fonts/opentype/inter"), Path("/usr/share/fonts/truetype/dejavu")]
FONT_FILES = {
    "regular": ["Inter-Regular.otf", "DejaVuSans.ttf"],
    "semibold": ["Inter-SemiBold.otf", "DejaVuSans-Bold.ttf"],
    "bold": ["Inter-Bold.otf", "DejaVuSans-Bold.ttf"],
}


def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    for name in FONT_FILES[weight]:
        for folder in FONT_DIRS:
            path = folder / name
            if path.exists():
                return ImageFont.truetype(str(path), size)
    raise SystemExit("Nenhuma fonte Inter ou DejaVu encontrada.")


STEPS = ["DNS", "Pedido HTTP", "Pacotes", "Roteadores", "TCP e HTML"]


class Slide:
    def __init__(self, step: int | None, title: str):
        self.img = Image.new("RGB", (W, H), PAPER)
        self.d = ImageDraw.Draw(self.img)
        self.header(step, title)

    def header(self, step, title):
        d = self.d
        d.rectangle([0, 0, W, 10], fill=LAVENDER)
        # step tracker
        x = 64
        for i, name in enumerate(STEPS):
            active = step == i
            done = step is not None and i < step
            fill = LAVENDER if active else (MATCHA if done else WHITE)
            outline = LAVENDER if active else (MATCHA if done else LINE)
            d.rounded_rectangle([x, 34, x + 30, 64], radius=15, fill=fill, outline=outline, width=2)
            d.text(
                (x + 15, 49),
                str(i + 1),
                font=font("bold", 16),
                fill=WHITE if (active or done) else SOFT_INK,
                anchor="mm",
            )
            d.text(
                (x + 40, 49),
                name,
                font=font("semibold", 17),
                fill=INK if active else SOFT_INK,
                anchor="lm",
            )
            x += 48 + int(d.textlength(name, font=font("semibold", 17))) + 26
        d.text((64, 104), title, font=font("bold", 44), fill=INK, anchor="lm")
        d.line([64, 140, 220, 140], fill=HONEY, width=5)

    def box(
        self,
        xy,
        text,
        fill=WHITE,
        outline=LAVENDER,
        size=26,
        weight="semibold",
        color=INK,
        radius=22,
    ):
        self.d.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=3)
        cx, cy = (xy[0] + xy[2]) / 2, (xy[1] + xy[3]) / 2
        self.d.multiline_text(
            (cx, cy),
            text,
            font=font(weight, size),
            fill=color,
            anchor="mm",
            align="center",
            spacing=8,
        )

    def arrow(self, a, b, color=INK, width=4, label=None, label_side=-1):
        d = self.d
        d.line([a, b], fill=color, width=width)
        import math

        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        size = 16
        p1 = (b[0] - size * math.cos(ang - 0.45), b[1] - size * math.sin(ang - 0.45))
        p2 = (b[0] - size * math.cos(ang + 0.45), b[1] - size * math.sin(ang + 0.45))
        d.polygon([b, p1, p2], fill=color)
        if label:
            mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + label_side * 24
            d.text((mx, my), label, font=font("regular", 21), fill=SOFT_INK, anchor="mm")

    def note(self, xy, text, size=24, color=SOFT_INK, weight="regular", anchor="la"):
        self.d.multiline_text(
            xy, text, font=font(weight, size), fill=color, anchor=anchor, spacing=10
        )

    def footer(self, text):
        self.d.rounded_rectangle([64, 626, W - 64, 686], radius=18, fill="#efeaf8")
        self.d.text((88, 656), text, font=font("semibold", 23), fill=INK, anchor="lm")


def slide_intro():
    s = Slide(None, "Como a internet entrega uma página")
    s.note(
        (64, 176),
        "Do endereço digitado no navegador até a página na tela,\nem menos de um segundo — e em várias etapas.",
        size=28,
    )
    colors = [LAVENDER, HONEY, ROSE, MATCHA, LAVENDER]
    x = 64
    for i, (name, color) in enumerate(zip(STEPS, colors)):
        s.box([x, 330, x + 206, 470], f"{i + 1}\n{name}", outline=color, size=26)
        if i < 4:
            s.arrow((x + 210, 400), (x + 236, 400), color=SOFT_INK, width=3)
        x += 232
    s.footer("Vamos seguir esse caminho passo a passo.")
    return s.img


def slide_dns():
    s = Slide(0, "1. DNS: do nome ao número")
    s.box([64, 200, 274, 300], "Navegador", outline=LAVENDER)
    s.box([570, 200, 790, 300], "Servidor DNS", outline=HONEY)
    s.arrow((282, 235), (562, 235), label="qual é o IP deste nome?")
    s.arrow((562, 270), (282, 270), label="endereço IP", label_side=1)
    # hierarchy
    s.box([900, 168, 1150, 226], "outros servidores", outline=LINE, size=21, weight="regular")
    s.box([900, 248, 1150, 306], "outros servidores", outline=LINE, size=21, weight="regular")
    s.arrow((796, 240), (894, 200), color=SOFT_INK, width=3)
    s.arrow((796, 260), (894, 276), color=SOFT_INK, width=3)
    s.note((900, 318), "consulta numa hierarquia,\naté achar a resposta", size=20)
    s.box([64, 380, 600, 560], "", outline=LAVENDER, fill=WHITE)
    s.note((92, 400), "Endereço IP", size=28, color=INK, weight="bold")
    s.note(
        (92, 446), "Identifica um aparelho conectado\nà rede, como o endereço de uma casa.", size=24
    )
    s.box([660, 380, 1216, 560], "", outline=HONEY, fill=WHITE)
    s.note((688, 400), "Cache", size=28, color=INK, weight="bold")
    s.note(
        (688, 446), "As respostas ficam guardadas por\num período, para economizar tempo.", size=24
    )
    s.footer("DNS = sistema de nomes de domínio: uma lista telefônica distribuída pelo mundo.")
    return s.img


def slide_http():
    s = Slide(1, "2. O pedido: HTTP")
    s.box([64, 230, 340, 350], "Navegador", outline=LAVENDER)
    s.box([940, 230, 1216, 350], "Servidor\ndo site", outline=MATCHA)
    s.arrow((346, 262), (934, 262), label="pedido: “por favor, me envie esta página”")
    s.arrow((934, 318), (346, 318), label="resposta: a página + um código", label_side=1)
    s.box([64, 420, 600, 580], "", outline=LAVENDER)
    s.note((92, 440), "Protocolo", size=28, color=INK, weight="bold")
    s.note((92, 486), "Regras combinadas. Na web: HTTP;\ncom criptografia: HTTPS.", size=24)
    s.box([660, 420, 1216, 580], "", outline=ROSE)
    s.note((688, 440), "Código 404", size=28, color=INK, weight="bold")
    s.note((688, 486), "A página não existe:\n“página não encontrada”.", size=24)
    s.footer("Antes do pedido, o navegador abre uma conexão com o servidor.")
    return s.img


def envelope(s, x, y, n, color):
    s.d.rounded_rectangle([x, y, x + 150, y + 96], radius=12, fill=WHITE, outline=color, width=3)
    s.d.line([x + 8, y + 4, x + 75, y + 44, x + 142, y + 4], fill=color, width=3, joint="curve")
    s.d.text((x + 75, y + 72), f"nº {n}", font=font("bold", 22), fill=INK, anchor="mm")


def slide_packets():
    s = Slide(2, "3. A resposta viaja em pacotes")
    s.box([64, 190, 300, 420], "página\ninteira", outline=LAVENDER, size=28)
    s.arrow((310, 305), (420, 305), color=SOFT_INK)
    colors = [LAVENDER, HONEY, ROSE, MATCHA]
    for i in range(4):
        envelope(s, 440 + (i % 2) * 180, 190 + (i // 2) * 124, i + 1, colors[i])
    s.box([840, 190, 1216, 420], "", outline=HONEY)
    s.note((866, 210), "Cabeçalho", size=28, color=INK, weight="bold")
    s.note((866, 258), "• endereço de origem\n• endereço de destino\n• número de ordem", size=24)
    s.note(
        (64, 470),
        "Se um pacote se perde no caminho, só ele é enviado de novo —\nnão a página inteira.",
        size=27,
        color=INK,
    )
    s.footer("Como uma carta com envelope numerado.")
    return s.img


def slide_routers():
    s = Slide(3, "4. Roteadores levam cada pacote")
    nodes = {
        "A": (330, 260),
        "B": (560, 200),
        "C": (560, 380),
        "D": (800, 260),
        "E": (800, 440),
    }
    s.box([64, 260, 230, 360], "Servidor", outline=MATCHA, size=24)
    s.box([1030, 300, 1216, 400], "Seu\ncomputador", outline=LAVENDER, size=24)
    edges = [("A", "B"), ("A", "C"), ("B", "D"), ("C", "D"), ("C", "E"), ("D", "E")]
    for a, b in edges:
        s.d.line([nodes[a], nodes[b]], fill=LINE, width=6)
    s.d.line([(230, 310), nodes["A"]], fill=LINE, width=6)
    s.d.line([nodes["D"], (1030, 340)], fill=LINE, width=6)
    s.d.line([nodes["E"], (1030, 370)], fill=LINE, width=6)
    # two paths
    for path, color in ((["A", "B", "D"], HONEY), (["A", "C", "E"], ROSE)):
        pts = [nodes[p] for p in path]
        s.d.line(pts, fill=color, width=5)
    s.d.line([nodes["D"], (1030, 340)], fill=HONEY, width=5)
    s.d.line([nodes["E"], (1030, 370)], fill=ROSE, width=5)
    for name, (x, y) in nodes.items():
        s.d.ellipse([x - 30, y - 30, x + 30, y + 30], fill=WHITE, outline=LAVENDER, width=4)
        s.d.text((x, y), "R", font=font("bold", 24), fill=INK, anchor="mm")
    s.note(
        (64, 500),
        "Cada roteador lê o destino e escolhe só o próximo passo.\nCom uma rota congestionada, pacotes da mesma página seguem\ncaminhos diferentes e podem chegar fora de ordem.",
        size=25,
        color=INK,
    )
    s.footer("Como um carteiro que entrega a carta para a próxima agência.")
    return s.img


def slide_tcp():
    s = Slide(4, "5. O TCP remonta, o navegador pede o resto")
    colors = {1: LAVENDER, 2: HONEY, 3: ROSE}
    for i, n in enumerate([3, 1, 2]):
        envelope(s, 64 + i * 170, 200, n, colors[n])
    s.arrow((590, 248), (680, 248), color=SOFT_INK, label="TCP", label_side=-1)
    for i, n in enumerate([1, 2, 3]):
        envelope(s, 700 + i * 170, 200, n, colors[n])
    s.note(
        (64, 330),
        "Põe os pacotes em ordem, confere se algum faltou e pede de novo os perdidos.",
        size=24,
        color=INK,
    )
    s.box([64, 400, 330, 540], "HTML\n(código da página)", outline=LAVENDER, size=24)
    s.box([520, 390, 760, 456], "imagens", outline=MATCHA, size=23)
    s.box([520, 484, 760, 550], "folhas de estilo", outline=MATCHA, size=23)
    s.arrow((336, 450), (514, 423), color=SOFT_INK, width=3, label="novo pedido")
    s.arrow((336, 490), (514, 517), color=SOFT_INK, width=3)
    s.note((800, 430), "Para cada arquivo,\no pedido e a resposta\nse repetem.", size=24)
    s.footer("Só então a página aparece completa na tela.")
    return s.img


def slide_recap():
    s = Slide(len(STEPS), "Recapitulando")
    items = [
        ("DNS", "traduz o nome em endereço IP", LAVENDER),
        ("HTTP", "o navegador faz o pedido", HONEY),
        ("Pacotes", "a resposta é dividida em pedaços", ROSE),
        ("Roteadores", "encaminham cada pacote", MATCHA),
        ("TCP", "remonta tudo no destino", LAVENDER),
    ]
    for i, (name, text, color) in enumerate(items):
        y = 180 + i * 84
        s.d.ellipse([64, y, 124, y + 60], fill=color)
        s.d.text((94, y + 30), str(i + 1), font=font("bold", 26), fill=WHITE, anchor="mm")
        s.d.text((150, y + 30), name, font=font("bold", 30), fill=INK, anchor="lm")
        s.d.text((390, y + 30), text, font=font("regular", 28), fill=SOFT_INK, anchor="lm")
    s.footer("Voz em Estudo · aula de demonstração · roteiro original")
    return s.img


SLIDES = [slide_intro, slide_dns, slide_http, slide_packets, slide_routers, slide_tcp, slide_recap]


def main() -> None:
    timing = json.loads((FOLDER / "timing.json").read_text())
    duration = float(
        subprocess.run(
            [
                str(FFMPEG).replace("ffmpeg-static/ffmpeg", "ffprobe-static/bin/linux/x64/ffprobe"),
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
                str(FOLDER / "audio.mp3"),
            ],
            capture_output=True,
            check=True,
        )
        .stdout.decode()
        .strip()
    )
    starts = {}
    for seg in timing:
        starts.setdefault(seg["paragraph"], seg["startMs"])
    paragraphs = sorted(starts)
    if len(paragraphs) != len(SLIDES):
        raise SystemExit(f"{len(paragraphs)} parágrafos, {len(SLIDES)} slides")
    # Each slide appears a moment before its paragraph starts (inside the pause).
    cuts = [0.0] + [max(0.0, starts[p] / 1000 - 0.3) for p in paragraphs[1:]] + [duration]
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        lines = []
        for i, make in enumerate(SLIDES):
            path = tmpdir / f"slide{i}.png"
            make().save(path)
            lines.append(f"file '{path}'\nduration {cuts[i + 1] - cuts[i]:.3f}\n")
        lines.append(f"file '{tmpdir / f'slide{len(SLIDES) - 1}.png'}'\n")
        concat = tmpdir / "slides.txt"
        concat.write_text("".join(lines))
        if os.environ.get("KEEP_SLIDES"):  # a folder to copy the slide PNGs into, for review
            preview = Path(os.environ["KEEP_SLIDES"])
            preview.mkdir(parents=True, exist_ok=True)
            for i in range(len(SLIDES)):
                (preview / f"slide{i}.png").write_bytes((tmpdir / f"slide{i}.png").read_bytes())
        subprocess.run(
            [
                str(FFMPEG),
                "-y",
                "-loglevel",
                "error",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat),
                "-i",
                str(FOLDER / "audio.mp3"),
                "-map",
                "0:v",
                "-map",
                "1:a",
                "-vf",
                "fps=10,format=yuv420p",
                "-c:v",
                "libx264",
                "-preset",
                "slow",
                "-tune",
                "stillimage",
                "-crf",
                "24",
                "-g",
                "50",
                "-c:a",
                "aac",
                "-b:a",
                "80k",
                "-ac",
                "1",
                "-ar",
                "44100",
                "-t",
                f"{duration:.3f}",
                "-movflags",
                "+faststart",
                "-map_metadata",
                "-1",
                str(FOLDER / "video.mp4"),
            ],
            check=True,
        )
    print(f"video.mp4: {(FOLDER / 'video.mp4').stat().st_size} bytes, {duration:.1f} s")


if __name__ == "__main__":
    main()
