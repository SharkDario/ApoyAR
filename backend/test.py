import urllib.request, json, urllib.error
req = urllib.request.Request(
    'http://127.0.0.1:8000/api/v1/incidentes/activar',
    headers={'X-Api-Secret': 'c5d47f05ad5874a98c2c370669e2fba14976fba52437fa596502fbd4e3ef8bb4', 'Content-Type': 'application/json'},
    data=json.dumps({'incidente_id': '27252fbb-bda1-4ba3-8594-a5bf9ab50e92', 'victima_id': '5fbbf4ee-da82-45d4-bc76-46528164ab35', 'latitud': 0, 'longitud': 0}).encode('utf-8')
)
try:
    res = urllib.request.urlopen(req)
    print(res.status, res.read().decode())
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode())
