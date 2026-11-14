// Original synthesized music-box arrangement of a traditional Christmas tune.
// No samples or third-party performance recordings are used.
// Run: node scripts/generate-christmas-music.mjs (requires ffmpeg on PATH).
import { mkdir, writeFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rate = 44100;
const bpm = 108;
const beat = 60 / bpm;
const bars = 24;
const length = Math.round(bars * 3 * beat * rate); // exactly 40 seconds
const left = new Float64Array(length);
const right = new Float64Array(length);
const TAU = Math.PI * 2;
let noiseState = 20261121;
function random() { noiseState ^= noiseState << 13; noiseState ^= noiseState >>> 17; noiseState ^= noiseState << 5; return (noiseState >>> 0) / 4294967296; }
function hz(midi) { return 440 * 2 ** ((midi - 69) / 12); }
function put(index, value, pan) {
  const i = ((index % length) + length) % length;
  left[i] += value * Math.cos((pan + 1) * Math.PI / 4);
  right[i] += value * Math.sin((pan + 1) * Math.PI / 4);
}
function tone(midi, atBeat, durationBeats, velocity, kind = "bell", pan = 0) {
  const frequency = hz(midi);
  const start = Math.round(atBeat * beat * rate);
  const hold = durationBeats * beat;
  const release = kind === "pad" ? 1.2 : kind === "bass" ? .55 : 2.6;
  const total = hold + release;
  const count = Math.ceil(total * rate);
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    const phase = TAU * frequency * t;
    const end = Math.min(1, (total - t) / .06);
    let sample;
    if (kind === "pad") {
      const attack = Math.min(1, t / .28);
      const tail = t < hold ? 1 : Math.exp(-5 * (t - hold) / release);
      sample = Math.sin(phase) + .18 * Math.sin(2 * phase) + .045 * Math.sin(3 * phase);
      sample *= Math.sin(attack * Math.PI / 2) * tail;
    } else if (kind === "bass") {
      sample = (Math.sin(phase) + .19 * Math.sin(2 * phase)) * (1 - Math.exp(-t / .012)) * Math.exp(-t / .55);
    } else {
      // Rounded tine, a quiet octave and a fast-decaying upper bell partial.
      sample = Math.sin(phase) * Math.exp(-t / 1.25)
        + .22 * Math.sin(2 * phase) * Math.exp(-t / .62)
        + .055 * Math.sin(3.01 * phase) * Math.exp(-t / .23);
      sample *= 1 - Math.exp(-t / .0045);
      if (t > hold) sample *= Math.exp(-(t - hold) / 1.5);
    }
    put(start + i, sample * velocity * end, pan);
  }
}
function sleigh(atBeat, pan, velocity = .008) {
  const start = Math.round(atBeat * beat * rate);
  const seconds = .115;
  let previous = 0;
  for (let i = 0; i < seconds * rate; i++) {
    const t = i / rate;
    const n = random() * 2 - 1;
    const high = n - previous;
    previous = n;
    const sparkle = .6 * high + .25 * Math.sin(TAU * 6750 * t) + .15 * Math.sin(TAU * 9121 * t);
    put(start + i, sparkle * velocity * (1 - Math.exp(-t / .001)) * Math.exp(-t / .022), pan);
  }
}

// Bare traditional melody, in D major. Numbers are MIDI pitch and beat length.
// Source used to check pitches: John Chambers ABC collection (see design/MUSIC.md).
const melody = [
  [[74,1],[74,.5],[76,.5],[74,.5],[73,.5]],
  [[71,1],[71,1],[71,1]],
  [[76,1],[76,.5],[78,.5],[76,.5],[74,.5]],
  [[73,1],[69,1],[69,1]],
  [[78,1],[78,.5],[79,.5],[78,.5],[76,.5]],
  [[74,1],[71,1],[69,.5],[69,.5]],
  [[71,1],[76,1],[73,1]],
  [[74,2],[69,1]],
];
const D = [50,57,62,66], G = [43,55,59,62], E7 = [52,56,59,62], A7 = [45,55,61,64];
const F7 = [42,54,58,64], Bm = [47,54,59,62];
const harmony = [D,G,E7,A7,F7,Bm,G,D,D,G,E7,A7,F7,Bm,A7,D,Bm,G,D,A7,G,D,A7,A7];

for (let bar = 0; bar < bars; bar++) {
  const start = bar * 3;
  const chord = harmony[bar];
  const lightness = bar >= 16 ? .82 : 1;
  // A quiet three-beat accompaniment: grounded bass, then plucked upper notes.
  tone(chord[0], start, 1.1, .10 * lightness, "bass", -.12);
  tone(chord[0] + 12, start + 2, .7, .028 * lightness, "bass", .12);
  chord.slice(1).forEach((pitch, i) => tone(pitch, start + i * .018, 2.4, .012 * lightness, "pad", (i - 1) * .38));
  tone(chord[1] + 12, start + 1, .42, .043 * lightness, "bell", -.42);
  tone(chord[2] + 12, start + 1.5, .33, .028 * lightness, "bell", .33);
  tone(chord[3] + 12, start + 2, .44, .04 * lightness, "bell", .42);
  if (bar % 2 === 1) tone(chord[2] + 24, start + 2.5, .25, .010, "bell", -.5);
  sleigh(start + 1, -.5, .006);
  sleigh(start + 2, .5, .0048);
}
for (let repeat = 0; repeat < 2; repeat++) {
  for (let bar = 0; bar < 8; bar++) {
    let position = (repeat * 8 + bar) * 3;
    for (const [pitch, duration] of melody[bar]) {
      // No extra pickup after the second refrain; it resolves into the interlude.
      if (!(repeat === 1 && bar === 7 && position % 3 >= 2)) {
        const emphasis = duration >= 1 ? 1 : .89;
        tone(pitch, position, duration * .82, .145 * emphasis, "bell", -.055);
        tone(pitch - 12, position + .012, duration * .8, .027 * emphasis, "bell", .15);
        if (repeat === 1) tone(pitch + 12, position + .015, duration * .65, .014 * emphasis, "bell", .26);
      }
      position += duration;
    }
  }
}
// Original eight-bar response: a descending music-box ribbon and a gentle return.
const response = [
  [[78,1.5],[74,.75],[71,.75]], [[74,1.5],[71,.75],[67,.75]],
  [[69,1],[74,1],[78,1]], [[76,2],[73,1]],
  [[74,1.5],[71,1.5]], [[69,1],[66,1],[62,1]],
  [[64,1],[67,1],[73,1]], [[76,1],[73,1],[69,1]],
];
for (let bar = 0; bar < 8; bar++) {
  let position = (16 + bar) * 3;
  for (const [pitch, duration] of response[bar]) {
    tone(pitch, position, duration * .85, bar === 7 ? .10 : .085, "bell", .03);
    position += duration;
  }
}

// Circular room reflections: every tail is folded into the next loop instead
// of cut off. No fade-to-silence at the seam, and the loop keeps a steady pulse.
const dryL = left.slice(), dryR = right.slice();
const reflections = [[.071,.09],[.113,.075],[.181,.055],[.263,.045],[.367,.03],[.491,.022]];
for (const [delay, gain] of reflections) {
  const offset = Math.round(delay * rate);
  for (let i = 0; i < length; i++) {
    const j = (i + offset) % length;
    left[j] += dryR[i] * gain;
    right[j] += dryL[i] * gain;
  }
}
const meanL = left.reduce((sum, value) => sum + value, 0) / length;
const meanR = right.reduce((sum, value) => sum + value, 0) / length;
let peak = 0;
for (let i = 0; i < length; i++) { left[i] -= meanL; right[i] -= meanR; peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i])); }
const scale = .79 / peak;
let square = 0;
const wav = Buffer.alloc(44 + length * 4);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(length * 4, 40);
for (let i = 0; i < length; i++) {
  const l = left[i] * scale, r = right[i] * scale;
  square += l*l + r*r;
  wav.writeInt16LE(Math.round(l * 32767), 44 + i * 4); wav.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
}
const scratch = path.join(root, "outputs");
const asset = path.join(root, "public", "assets", "christmas-music-box.mp3");
await mkdir(scratch, { recursive: true });
await mkdir(path.dirname(asset), { recursive: true });
const wavPath = path.join(scratch, "christmas-music-box.wav");
await writeFile(wavPath, wav);
const encoded = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", wavPath, "-codec:a", "libmp3lame", "-b:a", "128k", "-ar", String(rate), "-map_metadata", "-1", "-metadata", "title=We Wish You a Merry Christmas — Tzai music box", "-metadata", "artist=Tzai Yeah original synthesized arrangement", "-write_xing", "1", asset], { encoding: "utf8" });
if (encoded.status !== 0) throw new Error(encoded.stderr || encoded.error?.message || "ffmpeg failed");
const report = {
  durationSeconds: length / rate, sampleRate: rate, channels: 2, bpm, bars,
  pcmPeakDbFS: Number((20*Math.log10(.79)).toFixed(3)),
  pcmRmsDbFS: Number((20*Math.log10(Math.sqrt(square/(length*2)))).toFixed(3)),
  seamDelta: { left: Number(((left[0]-left[length-1])*scale).toFixed(6)), right: Number(((right[0]-right[length-1])*scale).toFixed(6)) },
  bytes: (await stat(asset)).size, asset,
};
await writeFile(path.join(scratch,"christmas-music-box-report.json"), JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
