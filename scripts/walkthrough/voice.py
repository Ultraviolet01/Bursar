# Synthesises each narration line with Piper (local, free) and writes timing.json.
# Usage: TTS_DIR=<dir with venv/ and voices/> python3 scripts/walkthrough/voice.py
import json, os, subprocess, wave
here = os.path.dirname(os.path.abspath(__file__))
tts = os.environ.get("TTS_DIR", os.path.join(here, "tts"))
os.makedirs(f"{tts}/clips", exist_ok=True)
dur = {}
lines = json.load(open(f"{here}/narration.json"))
for key, caption, speech in lines:
    out = f"{tts}/clips/{key}.wav"
    subprocess.run([f"{tts}/venv/bin/python", "-m", "piper", "-m", f"{tts}/voices/en_US-lessac-high.onnx", "-f", out, "--length-scale", "0.9", "--sentence-silence", "0.2"], input=speech.encode(), check=True, capture_output=True)
    with wave.open(out) as w:
        dur[key] = round(w.getnframes() / w.getframerate(), 2)
json.dump({"durations": dur, "captions": {k: c for k, c, _ in lines}}, open(f"{tts}/timing.json", "w"), indent=1)
print(f"{len(dur)} lines, {sum(dur.values()):.0f}s of speech")
