# ASR Space — Whisper com timestamps

O Space público `openai/whisper` já executa Whisper Large V3 com timestamps,
mas sua saída pública atual retorna apenas o texto. Este adaptador mantém o mesmo
modelo e devolve também os segmentos temporizados necessários à edição da
transcrição e à navegação pelo áudio.

Depois de criar o Space no Hugging Face:

1. envie `app.py` e `requirements.txt`;
2. confirme o nome do endpoint em **Use via API / View API**;
3. preencha no back-end:

```env
HF_ASR_SPACE_ID=seu-usuario/seu-space
HF_ASR_API_NAME=/predict
HF_ASR_AUDIO_FIELD=inputs
HF_ASR_TASK_FIELD=task
HF_ASR_RETURNS_SEGMENTS=true
HF_TOKEN=
```

Se o Space for privado, preencha `HF_TOKEN` com um token que tenha acesso de leitura.
