#!/usr/bin/env python3
"""Builds the narration of the demonstration lessons and their ground-truth timestamps.

For each lesson in database/demo-lessons/<slug>/:
  script.json  narration source (paragraphs -> segments -> sentences)
  study.json   summary, questions and flashcards written by the team (evidence = literal quotes)
produces:
  audio.mp3    mono, 44.1 kHz, 64 kbps
  lesson.json  canonical file read by the seed (segments with times measured from the samples)

Pipeline per sentence: espeak-ng (text -> MBROLA phonemes, --pho) -> phoneme fixes for diphones
the Brazilian voices lack -> mbrola (phonemes -> 16 kHz WAV). The sentences are trimmed of
their own silence and joined with fixed pauses, so every segment's start and end come from the
real sample counts. Nothing here calls a network service; the output is deterministic for the
same espeak-ng/MBROLA/ffmpeg versions.

Usage: python scripts/demo-lessons/build-audio.py [slug ...]
"""

from __future__ import annotations

import array
import json
import os
import re
import subprocess
import sys
import tempfile
import wave
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LESSONS = ROOT / "database" / "demo-lessons"
FFMPEG = Path(os.environ.get("FFMPEG_PATH", ROOT / "backend/node_modules/ffmpeg-static/ffmpeg"))
FFPROBE = Path(
    os.environ.get(
        "FFPROBE_PATH",
        ROOT / "backend/node_modules/ffprobe-static/bin/linux/x64/ffprobe",
    )
)
MBROLA_DIR = Path(os.environ.get("MBROLA_DIR", "/usr/share/mbrola"))

RATE = 16000  # MBROLA br1/br4 sample rate
LEAD_MS = 400  # silence before the first sentence
TAIL_MS = 600  # silence after the last sentence
SENTENCE_GAP_MS = 320  # between sentences of one segment
SEGMENT_GAP_MS = 420  # between segments of one paragraph
PARAGRAPH_GAP_MS = 750  # between paragraphs
TRIM_THRESHOLD = 300  # |sample| above this counts as speech when trimming
TRIM_PAD_MS = 25  # silence kept around each trimmed sentence
VOLUME = 0.8  # mbrola volume ratio (1.0 clips on some diphones)

CREDITS = (
    "Roteiro original da equipe Voz em Estudo. Narração sintetizada "
    "(espeak-ng + MBROLA {voice}). Licença CC BY 4.0 para uso no programa de testes."
)

# Phonemes tried in place of one the voice cannot join with its neighbour. The first
# replacement whose diphones all exist wins; if none does, the pair is joined through a
# very short pause (what mbrola would do anyway, but shorter than its default recovery).
SUBSTITUTES = {
    "r": ["r2"],
    "r2": ["r"],
    "om": ["o"],
    "am": ["a"],
    "em": ["e"],
    "z": ["s2", "s"],
    "s": ["s2"],
    "on": ["o"],
    "en": ["e"],
    "in": ["i"],
    "an": ["a"],
    "un": ["u"],
}


def ms_to_samples(ms: int) -> int:
    return round(ms * RATE / 1000)


def samples_to_ms(n: int) -> float:
    return n * 1000 / RATE


@lru_cache(maxsize=None)
def diphone_ok(voice: str, left: str, right: str) -> bool:
    """True when the voice database has the left-right diphone (mbrola fails without -e)."""
    if left == "_" or right == "_":
        return True
    pho = f"_ 50\n{left} 70\n{right} 70\n_ 50\n"
    result = subprocess.run(
        ["mbrola", "-e", str(MBROLA_DIR / voice / voice), "-", "-.raw"],
        input=pho.encode(),
        capture_output=True,
        check=False,
    )
    err = result.stderr.decode(errors="replace")
    return f"{left}-{right} " not in err


def parse_pho(text: str) -> list[list[str]]:
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(";"):
            continue
        rows.append(line.split())
    return rows


def fix_pho(voice: str, rows: list[list[str]]) -> tuple[list[list[str]], list[str]]:
    """Replaces phonemes that form missing diphones; returns the rows and what was changed."""
    notes = []
    i = 0
    while i < len(rows) - 1:
        left, right = rows[i][0], rows[i + 1][0]
        if diphone_ok(voice, left, right):
            i += 1
            continue
        prev = rows[i - 1][0] if i > 0 else "_"
        nxt = rows[i + 2][0] if i + 2 < len(rows) else "_"
        fixed = False
        for sub in SUBSTITUTES.get(left, []):
            if diphone_ok(voice, prev, sub) and diphone_ok(voice, sub, right):
                notes.append(f"{left}-{right}: {left}->{sub}")
                rows[i] = [sub, *rows[i][1:]]
                fixed = True
                break
        if not fixed:
            for sub in SUBSTITUTES.get(right, []):
                if diphone_ok(voice, left, sub) and diphone_ok(voice, sub, nxt):
                    notes.append(f"{left}-{right}: {right}->{sub}")
                    rows[i + 1] = [sub, *rows[i + 1][1:]]
                    fixed = True
                    break
        if not fixed:
            notes.append(f"{left}-{right}: pausa curta")
            rows.insert(i + 1, ["_", "18"])
            i += 1
        i += 1
    return rows, notes


def synthesize(
    voice: str, rate: int, pitch: int, text: str, workdir: Path
) -> tuple[array.array, list[str]]:
    pho = subprocess.run(
        ["espeak-ng", "-v", f"mb-{voice}", "-s", str(rate), "-p", str(pitch), "-q", "--pho", text],
        capture_output=True,
        check=True,
    ).stdout.decode()
    rows, notes = fix_pho(voice, parse_pho(pho))
    pho_path = workdir / "sentence.pho"
    wav_path = workdir / "sentence.wav"
    pho_path.write_text("\n".join(" ".join(row) for row in rows) + "\n")
    result = subprocess.run(
        [
            "mbrola",
            "-e",
            "-v",
            str(VOLUME),
            str(MBROLA_DIR / voice / voice),
            str(pho_path),
            str(wav_path),
        ],
        capture_output=True,
        check=True,
    )
    for line in result.stderr.decode(errors="replace").splitlines():
        if line.strip():
            notes.append("mbrola: " + line.strip())
    with wave.open(str(wav_path)) as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1 and w.getsampwidth() == 2
        samples = array.array("h", w.readframes(w.getnframes()))
    if sys.byteorder == "big":
        samples.byteswap()
    return trim(samples), notes


def trim(samples: array.array) -> array.array:
    loud = [i for i, v in enumerate(samples) if abs(v) > TRIM_THRESHOLD]
    if not loud:
        raise ValueError("sentence produced no audible samples")
    pad = ms_to_samples(TRIM_PAD_MS)
    start = max(0, loud[0] - pad)
    end = min(len(samples), loud[-1] + 1 + pad)
    return samples[start:end]


def sentence(item) -> tuple[str, str]:
    if isinstance(item, str):
        return item, item
    return item["text"], item.get("say", item["text"])


def build(slug: str) -> dict:
    folder = LESSONS / slug
    script = json.loads((folder / "script.json").read_text())
    study_path = folder / "study.json"
    study = json.loads(study_path.read_text()) if study_path.exists() else None
    voice, rate, pitch = script["voice"], script["rate"], script["pitch"]

    audio = array.array("h", [0] * ms_to_samples(LEAD_MS))
    segments = []
    warnings = []
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        for p_index, paragraph in enumerate(script["paragraphs"]):
            if p_index:
                audio.extend([0] * ms_to_samples(PARAGRAPH_GAP_MS))
            for s_index, segment in enumerate(paragraph):
                if s_index:
                    audio.extend([0] * ms_to_samples(SEGMENT_GAP_MS))
                start = len(audio)
                texts = []
                for k, item in enumerate(segment):
                    text, say = sentence(item)
                    if k:
                        audio.extend([0] * ms_to_samples(SENTENCE_GAP_MS))
                    samples, notes = synthesize(voice, rate, pitch, say, workdir)
                    warnings.extend(f"[{slug} #{len(segments)}] {n}" for n in notes)
                    audio.extend(samples)
                    texts.append(text)
                segments.append(
                    {
                        "position": len(segments),
                        "startMs": int(samples_to_ms(start)),
                        "endMs": -(-len(audio) * 1000 // RATE),
                        "text": " ".join(texts),
                        "paragraph": p_index,
                    }
                )
        audio.extend([0] * ms_to_samples(TAIL_MS))
        if sys.byteorder == "big":
            audio.byteswap()
        wav_path = workdir / "lesson.wav"
        with wave.open(str(wav_path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(audio.tobytes())
        mp3 = folder / "audio.mp3"
        subprocess.run(
            [
                str(FFMPEG),
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(wav_path),
                "-af",
                "aresample=44100:resampler=soxr",
                "-ac",
                "1",
                "-ar",
                "44100",
                "-c:a",
                "libmp3lame",
                "-b:a",
                "64k",
                "-map_metadata",
                "-1",
                "-fflags",
                "+bitexact",
                "-flags:a",
                "+bitexact",
                str(mp3),
            ],
            check=True,
        )
    wav_ms = samples_to_ms(len(audio))
    duration_ms = probe_duration_ms(mp3)
    if abs(duration_ms - wav_ms) > 200:
        raise SystemExit(f"{slug}: mp3 duration {duration_ms} ms differs from WAV {wav_ms:.0f} ms")

    # Paragraph boundaries for the optional video (not read by the seed).
    timing = [
        {
            "paragraph": s["paragraph"],
            "position": s["position"],
            "startMs": s["startMs"],
            "endMs": s["endMs"],
        }
        for s in segments
    ]
    (folder / "timing.json").write_text(json.dumps(timing, indent=1) + "\n")
    words = sum(len(re.findall(r"\w+", s["text"])) for s in segments)
    report = {
        "slug": slug,
        "durationMs": duration_ms,
        "segments": len(segments),
        "words": words,
        "warnings": warnings,
    }
    if study is None:
        print(f"{slug}: study.json ausente; lesson.json não foi gerado")
        for s in segments:
            print(
                f"  #{s['position']:2d} {s['startMs']:7d}-{s['endMs']:7d} ({(s['endMs'] - s['startMs']) / 1000:4.1f}s) {s['text'][:70]}"
            )
        return report

    video = folder / "video.mp4"
    lesson = {
        "slug": slug,
        "version": study.get("version", 1),
        "language": "pt",
        "title": study["title"],
        "subject": study["subject"],
        "description": study["description"],
        "cover": study["cover"],
        "durationMs": duration_ms,
        "media": {
            "audio": "audio.mp3",
            "audioMime": "audio/mpeg",
            "sizeBytes": mp3.stat().st_size,
            "video": "video.mp4" if video.exists() else None,
            "videoMime": "video/mp4" if video.exists() else None,
            "videoSizeBytes": video.stat().st_size if video.exists() else None,
        },
        "credits": CREDITS.format(voice=voice)
        + (" Vídeo com slides originais da equipe." if video.exists() else ""),
        "segments": [{k: v for k, v in s.items() if k != "paragraph"} for s in segments],
        "words": None,
        "summary": study["summary"],
        "questions": {
            "title": study["questions"]["title"],
            "items": [with_refs(q, segments) for q in study["questions"]["items"]],
        },
        "flashcards": {
            "name": study["flashcards"]["name"],
            "cards": [with_card_refs(c, segments) for c in study["flashcards"]["cards"]],
        },
    }
    (folder / "lesson.json").write_text(json.dumps(lesson, ensure_ascii=False, indent=2) + "\n")
    prettier(folder / "lesson.json", folder / "timing.json")
    return report


def locate(evidence: str, segments: list[dict]) -> dict:
    hits = [s for s in segments if evidence in s["text"]]
    if len(hits) != 1:
        raise SystemExit(f"evidence must occur in exactly one segment ({len(hits)}): {evidence!r}")
    s = hits[0]
    return {"position": s["position"], "startMs": s["startMs"], "endMs": s["endMs"]}


def with_refs(question: dict, segments: list[dict]) -> dict:
    meta = dict(question["metadata"])
    meta["sourceRefs"] = [locate(meta["evidence"], segments)]
    return {**question, "metadata": meta}


def with_card_refs(card: dict, segments: list[dict]) -> dict:
    return {**card, "sourceSegments": [locate(card["evidence"], segments)]}


def prettier(*paths: Path) -> None:
    """Formats generated JSON like the rest of the repository (npm run format:check), if available."""
    binary = ROOT / "node_modules" / ".bin" / "prettier"
    if binary.exists():
        subprocess.run(
            [str(binary), "--log-level", "warn", "--write", *map(str, paths)], check=True
        )


def probe_duration_ms(path: Path) -> int:
    out = subprocess.run(
        [
            str(FFPROBE),
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        check=True,
    ).stdout.decode()
    return round(float(out.strip()) * 1000)


def main(argv: list[str]) -> None:
    slugs = argv or sorted(p.name for p in LESSONS.iterdir() if (p / "script.json").exists())
    for slug in slugs:
        report = build(slug)
        print(
            f"{report['slug']}: {report['durationMs']} ms, {report['segments']} segmentos, {report['words']} palavras"
        )
        for line in report["warnings"]:
            print("  " + line)


if __name__ == "__main__":
    main(sys.argv[1:])
