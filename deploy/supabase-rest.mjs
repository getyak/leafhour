const required = (name, env = process.env) => {
  const value = env[name];
  if (!value) throw Object.assign(new Error(`Missing ${name}`), { status: 503 });
  return value;
};

export function createSupabaseRest(env = process.env) {
  const base = required('SUPABASE_URL', env).replace(/\/$/, '');
  const secret = required('SUPABASE_SECRET_KEY', env);
  const headers = {
    apikey: secret,
    'Content-Type': 'application/json',
  };
  if (secret.startsWith('eyJ')) headers.Authorization = `Bearer ${secret}`;

  async function request(path, options = {}) {
    const response = await fetch(`${base}/rest/v1/${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = new Error(body?.message || body?.hint || 'Database request failed');
      error.status = response.status;
      throw error;
    }
    return body;
  }

  return {
    one: async (table, query) => {
      const rows = await request(`${table}?${query}&limit=1`);
      if (!rows?.length) throw Object.assign(new Error('Private reader data is not ready'), { status: 503 });
      return rows[0];
    },
    upsert: (table, row, conflict) => request(`${table}?on_conflict=${encodeURIComponent(conflict)}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(row),
    }),
  };
}
