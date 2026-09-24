#!/usr/bin/env python3
"""Compile tokens.json into tokens.css for the app and the local preview harness.

The published design system compiles its own tokens.css from tokens.json; this
script produces the same shape for code in this repository, so tokens.json stays
the only place a value is written.  Run:  python3 design/system/build.py
"""
import json, pathlib

HERE = pathlib.Path(__file__).parent
t = json.loads((HERE / "tokens.json").read_text())

themes = [th["id"] for th in t["color"]["themes"]]
first = themes[0]
val = lambda v, th: v if isinstance(v, str) else v.get(th, v.get(first))

out = ["/* GENERATED from tokens.json by build.py. Edit tokens.json, then rebuild. */", ""]

for f in t["type"]["fonts"]:
    out.append(f"@font-face{{font-family:'{f['family']}';font-style:{f.get('style','normal')};"
               f"font-weight:{f['weight']};font-display:swap;src:url('{f['file']}') format('woff2');}}")
out.append("")

out.append(f':root, [data-theme="{first}"] {{')
for tok in t["color"]["tokens"]:
    out.append(f"  --{tok['name']}: {val(tok['value'], first)};")
out.append("}")
for th in themes[1:]:
    out.append(f'[data-theme="{th}"] {{')
    for tok in t["color"]["tokens"]:
        out.append(f"  --{tok['name']}: {val(tok['value'], th)};")
    out.append("}")

out.append(":root {")
for fam in [k for k, v in t.items() if isinstance(v, dict) and "tokens" in v and k != "color"]:
    for tok in t[fam]["tokens"]:
        out.append(f"  --{tok['name']}: {tok['value']};")
for key, stack in t["type"]["families"].items():
    out.append(f"  --font-{key}: {stack};")
out.append("}")

for g in t["type"]["groups"]:
    for s in g["styles"]:
        fam = s.get("family", g.get("family"))
        decl = [f"font-family:var(--font-{fam})", f"font-size:{s['fontSize']}",
                f"line-height:{s['lineHeight']}", f"font-weight:{s['fontWeight']}"]
        if "letterSpacing" in s: decl.append(f"letter-spacing:{s['letterSpacing']}")
        out.append(f".{s['name']}{{{';'.join(decl)}}}")

(HERE / "tokens.css").write_text("\n".join(out) + "\n")
print("wrote", HERE / "tokens.css")
