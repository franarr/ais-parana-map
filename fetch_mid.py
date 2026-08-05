import urllib.request
import json
import re

req = urllib.request.Request('https://en.wikipedia.org/wiki/Maritime_identification_digits', headers={'User-Agent': 'Mozilla/5.0'})
html = urllib.request.urlopen(req).read().decode('utf-8')
mids = {}
for match in re.finditer(r'<td>(\d{3})</td>.*?<a href="[^"]+" title="([^"]+)"', html, re.DOTALL):
    code, country = match.groups()
    if 'Flag' not in country and 'List of' not in country:
        mids[code] = country.replace(' (country)', '')
with open('data/mid.json', 'w', encoding='utf-8') as f:
    json.dump(mids, f, ensure_ascii=False)
print(len(mids))
