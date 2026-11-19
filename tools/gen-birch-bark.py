# Makes textures/bark_birch.webp: tileable birch bark (white, black horizontal lenticels, a few dark patches). Run from the repo root: python3 tools/gen-birch-bark.py
import numpy as np
from PIL import Image, ImageFilter
rng=np.random.default_rng(7); S=512
def tile_noise(period,seed):
    r=np.random.default_rng(seed); g=r.random((period,period)).astype(np.float32)
    im=Image.fromarray((g*255).astype(np.uint8)).resize((S,S),Image.BICUBIC)
    return np.asarray(im,dtype=np.float32)/255
# wrap-safe base: white-cream with slow mottling and faint vertical fibre
base=np.ones((S,S,3),np.float32)*np.array([0.93,0.91,0.86])
m=0.55*tile_noise(4,1)+0.3*tile_noise(16,2)+0.15*tile_noise(64,3)
base*= (0.9+0.18*m)[...,None]
fib=tile_noise(128,5); fib=np.asarray(Image.fromarray((fib*255).astype(np.uint8)).resize((S,S)).filter(ImageFilter.GaussianBlur(0.6)),dtype=np.float32)/255
dark=np.zeros((S,S),np.float32)
# lenticels: short wide horizontal dashes, drawn with wrap-around
def dash(cx,cy,w,h,a):
    xs=np.arange(S); ys=np.arange(S)
    dx=np.minimum(abs(xs-cx),S-abs(xs-cx))[None,:]/w; dy=np.minimum(abs(ys-cy),S-abs(ys-cy))[:,None]/h
    d=np.clip(1-(dx**2+dy**2),0,1)**0.7
    return d*a
for _ in range(190):
    dark=np.maximum(dark,dash(rng.integers(S),rng.integers(S),rng.uniform(10,46),rng.uniform(1.6,4.5),rng.uniform(0.55,1.0)))
# a few large dark patches (older bark)
for _ in range(7):
    dark=np.maximum(dark,dash(rng.integers(S),rng.integers(S),rng.uniform(40,90),rng.uniform(10,26),rng.uniform(0.35,0.7))*(0.6+0.4*tile_noise(32,9)))
dark=np.clip(dark*(0.75+0.5*fib),0,1)
img=base*(1-dark[...,None]*0.93)+np.array([0.10,0.095,0.09])*dark[...,None]*0.93
# thin paper curls: faint light/dark horizontal lines
lines=(np.sin(np.arange(S)[:,None]/S*2*np.pi*23+tile_noise(8,11)*6)*0.5+0.5)**8*0.06
img=img*(1-lines[...,None])
Image.fromarray((np.clip(img,0,1)*255).astype(np.uint8)).save('textures/bark_birch.webp',quality=88)
