# Optional: test a real local model

This extension replaces the sample extraction response with an actual call to a local Ollama model. It does not connect to DoorDash or perform purchases. The rest of the workflow remains a learning simulation.

## Before you start

You need Python 3 and Ollama. Follow the official Ollama quickstart at https://docs.ollama.com/quickstart. Choose a supported local model that fits your machine. Model downloads can be large; check its requirements first. Use a local model rather than a cloud-backed model if local execution is your goal.

The script expects Ollama's local API at http://127.0.0.1:11434. It does not send requests to a remote endpoint. Inspect the chosen model and the rest of your environment before making broader privacy claims.

## Run it

1. Install Ollama from its official source and start it.
2. Use `ollama list` to see installed model tags. If needed, follow the quickstart to download a suitable model.
3. In the unzipped lab folder, run `python3 local-model.py --model YOUR_INSTALLED_MODEL_TAG` after replacing the placeholder with an actual installed tag.
4. Inspect the printed response, structural errors, and measured elapsed time.
5. Try a correction with `python3 local-model.py --model YOUR_INSTALLED_MODEL_TAG --request 'Earlier: spicy Thai, under 25 USD with fees. Now: make it vegetarian.'`.

The input is sent as one request. The runner does not automatically retain conversational memory; include the relevant earlier context when testing a correction.

## Predict, run, compare

Use the same cases for each model:

- Explicit budget and currency, missing area.
- A vegetarian correction that must preserve the budget.
- Explicitly no dietary restrictions versus restrictions not mentioned.
- A vague request that should leave unsupported fields unknown.
- A request with unsupported detail that should not become a false claim.

Record actual field fidelity, malformed output, and elapsed time. The first call can include model loading, so record cold and subsequent runs separately. Repeat cases before drawing conclusions about reliability. Temperature zero does not establish universal determinism.

The script checks response structure. You must still compare the values with the input. An incorrect but well-formed budget is a semantic failure. If the call fails, check service availability and model name; the script prints an error instead of inventing a response.

Do not put API credentials, real addresses, or payment details into this exercise. No live model benchmark was run when the course was authored; collect your own measurements.
