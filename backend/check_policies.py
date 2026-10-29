from dotenv import load_dotenv
load_dotenv()

from app.database import supabase_admin

res = supabase_admin.table('persona').select('*').limit(1).execute()
print("Persona fetch works as admin:", len(res.data) > 0)

# The user is complaining that "Tu contacto" is still appearing, and we're missing the name.
# Let's see what the latest incidente has
res_inc = supabase_admin.table('incidente').select('*').order('fecha_hora', desc=True).limit(1).execute()
if res_inc.data:
    print("Latest incidente:", res_inc.data[0])
    vid = res_inc.data[0].get('victima_id')
    
    # Try fetching as an anonymous user (simulating mobile app)
    # The client doesn't use anon key directly to fetch persona without a JWT if RLS is on.
    # We can check pg_policies
    try:
        policies = supabase_admin.rpc('exec_sql', {'query': "SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'persona'"}).execute()
        print("Policies:", policies.data)
    except Exception as e:
        print("Could not fetch policies via rpc:", e)
