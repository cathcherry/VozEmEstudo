"""Exercise the existing ASR adapter without installing a model, GPU or providers."""

import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.results = {"text": " Aula de teste. ", "chunks": []}
        self.calls = []

        def recognize(inputs, **options):
            self.calls.append((inputs, options))
            return self.results

        gradio = types.SimpleNamespace(
            Error=ValueError,
            Audio=lambda **options: options,
            Radio=lambda *args, **options: options,
            JSON=lambda **options: options,
            Interface=lambda **options: types.SimpleNamespace(**options),
        )
        modules = {
            "gradio": gradio,
            "torch": types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: False)),
            "transformers": types.SimpleNamespace(pipeline=lambda **options: recognize),
            "spaces": types.SimpleNamespace(GPU=lambda function: function),
        }
        spec = importlib.util.spec_from_file_location(
            "asr_adapter_fixture", Path(__file__).resolve().parents[1] / "app.py"
        )
        self.adapter = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, modules):
            spec.loader.exec_module(self.adapter)

    def test_missing_input_rejects_without_model_call(self):
        with self.assertRaisesRegex(ValueError, "Nenhum arquivo"):
            self.adapter.transcribe(None, "transcribe")
        self.assertEqual(self.calls, [])

    def test_chunks_convert_seconds_to_milliseconds_and_preserve_order(self):
        self.results["chunks"] = [
            {"timestamp": (1.25, 2.5), "text": " Primeiro. "},
            {"timestamp": (2.5, None), "text": " Segundo. "},
        ]
        result = self.adapter.transcribe("synthetic.wav", "transcribe")
        self.assertEqual(result["text"], "Aula de teste.")
        self.assertEqual(result["language"], "pt")
        self.assertEqual(
            result["segments"],
            [
                {"position": 0, "startMs": 1250, "endMs": 2500, "text": "Primeiro."},
                {"position": 1, "startMs": 2500, "endMs": 2500, "text": "Segundo."},
            ],
        )
        self.assertEqual(self.calls[0][1]["return_timestamps"], "word")

    def test_words_group_into_short_cues_with_real_boundaries(self):
        self.results["chunks"] = [
            {"timestamp": (index, index + 0.8), "text": "palavra"} for index in range(20)
        ]
        result = self.adapter.transcribe("synthetic.wav", "transcribe")
        self.assertGreater(len(result["segments"]), 1)
        for segment in result["segments"]:
            self.assertLessEqual(segment["endMs"] - segment["startMs"], 6000)
            self.assertLessEqual(len(segment["text"]), 84)
        self.assertEqual(result["segments"][0]["startMs"], 0)
        self.assertEqual(result["segments"][-1]["endMs"], 19800)

    def test_empty_chunks_keep_the_current_text_contract(self):
        result = self.adapter.transcribe("synthetic.wav", "translate")
        self.assertEqual(result["segments"], [])
        self.assertEqual(self.calls[0][1]["generate_kwargs"], {"task": "translate"})


if __name__ == "__main__":
    unittest.main()
