# Vygeneruje jednoduché podstránky se společnou hlavičkou a patičkou z index.html.
# Spuštění: python3 tools/pages.py  (po změně hlavičky/patičky v index.html)
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
idx = (root / "index.html").read_text()
top = idx[idx.index('<div class="topline">'):idx.index('<div class="notice"')]
foot = idx[idx.index('<footer class="site-foot">'):idx.index('</footer>') + 9]
head = idx[:idx.index('<style>')]

for src in sorted((root / "tools" / "pages").glob("*.html")):
    s = src.read_text()
    title = re.search(r"<!--title:(.*?)-->", s).group(1)
    desc = re.search(r"<!--desc:(.*?)-->", s).group(1)
    style = (re.search(r"(?s)<style>.*?</style>", s) or [""])[0]
    body = re.sub(r"(?s)<!--(title|desc):.*?-->|<style>.*?</style>", "", s).strip()
    h = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", head)
    h = re.sub(r'<meta name="description" content=".*?">', f'<meta name="description" content="{desc}">', h)
    h = re.sub(r'(?s)<meta property="og:.*?>\n', "", h)
    out = f'{h}{style}\n</head>\n<body>\n\n{top}<main>\n{body}\n</main>\n\n{foot}\n</body>\n</html>\n'
    (root / src.name).write_text(out)
    print("ok", src.name)
