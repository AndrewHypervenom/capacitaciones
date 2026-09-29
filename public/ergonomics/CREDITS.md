# Third-party assets used by the ergonomics game

## office-human.glb

Source: Microsoft Rocketbox Avatar Library, Business_Female_04.
https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Avatars/Professions/Business_Female_04
Copyright (c) 2020 Microsoft. MIT license; complete license in ROCKETBOX-LICENSE.txt.

Adaptations: converted FBX to glTF 2.0; centimeters to meters; diffuse and normal textures embedded; physically based materials; transparent hair cards; procedural skeletal posing in the game. No source animations included.

## Nature soundscape (no birdsong)

All three recordings are Creative Commons Zero 1.0 (public domain dedication), taken from the public high-quality previews on Freesound.
https://creativecommons.org/publicdomain/zero/1.0/

- `wind-leaves-loop.mp3`: "Wind and Leaves.wav" by ecfike. https://freesound.org/people/ecfike/sounds/183496/
- `stream-loop.mp3`: "waterflow loop.wav" by regentag. https://freesound.org/people/regentag/sounds/441252/
- `gentle-rain-loop.mp3`: "gentle rainfall.wav" by rasunter255. https://freesound.org/people/rasunter255/sounds/416227/

Adaptations: a steady 80–95 s section of each recording, chosen automatically to avoid gusts and tonal (birdsong) energy in the 2.5–8 kHz band; a baked 3 s equal-power crossfade so the loop has no seam; 0.5 s of circular padding at both ends (the game loops between the padding, so MP3 encoder delay never causes a gap); loudness matched to −24 dBFS RMS; re-encoded at 96 kbps. The game mixes the layers quietly with slow, irregular level changes. No synthesized drone or generated noise; the only generated sounds are short, soft chimes when a movement or mission ends.

## voice/*.mp3 (male guide voice)

Generated offline with Kokoro-82M (https://huggingface.co/hexgrad/Kokoro-82M), Apache License 2.0, through kokoro-onnx (MIT), Spanish male voice `em_alex`, speed 0.9. Script written for this game; phrases are joined with short breathing pauses, loudness matched to −17 dBFS RMS and encoded as 64 kbps mono MP3. No cloud speech service or voice of a real person is used.
