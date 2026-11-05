"""Adaptador Whisper para o AudioEstudo.

Baseado no comportamento do Space público openai/whisper, mas preserva os
chunks/timestamps que o Space público atualmente descarta na saída.
"""

import gradio as gr
import torch
from transformers import pipeline

try:
    import spaces
except ImportError:  # execução local sem ZeroGPU

    class _Spaces:
        @staticmethod
        def GPU(fn):
            return fn

    spaces = _Spaces()

MODEL_NAME = "openai/whisper-large-v3"
BATCH_SIZE = 8

device = 0 if torch.cuda.is_available() else "cpu"
pipe = pipeline(
    task="automatic-speech-recognition",
    model=MODEL_NAME,
    chunk_length_s=30,
    device=device,
)


@spaces.GPU
def transcribe(inputs, task):
    if inputs is None:
        raise gr.Error("Nenhum arquivo de áudio foi enviado.")

    result = pipe(
        inputs,
        batch_size=BATCH_SIZE,
        generate_kwargs={"task": task},
        return_timestamps="word",
    )

    segments = []
    pending = None
    for chunk in result.get("chunks", []):
        timestamp = chunk.get("timestamp") or (0, 0)
        start, end = timestamp
        start_ms = round(float(start or 0) * 1000)
        end_ms = round(float(end or start or 0) * 1000)
        text = (chunk.get("text") or "").strip()
        if not text:
            continue
        if pending and (
            end_ms - pending["startMs"] > 6000 or len(pending["text"]) + len(text) > 84
        ):
            segments.append(pending)
            pending = None
        if pending is None:
            pending = {"startMs": start_ms, "endMs": end_ms, "text": text}
        else:
            pending["endMs"] = end_ms
            pending["text"] += " " + text
        if text.endswith((".", "!", "?")):
            segments.append(pending)
            pending = None
    if pending:
        segments.append(pending)
    for index, segment in enumerate(segments):
        segment["position"] = index

    return {
        "text": (result.get("text") or "").strip(),
        "language": "pt",
        "segments": segments,
    }


demo = gr.Interface(
    fn=transcribe,
    inputs=[
        gr.Audio(type="filepath", label="Áudio"),
        gr.Radio(["transcribe", "translate"], label="Task", value="transcribe"),
    ],
    outputs=gr.JSON(label="Resultado"),
    title="AudioEstudo — Whisper Large V3 com timestamps",
    description="Adaptador de ASR do protótipo AudioEstudo.",
    allow_flagging="never",
)

if __name__ == "__main__":
    demo.launch()
