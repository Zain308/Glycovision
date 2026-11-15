"""
Entry point for Hugging Face Spaces (Gradio SDK, ZeroGPU free hardware).

A Gradio Space runs `python app.py`. This starts the normal GlycoVision
FastAPI app (main.py: same routes, auth and models) on the Space port,
with a small Gradio status page at /ui. Locally you can still use:
    uvicorn main:app --reload
"""

import os

# ZeroGPU: the `spaces` package must be imported before anything touches
# torch/CUDA, or it refuses to start. Outside Hugging Face it is absent.
try:
    import spaces  # type: ignore  # noqa: I001
except ImportError:
    spaces = None

# Server defaults (Space "Variables and secrets" override these).
os.environ.setdefault("USE_OLLAMA_FALLBACK", "false")
os.environ.setdefault("DEFAULT_TIMEZONE", "Asia/Karachi")
# Run all models on the CPU. On ZeroGPU a GPU exists only inside
# @spaces.GPU functions, so a model placed on "cuda" at startup would fail.
os.environ.setdefault("GLYCOVISION_DEVICE", "cpu")
# Spaces turn on Gradio's server-side rendering, which starts a Node.js
# server on the Space port (7860) and blocks our API from binding it. The
# status page does not need SSR, so switch it off.
os.environ["GRADIO_SSR_MODE"] = "false"

import gradio as gr  # noqa: E402
import uvicorn  # noqa: E402

from main import app as api  # noqa: E402

# ZeroGPU refuses to start unless the app declares at least one
# @spaces.GPU function. GlycoVision's models run on the CPU, so this one
# only reports whether a GPU was attached; nothing calls it.
if spaces is not None:

    @spaces.GPU(duration=10)
    def gpu_check() -> bool:
        import torch

        return torch.cuda.is_available()


with gr.Blocks(title="GlycoVision API") as status_page:
    gr.Markdown(
        """
# GlycoVision API

Backend for the GlycoVision diabetes app (research prototype).

* Health check: [`/health`](/health)
* API reference: [`/docs`](/docs)

All data routes require a GlycoVision login token. Not a medical device.
"""
    )

app = gr.mount_gradio_app(api, status_page, path="/ui", ssr_mode=False)

if __name__ == "__main__":
    # ZeroGPU reports the @spaces.GPU functions to Hugging Face from a hook
    # on gradio's Blocks.launch(). We serve the FastAPI app with uvicorn
    # instead of launch(), so run that same startup report ourselves.
    if spaces is not None:
        try:
            from spaces import zero as _zero

            if hasattr(_zero, "startup"):
                _zero.startup()
        except Exception as error:  # never block the API on this
            print("[ZeroGPU] startup report failed:", repr(error))

    # Use the port and host the Space assigns to the Gradio app (gradio's
    # launch() reads the same variables); 7860 is only the local default.
    port = int(os.environ.get("GRADIO_SERVER_PORT") or os.environ.get("PORT") or 7860)
    host = os.environ.get("GRADIO_SERVER_NAME") or "0.0.0.0"
    print(f"[GlycoVision] serving on {host}:{port}", flush=True)

    uvicorn.run(app, host=host, port=port, workers=1)
