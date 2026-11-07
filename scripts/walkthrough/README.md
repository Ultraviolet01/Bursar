# Walkthrough video

A 2:48 narrated walkthrough. To rebuild it after the app changes:

1. Set up Piper once, outside the repo:
   - `python3 -m venv $TTS_DIR/venv && $TTS_DIR/venv/bin/pip install piper-tts`
   - Then, inside `$TTS_DIR/voices`: `../venv/bin/python -m piper.download_voices en_US-lessac-high`
2. Make the voice lines: `python3 scripts/walkthrough/voice.py`. Edit `narration.json` to change the words. The second field is the on-screen caption; the third is what is spoken. "Blaaiz" is written "Blaze" so it is pronounced correctly.
3. Record: `npm run build && ENABLE_TEST_LOGIN=1 npm start`, then `node scripts/walkthrough/record.mjs <outDir>`. This wipes the local database first.
4. Mix: `python3 scripts/walkthrough/mix.py <outDir>`.

The video is not stored in the repository. Upload it to the README on github.com: drag it into the editor, and GitHub hosts it.
