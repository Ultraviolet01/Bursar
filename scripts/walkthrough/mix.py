# Places each narration clip at the time it started on screen, then muxes and compresses (<10 MB for GitHub).
# Usage: TTS_DIR=<dir> python3 scripts/walkthrough/mix.py <outDir>
import glob, json, os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
tts = os.environ.get("TTS_DIR", os.path.join(here, "tts"))
out = sys.argv[1]
cues = json.load(open(f"{out}/cues.json"))
video = glob.glob(f"{out}/page@*.webm")[0]
args = ["ffmpeg", "-v", "error", "-y", "-i", video] + sum([["-i", f"{tts}/clips/{c['key']}.wav"] for c in cues], [])
parts = [f"[{i}:a]aresample=48000,adelay={int(c['at']*1000)+150}|{int(c['at']*1000)+150},apad=whole_dur=0[a{i}]" for i, c in enumerate(cues, 1)]
fc = ";".join(parts) + ";" + "".join(f"[a{i}]" for i in range(1, len(cues) + 1)) + f"amix=inputs={len(cues)}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]"
args += ["-filter_complex", fc, "-map", "0:v", "-map", "[aout]", "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", f"{out}/bursar-walkthrough.mp4"]
subprocess.run(args, check=True)
print(f"{out}/bursar-walkthrough.mp4")
