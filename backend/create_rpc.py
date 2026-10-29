import urllib.request
import urllib.parse
import json
import os
from dotenv import load_dotenv
load_dotenv()

sql = """
CREATE OR REPLACE FUNCTION obtener_mi_nombre()
RETURNS TABLE (nombre VARCHAR, apellido VARCHAR)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT nombre, apellido FROM persona WHERE usuario_id = auth.uid();
$$;
"""

url = os.environ.get("EXPO_PUBLIC_SUPABASE_URL") + "/rest/v1/rpc/exec_sql"
headers = {
    "apikey": os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY"),
    "Authorization": "Bearer " + os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY"),
    "Content-Type": "application/json"
}
data = json.dumps({"query": sql}).encode('utf-8')

req = urllib.request.Request(url, data=data, headers=headers, method='POST')
try:
    with urllib.request.urlopen(req) as response:
        print("Status:", response.status)
        print("Body:", response.read().decode())
except urllib.error.HTTPError as e:
    print("HTTP Error:", e.code, e.read().decode())
except Exception as e:
    print("Error:", e)
