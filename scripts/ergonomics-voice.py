"""Generate the male guide voice for the active break with Kokoro (Apache 2.0), voice em_alex.

Usage: pip install kokoro-onnx lameenc numpy; download kokoro-v1.0.onnx and voices-v1.0.bin from
https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0 into the current folder;
then run: python scripts/ergonomics-voice.py em_alex
"""
import json, sys
import numpy as np, lameenc
from kokoro_onnx import Kokoro

import pathlib
OUT = str(pathlib.Path(__file__).resolve().parent.parent / 'public/ergonomics/voice') + '/'
VOICE = sys.argv[1] if len(sys.argv) > 1 else 'em_alex'
SPEED = .9
# "|" separates phrases; each gets a short breath of silence after it.
LINES = {
    'intro': 'Hola. Vamos a regalarnos ochenta segundos de pausa.|Son cuatro movimientos suaves.|Hazlos sin prisa, y detente si sientes dolor o mareo.|Cuando quieras, pulsa: comenzar movimiento.',
    'step-0': 'Primer movimiento: suelta los hombros.|Elévalos suavemente hacia las orejas,|y déjalos caer.|Respira con normalidad, con los brazos sueltos.',
    'mid-0': 'Inhala al subir los hombros,|y exhala al soltarlos.',
    'step-1': 'Segundo movimiento: moviliza las manos.|Sepáralas del teclado.|Abre y cierra los dedos con suavidad, sin forzar las muñecas.',
    'mid-1': 'Muy bien.|Abre,|y cierra.|A tu ritmo.',
    'step-2': 'Tercer movimiento: cambia de posición.|Si te resulta cómodo, ponte de pie y da unos pasos.|También puedes mover las piernas sentado.',
    'mid-2': 'Sigue moviéndote con calma.|Siente cómo se activa la circulación.',
    'step-3': 'Último movimiento: descansa la mirada.|Mira un objeto lejano, y parpadea con naturalidad.|Relaja la mandíbula, y respira a tu ritmo.',
    'mid-3': 'Respira despacio.|Deja que tus ojos descansen.',
    'next': 'Muy bien.|Cuando quieras, pasa al siguiente movimiento.',
    'done': 'Pausa completada.|Gracias por cuidarte.|Lleva estos ajustes a tu espacio, y alterna tus posiciones durante el día.',
}
kokoro = Kokoro('kokoro-v1.0.onnx', 'voices-v1.0.bin')
report = {}
import os; os.makedirs(OUT, exist_ok=True)
for key, text in LINES.items():
    parts = []
    for phrase in text.split('|'):
        samples, sr = kokoro.create(phrase.strip(), voice=VOICE, speed=SPEED, lang='es')
        samples = np.asarray(samples, dtype=np.float64)
        # Trim leading/trailing near-silence, then add a natural breath.
        idx = np.where(np.abs(samples) > .01)[0]
        if len(idx): samples = samples[max(0, idx[0] - int(.03 * sr)): idx[-1] + int(.08 * sr)]
        parts += [samples, np.zeros(int(.42 * sr))]
    audio = np.concatenate([np.zeros(int(.12 * sr))] + parts[:-1] + [np.zeros(int(.2 * sr))])
    audio *= 10 ** (-17 / 20) / np.sqrt(np.mean(audio ** 2) + 1e-12)
    audio = np.clip(audio, -.95, .95)
    enc = lameenc.Encoder(); enc.set_bit_rate(64); enc.set_in_sample_rate(sr); enc.set_channels(1); enc.set_quality(2)
    data = enc.encode((audio * 32767).astype('<i2').tobytes()) + enc.flush()
    open(OUT + key + '.mp3', 'wb').write(data)
    report[key] = round(len(audio) / sr, 1)
print(VOICE, json.dumps(report))
