import os
# Builds app/public/skins/*.css (the preview skins). Run: python design/mkskins.py
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'public', 'skins')
os.makedirs(OUT, exist_ok=True)
N = ':not(#_):not(#__):not(#___):not(#____):not(#_____):not(#______)'

def tok(t):
    return (f"--fu-canvas:{t['canvas']};--fu-side:{t['side']};--fu-surf:{t['surf']};--fu-raise:{t['rz']};--fu-line:{t['line']};--fu-line2:{t['line2']};"
            f"--fu-ink:{t['ink']};--fu-ink2:{t['ink2']};--fu-mute:{t['mute']};--fu-chip:{t['chip']};--fu-lime:{t['sig']};"
            f"--fu-ok:{t['ok']};--fu-warn:{t['warn']};--fu-crit:{t['crit']};--fu-c2:{t['c2']};--fu-c3:{t['c3']};"
            f"--gp-nest2:{t['rz']};--gp-on:{t['onchip']};--accent-ink:{t['onchip']};--rev-ink:{t['sig']};"
            f"--mx-ink:{t['ink']};--mx-ink2:{t['ink2']};--mx-mute:{t['mute']};--mx-surf:{t['surf']};--mx-raise:{t['rz']};--mx-line:{t['line']};"
            f"--mx-s1:{t['s1']};--mx-s2:{t['c3']};--mx-s3:{t['c2']};--mx-s4:{t['warn']};--mx-s5:{t['ok']};--mx-s1-ink:{t['onchip']};--mx-lime:{t['s1']};"
            f"--pv-lime:{t['s1']};--pv-silver:{t['c3']};--pv-track:{t['rz']};--d1:{t['s1']};--d2:{t['c3']};--d3:{t['warn']};--d4:{t['c2']}")

def mode(sel, t):
    t = dict(t, s1=(t['chip'] if 'light' in sel and 'not' not in sel else t['sig']))
    R = f':root[data-skin]{sel}'
    nav = f'{R} body nav[aria-label="Main"]{N}'
    on = ':is(.p10.on,[aria-current="page"],[aria-current="true"],.on)'
    return "\n".join([
        f"{R}{N},{R}{N} body{{{tok(t)}}}",
        f"{R} body{N}{{background:{t['canvas']}!important;background-image:none!important}}",
        f"{nav}{{background:{t['side']}!important;border-color:{t['line']}!important;border-bottom:1px solid {t['line']}!important}}",
        f'{nav} :is(button,a,span,kbd,b,small):not([class*="badge"]):not([class*="count"]):not(.n){{color:{t["ink2"]}!important}}',
        f"{nav} :is(button,a){{border-color:{t['line']}!important}}",
        f"{nav} :is(button,a):hover{{background-color:{t['rz']}!important;color:{t['ink']}!important}}",
        f"{nav} {on}{{background-color:{t['navon']}!important;color:{t['navonink']}!important}}",
        f"{nav} {on} *{{color:{t['navonink']}!important}}",
        f'{nav} :is(input,[class*="search"],[class*="ask"],[class*="cmd"]){{background-color:{t["rz"]}!important;color:{t["ink2"]}!important}}',
        f"{R} body{N} main :is(.card,.pv-c,.td-card,.mk-card,.kpi,.td-stat,.cc-card,.mx-card){{background:{t['surf']}!important;box-shadow:{t['shadow']}!important;border-radius:var(--sk-r)!important}}",
        f"{R} body{N} main :is(.tm-tile,.tm-next-up,.er-mix,.er-k div){{background:{t['rz']}!important}}",
        f"{R} body{N} main :is(.tm-tile,.tm-who) small{{color:{t['mute']}!important}}",
        ""])

H = f':root[data-skin]{N}'
def serif(fam, w=400):
    return (f"{H} #tdHello,{H} main h1{{font-family:'{fam}',Georgia,serif!important;font-weight:{w}!important;letter-spacing:-.01em!important}}\n"
            f"{H} main :is(.mx-num,.mx-val,.mx-big b,.mx-xl){{font-family:'{fam}',Georgia,serif!important;font-weight:{w}!important;letter-spacing:-.01em!important}}\n")
def base(r): return f":root[data-skin]{{--sk-r:{r}}}\n"

def skin(name, desc, light, dark, extra):
    css = f"/* MXAi preview skin: {name}. {desc}\n   Loaded only with ?skin={name}; overrides the Future Utility tokens in hq.css for both modes. */\n"
    css += mode('[data-theme="light"]', light) + mode(':not([data-theme="light"])', dark) + extra
    open(os.path.join(OUT, name + '.css'), 'w', encoding='utf-8').write(css)

skin('stone', 'Warm stone and ink: the same calm system, warmer and softer, like paper.',
 dict(canvas='#efece6',side='#efece6',surf='#f8f6f2',rz='#ffffff',line='#e3ded4',line2='#cfc8bb',ink='#1c1a17',ink2='#4a453e',mute='#736c61',chip='#1c1a17',onchip='#f8f6f2',sig='#c6f432',ok='#3f7a3a',warn='#a8611c',crit='#b4362b',c2='#b3ab9e',c3='#5e574d',navon='#1c1a17',navonink='#f8f6f2',shadow='0 1px 2px rgba(40,30,20,.05),0 10px 30px -18px rgba(40,30,20,.22)'),
 dict(canvas='#121110',side='#121110',surf='#1b1a18',rz='#25231f',line='#2b2925',line2='#3d3a34',ink='#f1eee8',ink2='#cdc7bc',mute='#9a9387',chip='#f1eee8',onchip='#121110',sig='#c6f432',ok='#8cc68a',warn='#e0a35a',crit='#e57b6e',c2='#6d675e',c3='#a8a195',navon='#f1eee8',navonink='#121110',shadow='0 0 0 1px #2b2925'),
 base('18px'))

skin('champagne', 'Beauty-house luxury: stone or olive-black, gold as the one signal, serif headlines.',
 dict(canvas='#e9e5dc',side='#e9e5dc',surf='#f4f1ea',rz='#fbf9f4',line='#dcd5c7',line2='#c7bea9',ink='#1e1d19',ink2='#4a473f',mute='#665f52',chip='#1e1d19',onchip='#e9d9a8',sig='#e2c983',ok='#56703f',warn='#9a6b1e',crit='#a43d2f',c2='#bfb49c',c3='#6f6650',navon='#1e1d19',navonink='#e9d9a8',shadow='0 1px 2px rgba(50,40,20,.05),0 12px 32px -20px rgba(50,40,20,.25)'),
 dict(canvas='#0f100d',side='#0f100d',surf='#181914',rz='#21221c',line='#2a2b24',line2='#3c3d33',ink='#efe9da',ink2='#c9c1ac',mute='#8f8875',chip='#d8bd78',onchip='#0f100d',sig='#d8bd78',ok='#a9c08a',warn='#d8a24a',crit='#e07a68',c2='#5e5a4c',c3='#a69c80',navon='#d8bd78',navonink='#0f100d',shadow='0 0 0 1px #2a2b24'),
 base('10px') + serif('Instrument Serif') + f"{H} main .mx-hd h3{{letter-spacing:.12em!important;text-transform:uppercase;font-size:11px!important}}\n")

skin('atelier', 'Warm clay and cream for beauty businesses; terracotta is the signal, Newsreader headlines.',
 dict(canvas='#ece5db',side='#ece5db',surf='#f7f2eb',rz='#fffcf7',line='#e0d6c8',line2='#cbbca8',ink='#2a211b',ink2='#56483e',mute='#6e6055',chip='#a4502e',onchip='#fff8f0',sig='#f0b08f',ok='#5f7a4a',warn='#a4502e',crit='#a83a2c',c2='#cdbba6',c3='#7a5f4c',navon='#a4502e',navonink='#fff8f0',shadow='0 1px 2px rgba(60,35,20,.05),0 12px 30px -18px rgba(60,35,20,.22)'),
 dict(canvas='#18140f',side='#18140f',surf='#221c16',rz='#2c251e',line='#352d25',line2='#4a3f34',ink='#f3ebe1',ink2='#d0c2b2',mute='#9e8d7d',chip='#d9784f',onchip='#18140f',sig='#d9784f',ok='#a3bf86',warn='#e0935f',crit='#e57b6e',c2='#6a5a4a',c3='#b39c84',navon='#d9784f',navonink='#18140f',shadow='0 0 0 1px #352d25'),
 base('20px') + serif('Newsreader', 500))

skin('console', 'Operator density: sage greys, mono figures, tighter corners, calm green as the signal.',
 dict(canvas='#dfe3dd',side='#e9ece6',surf='#f2f4ef',rz='#fafbf8',line='#d3d8d0',line2='#b9c0b5',ink='#111411',ink2='#3a403a',mute='#677066',chip='#111411',onchip='#c9f2cf',sig='#7ee08f',ok='#2e7a46',warn='#a86a14',crit='#b0372d',c2='#a9b1a6',c3='#4f5a4f',navon='#111411',navonink='#c9f2cf',shadow='0 0 0 1px #d3d8d0'),
 dict(canvas='#070807',side='#0c0e0c',surf='#111411',rz='#181c18',line='#1f241f',line2='#2f362f',ink='#dfe6dc',ink2='#a9b2a5',mute='#8a9486',chip='#7ee08f',onchip='#070807',sig='#7ee08f',ok='#7ee08f',warn='#f0b04a',crit='#f07a6a',c2='#4b544a',c3='#97a293',navon='#7ee08f',navonink='#070807',shadow='0 0 0 1px #1f241f'),
 base('8px') + f"{H} main :is(.mx-num,.mx-val,.mx-big b,.mx-xl,.mx-tiles b){{font-family:'Geist Mono',ui-monospace,monospace!important;letter-spacing:-.02em!important}}\n")

skin('mist', 'Cool mist and graphite (the Future Utility palette chosen before), lime kept for the signal.',
 dict(canvas='#d9dee2',side='#e3e7ea',surf='#f3f5f6',rz='#ffffff',line='#cdd3d7',line2='#b5bdc3',ink='#0f1418',ink2='#3a4148',mute='#626a71',chip='#0f1418',onchip='#c6f432',sig='#c6f432',ok='#2f7d52',warn='#b06a12',crit='#b8362c',c2='#a9b1b7',c3='#4b545b',navon='#0f1418',navonink='#c6f432',shadow='0 1px 2px rgba(15,20,24,.05),0 10px 28px -18px rgba(15,20,24,.25)'),
 dict(canvas='#0d0f10',side='#0d0f10',surf='#16191b',rz='#1f2326',line='#25292c',line2='#373c40',ink='#f1f2f2',ink2='#b9bcbf',mute='#8a8e92',chip='#c6f432',onchip='#0d0f10',sig='#c6f432',ok='#7fd49b',warn='#e6a23c',crit='#f07a6a',c2='#555b60',c3='#a0a5a9',navon='#c6f432',navonink='#0d0f10',shadow='0 0 0 1px #25292c'),
 base('22px'))
print('ok', sorted(os.listdir(OUT)))
