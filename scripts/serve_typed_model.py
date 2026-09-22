"""How to start a local typed-decision server.

This file does not download weights and does not invent probabilities.
Point MODEL_ENDPOINT at a server you started yourself.

AgentJev (candidate head, zero decoded tokens, not a causal LM):

    python -m jev_service.server \\
      --checkpoint agentjev_v1.pt \\
      --model-path Qwen/Qwen3-0.6B \\
      --temperatures temperatures.json \\
      --port 8149

Bespoke-Nimble-9B is a LoRA adapter. The base checkpoint is separate:

    base = AutoModelForCausalLM.from_pretrained(
        "Qwen/Qwen3.5-9B", torch_dtype=torch.bfloat16, device_map="auto")
    model = PeftModel.from_pretrained(base, "bespokelabs/Bespoke-Nimble-9B")

Score allowed answer tokens with Nimble's helper (`NimbleModel.score` or
`POST /v1/systemone`). Do not decode a long chain of thought and parse JSON.
"""

from __future__ import annotations

import sys


def main() -> None:
    sys.stderr.write(__doc__ or "")
    raise SystemExit(2)


if __name__ == "__main__":
    main()
