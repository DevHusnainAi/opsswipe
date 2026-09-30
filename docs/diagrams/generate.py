# Draws the README diagrams, docs/diagrams/architecture.svg and docs/diagrams/loop.svg: plain SVG with hand-placed
# boxes and arrows (no dependencies). Edit the layout below, then run: python3 docs/diagrams/generate.py
import html, os, sys
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
FONT = "font-family=\"-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif\""
C = dict(bg='#FAFAF9', box='#FFFFFF', line='#D6D3D1', text='#1C1917', muted='#57534E', arrow='#78716C',
         group='#F5F5F4', gline='#A8A29E', green='#10B981', greenTint='#ECFDF5', amber='#F59E0B', amberTint='#FFFBEB',
         blue='#3B82F6', blueTint='#EFF6FF', violet='#8B5CF6', violetTint='#F5F3FF')

def esc(s): return html.escape(s)

class SVG:
    def __init__(s, w, h): s.w, s.h, s.parts = w, h, []
    def add(s, x): s.parts.append(x)
    def box(s, x, y, w, h, title, lines=(), stroke=None, fill=None, title_color=None, r=12, sw=1.5):
        s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill or C["box"]}" stroke="{stroke or C["line"]}" stroke-width="{sw}"/>')
        n = len(lines); lh = 17
        ty = y + h / 2 - (n * lh) / 2 + 4
        s.add(f'<text x="{x+w/2}" y="{ty}" text-anchor="middle" font-size="15" font-weight="600" fill="{title_color or C["text"]}" {FONT}>{esc(title)}</text>')
        for i, l in enumerate(lines):
            s.add(f'<text x="{x+w/2}" y="{ty + 19 + i*lh}" text-anchor="middle" font-size="12.5" fill="{C["muted"]}" {FONT}>{esc(l)}</text>')
    def group(s, x, y, w, h, label):
        s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="{C["group"]}" stroke="{C["gline"]}" stroke-width="1.5"/>')
        s.add(f'<text x="{x+20}" y="{y+26}" font-size="14" font-weight="700" fill="{C["text"]}" {FONT}>{esc(label)}</text>')
    def path(s, pts, label=None, lx=None, ly=None, dashed=False, color=None, anchor='middle'):
        d = 'M' + ' L'.join(f'{a},{b}' for a, b in pts)
        dash = ' stroke-dasharray="5 4"' if dashed else ''
        s.add(f'<path d="{d}" fill="none" stroke="{color or C["arrow"]}" stroke-width="1.6" marker-end="url(#arrow)"{dash}/>')
        if label:
            w = 6.6 * len(label) + 12
            bx = lx - w / 2 if anchor == 'middle' else lx - 6
            s.add(f'<rect x="{bx}" y="{ly - 11}" width="{w}" height="20" rx="5" fill="{C["bg"]}"/>')
            s.add(f'<text x="{lx}" y="{ly+3}" text-anchor="{anchor}" font-size="12" font-style="italic" fill="{C["muted"]}" {FONT}>{esc(label)}</text>')
    def text(s, x, y, t, size=13, weight=400, color=None, anchor='start'):
        s.add(f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" font-weight="{weight}" fill="{color or C["text"]}" {FONT}>{esc(t)}</text>')
    def render(s):
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s.w} {s.h}" width="{s.w}" height="{s.h}">'
                f'<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
                f'<path d="M0,0 L10,5 L0,10 z" fill="{C["arrow"]}"/></marker></defs>'
                f'<rect width="{s.w}" height="{s.h}" rx="18" fill="{C["bg"]}"/>')
        return head + ''.join(s.parts) + '</svg>'

# ---------------- architecture ----------------
a = SVG(1200, 830)
a.text(40, 46, 'Every signal becomes one card; code fixes merge only after CI proves them', 20, 700)
# signals
sig = [('Your app', ['signed 5xx reports']), ('Sentry', ['issue alerts']), ('Alert inbox', ['Grafana, Alertmanager, JSON']),
       ('Health check', ['every minute, pg_cron']), ('AI agents', ['Claude Code hook, API'])]
for i, (t, l) in enumerate(sig):
    x = 40 + i * 230
    a.box(x, 72, 200, 66, t, l)
    a.path([(x + 100, 138), (x + 100, 176)])
# backend
a.group(40, 180, 1120, 272, 'OpsSwipe backend · Supabase Edge Functions')
a.box(60, 214, 346, 64, 'Postgres + row-level security', ['incidents, services, teams, audit log'], fill='#FFFFFF')
a.box(427, 214, 346, 64, 'Vault', ['every key and token, read only by the server'])
a.box(794, 214, 346, 64, 'Schedules', ['health check, re-page, escalation, weekly'])
fx = [60, 335, 610, 885]
a.box(fx[0], 330, 255, 96, 'Incident engine', ['one card per service', 'rules pick the fix,', 'AI gives a second opinion'])
a.box(fx[1], 330, 255, 96, 'execute', ['checks owner, plan and', 'the phone\'s fix key,', 'then runs the fix'])
a.box(fx[2], 330, 255, 96, 'proof', ['grades the OIDC-signed CI run:', 'every failing request', 'went from 5xx to 2xx'], stroke=C['green'], fill=C['greenTint'], sw=2)
a.box(fx[3], 330, 255, 96, 'connect + OAuth', ['GitHub, Google, Railway,', 'Slack, Discord; teams', 'and email invites'])
# proof -> engine (merge unlocked), in the gap above the functions
a.path([(737, 330), (737, 306), (187, 306), (187, 328)], 'Merge unlocked', 462, 306, color=C['green'])
# outputs
oy = 560
outs = [('Alerts', ['alarm push, Slack, Discord'], None, None), ('Phone app', ['swipe + fingerprint'], C['blue'], C['blueTint']),
        ('Your services', ['GCP VM, Render, Railway'], None, None), ('GitHub', ['revert / AI fix PR, merge'], None, None),
        ('GitHub Actions', ['replays failing requests', 'in locked-down containers'], None, None)]
for i, (t, l, st, fi) in enumerate(outs):
    a.box(40 + i * 230, oy, 200, 76, t, l, stroke=st, fill=fi, sw=2 if st else 1.5)
# engine -> alarm
a.path([(140, 426), (140, oy - 2)], 'page', 150, 480, anchor='start')
# alarm -> phone
a.path([(240, oy + 38), (268, oy + 38)])
# phone -> execute (up)
a.path([(370, oy), (370, 428)], 'id + fix + fix key', 380, 480, color=C['blue'], anchor='start')
# execute -> your services
a.path([(545, 426), (545, oy - 2)], 'reboot, restart, roll back', 555, 532, anchor='start')
# execute -> github
a.path([(580, 426), (580, 502), (830, 502), (830, oy - 2)], 'open PR, merge proven commit', 705, 502)
# github -> actions
a.path([(930, oy + 38), (958, oy + 38)])
# actions -> proof
a.path([(1060, oy), (1060, 478), (850, 478), (850, 428)], 'OIDC-signed results', 955, 478, color=C['green'])
# external strip
a.box(40, 690, 1120, 96, '', (), fill='#FFFFFF')
a.text(64, 720, 'Also used by the backend', 14, 700)
ext = [('AI models', 'NVIDIA Nemotron, Groq backup'), ('RevenueCat', 'plans, revenue at risk'), ('Resend', 'team invite emails'),
       ('Expo push', 'alarm channel on Android'), ('GitHub Pages', 'public status page')]
for i, (t, d) in enumerate(ext):
    x = 64 + i * 218
    a.text(x, 750, t, 14, 600)
    a.text(x, 770, d, 12.5, 400, C['muted'])
open(f'{OUT}/architecture.svg', 'w').write(a.render())

# ---------------- the loop ----------------
L = SVG(1200, 470)
L.text(40, 46, 'From a failing request to a proven fix, in seven steps', 20, 700)
who = {'app': ('Your app', C['violet'], C['violetTint']), 'ops': ('OpsSwipe', C['green'], C['greenTint']),
       'you': ('You', C['blue'], C['blueTint']), 'gh': ('GitHub', C['amber'], C['amberTint'])}
steps = [('app', 'Production breaks', ['your app reports', 'GET /api/price → 500']),
         ('ops', 'Your phone rings', ['one card: likely cause', 'and a suggested fix']),
         ('you', 'Swipe + fingerprint', ['approve Revert PR', '(or Fix with AI)']),
         ('gh', 'PR with the failures', ['the failing requests', 'ride into the PR']),
         ('gh', 'CI proves it', ['/api/price: 500 → 200', 'tests pass']),
         ('you', 'Swipe to merge', ['merged at the exact', 'commit CI proved']),
         ('ops', 'Back up, verified', ['OpsSwipe re-checks', '/api/price in production'])]
W, H = 245, 118
pos = [(40 + i * 285, 90) for i in range(4)] + [(40 + (7 - i) * 285, 300) for i in range(4, 7)]
for n, ((k, t, l), (x, y)) in enumerate(zip(steps, pos), 1):
    name, col, tint = who[k]
    L.box(x, y, W, H, t, l, stroke=col, fill=tint, sw=2)
    L.add(f'<circle cx="{x+22}" cy="{y+22}" r="13" fill="{col}"/>')
    L.text(x + 22, y + 27, str(n), 13, 700, '#FFFFFF', 'middle')
    L.text(x + W - 12, y + 26, name, 11.5, 600, col, 'end')
for n in range(3):
    x, y = pos[n]
    L.path([(x + W, y + H / 2), (pos[n + 1][0] - 2, y + H / 2)])
x, y = pos[3]
L.path([(x + W / 2, y + H), (x + W / 2, 298)])
for n in range(4, 6):
    x, y = pos[n]
    L.path([(x, y + H / 2), (pos[n + 1][0] + W + 2, y + H / 2)])
L.text(600, 452, 'A 4xx or a redirect is not a fix: merge unlocks only when every failing request answers 2xx.', 13, 400, C['muted'], 'middle')
open(f'{OUT}/loop.svg', 'w').write(L.render())
print('ok')
