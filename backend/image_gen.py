"""
JARVIS Image Generation Engine
Generates images from text prompts using NVIDIA AI Endpoints (SDXL).
Falls back to Pollinations.ai (free, no key) if NVIDIA fails.
Saves images to the local output/images/ directory.
"""
import os
import json
import base64
import uuid
import urllib.request
import urllib.parse
import urllib.error


OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "output", "images")
os.makedirs(OUTPUT_DIR, exist_ok=True)

NVIDIA_API_KEY = os.environ.get("NVIDIA_API_KEY", "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")
NVIDIA_IMG_URL = "https://ai.api.nvidia.com/v1/genai/stabilityai/stable-diffusion-xl"


def _save_image_bytes(img_bytes: bytes, filename: str) -> str:
    """Save raw image bytes to the output directory. Returns full path."""
    if not filename.endswith(('.png', '.jpg', '.jpeg', '.webp')):
        filename += '.png'
    path = os.path.join(OUTPUT_DIR, filename)
    with open(path, 'wb') as f:
        f.write(img_bytes)
    return path


def _generate_via_nvidia(prompt: str, negative_prompt: str, width: int, height: int,
                          steps: int, cfg_scale: float, seed: int) -> bytes:
    """Call NVIDIA AI Endpoints SDXL API. Returns raw PNG bytes."""
    payload = json.dumps({
        "text_prompts": [
            {"text": prompt, "weight": 1},
            {"text": negative_prompt or "blurry, low quality, watermark, signature", "weight": -1}
        ],
        "cfg_scale": cfg_scale,
        "sampler": "K_EULER",
        "seed": seed,
        "steps": steps,
        "width": width,
        "height": height
    }).encode('utf-8')

    headers = {
        "Authorization": f"Bearer {NVIDIA_API_KEY}",
        "Accept": "application/json",
        "Content-Type": "application/json"
    }

    req = urllib.request.Request(NVIDIA_IMG_URL, data=payload, headers=headers, method='POST')
    with urllib.request.urlopen(req, timeout=60) as resp:
        result = json.loads(resp.read().decode('utf-8'))

    # NVIDIA returns artifacts list with base64-encoded image
    artifacts = result.get("artifacts", [])
    if not artifacts:
        raise ValueError("NVIDIA API returned no image artifacts.")

    b64_data = artifacts[0]["base64"]
    return base64.b64decode(b64_data)


def _generate_via_pollinations(prompt: str, width: int, height: int, seed: int) -> bytes:
    """Fallback: Pollinations.ai free image generation. Returns raw PNG bytes."""
    encoded_prompt = urllib.parse.quote(prompt)
    url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width={width}&height={height}&seed={seed}&nologo=true"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) JARVIS/2.0"}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read()


def generate_image(
    prompt: str,
    filename: str = None,
    negative_prompt: str = "",
    width: int = 1024,
    height: int = 1024,
    steps: int = 25,
    cfg_scale: float = 7.5,
    seed: int = 0,
    style_preset: str = ""
) -> dict:
    """
    Generate an image from a text prompt.
    Returns dict with status, path, filename, and url for HUD display.
    """
    if not filename:
        short = prompt[:30].strip().replace(' ', '_').replace('/', '_')
        filename = f"{short}_{uuid.uuid4().hex[:6]}.png"
    elif not filename.endswith(('.png', '.jpg', '.jpeg')):
        filename += '.png'

    # Apply style preset to prompt
    style_suffixes = {
        "photorealistic": ", photorealistic, 8k, ultra detailed, DSLR photography",
        "cinematic": ", cinematic, dramatic lighting, film grain, anamorphic lens",
        "anime": ", anime style, Studio Ghibli, vibrant colors, detailed",
        "oil_painting": ", oil painting, textured brushwork, renaissance style",
        "watercolor": ", watercolor painting, soft edges, pastel tones",
        "3d_render": ", 3D render, Octane render, subsurface scattering, volumetric light",
        "pixel_art": ", pixel art, 16-bit style, retro game art",
        "sketch": ", pencil sketch, hand-drawn, fine detail linework",
    }
    if style_preset and style_preset in style_suffixes:
        prompt = prompt + style_suffixes[style_preset]

    # Try NVIDIA first, fall back to Pollinations
    img_bytes = None
    source = "nvidia"
    error_msg = None

    try:
        img_bytes = _generate_via_nvidia(prompt, negative_prompt, width, height, steps, cfg_scale, seed)
    except Exception as e:
        error_msg = str(e)
        source = "pollinations"
        try:
            img_bytes = _generate_via_pollinations(prompt, width, height, seed if seed else 42)
        except Exception as e2:
            return {
                "status": "error",
                "message": f"Both image APIs failed. NVIDIA: {error_msg}. Pollinations: {str(e2)}"
            }

    path = _save_image_bytes(img_bytes, filename)
    # Return a file:// URL for the HUD to display inline
    file_url = "file:///" + path.replace("\\", "/")

    return {
        "status": "success",
        "path": path,
        "filename": os.path.basename(path),
        "file_url": file_url,
        "source": source,
        "width": width,
        "height": height,
        "prompt": prompt,
        "message": f"Image generated via {source}: {os.path.basename(path)}"
    }
