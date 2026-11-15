# Original synthesized soundtrack for the AstroCura demo video (no samples, no third-party music).
import numpy as np, json
from scipy import signal
from scipy.io import wavfile
SR = 44100; DUR = 29.5
N = int(SR * DUR); t = np.arange(N) / SR
rng = np.random.default_rng(7)
def midi(n): return 440.0 * 2 ** ((n - 69) / 12)
def env_at(t0, att, dur, rel, n=N):
    e = np.zeros(n); i0 = int(t0 * SR); L = int((att + dur + rel) * SR); i1 = min(n, i0 + L)
    if i0 >= n: return e
    x = np.arange(i1 - i0) / SR
    seg = np.minimum(1, x / max(att, 1e-4)) * np.where(x > att + dur, np.clip(1 - (x - att - dur) / max(rel, 1e-4), 0, 1), 1)
    e[i0:i1] = seg; return e
def lp(x, fc, order=2): return signal.sosfilt(signal.butter(order, fc, 'low', fs=SR, output='sos'), x)
def hp(x, fc, order=2): return signal.sosfilt(signal.butter(order, fc, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi): return signal.sosfilt(signal.butter(2, [lo, hi], 'band', fs=SR, output='sos'), x)
def add(buf, sig, t0, gain=1.0):
    i0 = int(t0 * SR)
    if i0 >= len(buf): return
    s = sig[: len(buf) - i0] * gain; buf[i0:i0 + len(s)] += s
def saw(f, n): ph = (f * np.arange(n) / SR) % 1.0; return 2 * ph - 1

# ---------- harmony (follows the storyboard) ----------
CH = [  # start, end, bass midi, chord midi
    (0.0, 4.3, 33, [57, 60, 64, 71]),    # Am  intro + problem
    (4.3, 10.1, 29, [53, 57, 60, 69]),   # F   radiation, findings
    (10.1, 14.2, 36, [55, 60, 64, 67]),  # C   crew of four (lift)
    (14.2, 19.4, 31, [55, 59, 62, 69]),  # G   actions
    (19.4, 22.4, 33, [57, 60, 64, 72]),  # Am  report
    (22.4, 26.15, 29, [53, 57, 60, 72]), # F   stress test (tension)
    (26.15, 29.5, 33, [57, 64, 69, 76]), # Am  resolve, open
]
pad = np.zeros(N); sub = np.zeros(N)
for k, (a, b, bass, notes) in enumerate(CH):
    n = int((b - a + 2.2) * SR); seg = np.zeros(n)
    for m in notes:
        f = midi(m)
        for det in (-7, 0, 7):
            seg += saw(f * 2 ** (det / 1200), n) * 0.12
        seg += np.sin(2 * np.pi * f * np.arange(n) / SR) * 0.10
    cut = 700 + 1500 * min(1, a / 22) if a < 26 else 1800
    seg = lp(seg, cut, 3)
    e = env_at(0, 1.4, (b - a) - 0.4, 1.8, n)
    add(pad, seg * e, a - 0.6 if a > 0 else 0, 1.0)
    sn = int((b - a + 1.5) * SR); x = np.arange(sn) / SR
    sb = np.sin(2 * np.pi * midi(bass) * x) * 0.5 + np.sin(2 * np.pi * midi(bass + 12) * x) * 0.12
    add(sub, sb * env_at(0, 0.6, (b - a) - 0.2, 1.0, sn), a, 1.0)
pad *= 0.85 + 0.15 * np.sin(2 * np.pi * 0.12 * t)

# ---------- plucks (arpeggio) ----------
BEAT = 0.6; STEP = BEAT / 2
pl = np.zeros(N)
def pluck(f, dur=0.55):
    n = int(dur * SR); x = np.arange(n) / SR
    s = (np.sin(2 * np.pi * f * x) + 0.45 * np.sin(2 * np.pi * 2 * f * x) + 0.2 * np.sin(2 * np.pi * 3 * f * x)) * np.exp(-x / 0.14)
    return lp(s, 3800) * np.minimum(1, x / 0.004)
pat = [0, 1, 2, 3, 2, 1, 2, 3]
tt = 2.1; idx = 0
while tt < 26.0:
    seg = [c for c in CH if c[0] <= tt < c[1]][0]
    notes = [n + 12 for n in seg[3]]
    vel = 0.05 + 0.20 * min(1, (tt - 2.1) / 18)
    add(pl, pluck(midi(notes[pat[idx % 8]])), tt, vel * (1.0 if idx % 2 == 0 else 0.7)); tt += STEP; idx += 1
# ---------- drums (soft) ----------
dr = np.zeros(N)
def kick():
    n = int(0.45 * SR); x = np.arange(n) / SR
    f = 52 + 70 * np.exp(-x / 0.035); ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-x / 0.16)
def hat():
    n = int(0.07 * SR); x = np.arange(n) / SR
    return hp(rng.standard_normal(n), 7000) * np.exp(-x / 0.018)
k = 6.6
while k < 26.0:
    add(dr, kick(), k, 0.36 if int((k - 6.6) / BEAT) % 2 == 0 else 0.0); k += BEAT
h = 10.1 + BEAT / 2
while h < 26.0:
    add(dr, hat(), h, 0.10); h += BEAT

# ---------- sound effects ----------
fx = np.zeros(N)
def whoosh(dur=0.7, lo=300, hi=5000, rev=False):
    n = int(dur * SR); x = np.linspace(0, 1, n); nz = rng.standard_normal(n)
    out = np.zeros(n); blocks = 12
    for i in range(blocks):
        a, b = int(i * n / blocks), int((i + 1) * n / blocks); fc = lo * (hi / lo) ** (i / (blocks - 1))
        out[a:b] = bp(nz, fc * 0.7, min(fc * 1.4, 20000))[a:b]
    e = np.sin(np.pi * x) ** 2
    if rev: e = x ** 2
    return out * e
def boom(dur=2.4, f0=38):
    n = int(dur * SR); x = np.arange(n) / SR
    return (np.sin(2 * np.pi * (f0 + 40 * np.exp(-x / 0.12)) * x) * np.exp(-x / 0.8) + 0.25 * lp(rng.standard_normal(n), 400) * np.exp(-x / 0.25))
def tick(f=1500, dur=0.09):
    n = int(dur * SR); x = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * x) + 0.5 * np.sin(2 * np.pi * 2 * f * x)) * np.exp(-x / 0.016)
def chirp(f0, f1, dur=0.16):
    n = int(dur * SR); x = np.arange(n) / SR; f = f0 + (f1 - f0) * x / dur
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x / 0.05) * np.minimum(1, x / 0.004)
def bell(f, dur=2.4):
    n = int(dur * SR); x = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * x) + 0.4 * np.sin(2 * np.pi * 2.76 * f * x) + 0.2 * np.sin(2 * np.pi * 5.4 * f * x)) * np.exp(-x / 0.9)
def blip(f=1320, dur=0.22):  # caption pop: soft, rounded
    n = int(dur * SR); x = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * x) + 0.3 * np.sin(2 * np.pi * 2 * f * x)) * np.exp(-x / 0.045) * np.minimum(1, x / 0.003)
def marimba(f, dur=0.7):
    n = int(dur * SR); x = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * x) + 0.5 * np.sin(2 * np.pi * 4 * f * x) * np.exp(-x / 0.03)) * np.exp(-x / 0.22) * np.minimum(1, x / 0.002)
def thock(dur=0.28):  # soft paper / dialog thud
    n = int(dur * SR); x = np.arange(n) / SR
    return lp(rng.standard_normal(n), 900) * np.exp(-x / 0.05) * 0.8 + np.sin(2 * np.pi * (90 + 60 * np.exp(-x / 0.03)) * x) * np.exp(-x / 0.08)
def paper(dur=0.32):
    n = int(dur * SR); x = np.arange(n) / SR
    return bp(rng.standard_normal(n), 1800, 7500) * (np.exp(-x / 0.09) * np.minimum(1, x / 0.01))
def scrub(dur, f0, f1, gain):  # slider scrub: rising tone with airy noise
    n = int(dur * SR); x = np.arange(n) / SR; f = f0 * (f1 / f0) ** (x / dur)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.5
    air = bp(rng.standard_normal(n), 2000, 6500) * 0.5
    return (tone + air) * np.sin(np.pi * np.clip(x / dur, 0, 1)) ** 1.5 * gain

# reveal: reverse riser + soft boom + bell
add(fx, whoosh(1.1, 400, 7000, rev=True), 0.6, 0.30); add(fx, boom(2.0, 58), 1.7, 0.34); add(fx, bell(midi(81), 2.0), 1.7, 0.10)
# captions pop in (caption call + 0.16 s fade delay)
for tm, f in [(2.47, 1175), (4.46, 1319), (6.76, 1319), (10.86, 1568), (15.09, 1319), (17.26, 1480), (19.86, 1175), (23.16, 1319), (24.76, 1568)]:
    add(fx, blip(f), tm, 0.16)
# scene whooshes
for tm in (4.3, 6.6, 10.1, 14.2, 22.4): add(fx, whoosh(0.6, 500, 6000), tm - 0.25, 0.20)
# slider scrubs (day sweeps)
add(fx, scrub(1.0, 500, 1800, 0.12), 4.3, 1.0); add(fx, scrub(1.2, 600, 2200, 0.12), 6.6, 1.0)
# tab clicks
for tm in (10.1, 14.2, 22.4): add(fx, tick(1500), tm, 0.32); add(fx, tick(2300, 0.05), tm + 0.02, 0.10)
# crew of four: a data-scan tick train that rises, then four soft marimba notes as each person's status settles
for i in range(26):
    add(fx, tick(900 * (1 + i * 0.045), 0.05), 10.8 + i * 0.12, 0.10)
for tm, m in [(11.5, 72), (12.1, 76), (12.7, 79), (13.3, 84)]: add(fx, marimba(midi(m)), tm, 0.20)
# delay selector
add(fx, chirp(880, 1320), 14.95, 0.20); add(fx, chirp(660, 1760, 0.22), 17.1, 0.22)
# report: open (paper + thud), scroll (airy sweep), close
add(fx, paper(0.34), 19.4, 0.30); add(fx, thock(), 19.4, 0.30); add(fx, tick(2000, 0.04), 19.42, 0.12)
add(fx, scrub(1.3, 700, 1500, 0.07), 20.6, 1.0)
add(fx, thock(0.22), 22.1, 0.22)
# stress test: analysis arpeggio of ticks, then a clean ding when the result is shown
for i in range(14):
    add(fx, tick(1200 * 2 ** ((i % 7) / 7), 0.04), 23.05 + i * 0.1, 0.09)
add(fx, bell(midi(88), 1.6), 24.62, 0.12); add(fx, whoosh(0.7, 400, 6500), 24.4, 0.18)
# final build + hit
add(fx, whoosh(2.0, 300, 9000, rev=True), 24.25, 0.34)
n = int(1.95 * SR); x = np.arange(n) / SR; sweep = np.sin(2 * np.pi * np.cumsum(180 + 1400 * (x / 1.95) ** 2) / SR) * (x / 1.95) ** 2
add(fx, lp(sweep, 4000), 24.2, 0.10)
add(fx, boom(3.0, 55), 26.15, 0.42)
cym = hp(rng.standard_normal(int(2.6 * SR)), 3500) * np.exp(-np.arange(int(2.6 * SR)) / SR / 0.7); add(fx, cym, 26.15, 0.10)
add(fx, bell(midi(81), 3.0), 26.2, 0.16); add(fx, bell(midi(76), 3.0), 26.3, 0.10)

# ---------- stereo, delay, reverb ----------
def stereo(x, w=0.0): return np.stack([x * (1 - w), x * (1 + w)], 1)
def pingpong(x, d=0.45, fb=0.38, n=4):
    L = x.copy(); R = np.zeros_like(x)
    out = np.zeros((len(x), 2)); cur = x.copy(); side = 0
    for i in range(n):
        sh = int(d * SR * (i + 1)); sig = np.zeros_like(x); sig[sh:] = cur[:len(x) - sh] * (fb ** (i + 1)); out[:, side] += sig; side = 1 - side
    out[:, 0] += x; out[:, 1] += x
    return out
pl_st = pingpong(pl)
pad_st = np.stack([pad, np.roll(pad, int(0.012 * SR))], 1)
dry = pad_st * 0.9 + stereo(sub) * 0.55 + pl_st * 1.0 + stereo(dr) * 1.0 + stereo(fx) * 1.0
ir_n = int(2.6 * SR); xi = np.arange(ir_n) / SR
ir = np.stack([lp(rng.standard_normal(ir_n), 5000) * np.exp(-xi / 0.6), lp(rng.standard_normal(ir_n), 5000) * np.exp(-xi / 0.6)], 1)
ir[: int(0.02 * SR)] = 0; ir /= np.sqrt((ir ** 2).sum(0)).max()
send = pad_st * 0.5 + pl_st * 0.5 + stereo(fx) * 0.9
wet = np.stack([signal.fftconvolve(send[:, c], ir[:, c])[:N] for c in range(2)], 1)
mix = dry * 0.8 + wet * 0.55
# duck pad slightly on kicks (gentle sidechain)
duck = np.ones(N)
k = 6.6
while k < 26.0:
    i0 = int(k * SR); L = int(0.28 * SR); g = 1 - 0.30 * np.exp(-np.arange(min(L, N - i0)) / SR / 0.09); duck[i0:i0 + len(g)] *= g; k += BEAT * 2
mix[:, :] = mix * duck[:, None]
# fades and master
mix *= (0.62 + 0.38 * np.clip(t / 26.0, 0, 1))[:, None]
mix *= np.minimum(1, t / 0.5)[:, None] * np.clip((DUR - t) / 1.6, 0, 1)[:, None]
mix = np.stack([hp(mix[:, 0], 38, 2), hp(mix[:, 1], 38, 2)], 1)
print('pre-limiter peak %.2f at %.2f s' % (np.abs(mix).max(), np.abs(mix).max(1).argmax() / SR))
from scipy.ndimage import minimum_filter1d, uniform_filter1d
def limiter(x, ceil=0.80, look=0.006, rel=0.12):
    pk = np.abs(x).max(1)
    g = np.minimum(1.0, ceil / np.maximum(pk, 1e-9))
    g = minimum_filter1d(g, int(look * SR) * 2 + 1)           # look-ahead: hold the lowest gain
    g = uniform_filter1d(g, int(look * SR) * 2 + 1)            # smooth attack
    # release: slow recovery
    out = g.copy(); a = np.exp(-1 / (rel * SR))
    for n in range(1, len(out)):
        if out[n] > out[n - 1]: out[n] = out[n - 1] * a + out[n] * (1 - a)
    out = np.minimum(out, np.minimum(1.0, ceil / np.maximum(pk, 1e-9)) * 1.0 + 1e-9) if False else out
    y = x * out[:, None]
    return y
mix = limiter(mix)
mix = np.clip(mix, -0.95, 0.95)
wavfile.write('/tmp/v2/music.wav', SR, (mix * 32767).astype(np.int16))
print('ok', DUR, 's, peak', np.abs(mix).max())
