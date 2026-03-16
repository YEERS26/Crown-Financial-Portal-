// functions/api/[[route]].js
// Cloudflare Pages Function — handles all database calls via Neon HTTP API
// Deployed automatically by Cloudflare Pages alongside your static site.

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

// Run a SQL query against Neon via their HTTP API
async function sql(env, query, params = []) {
  const res = await fetch(env.NEON_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.NEON_API_KEY}`,
      'Neon-Connection-String': env.NEON_CONNECTION_STRING,
    },
    body: JSON.stringify({ query, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Neon error: ${text}`);
  }
  return res.json();
}

// Simple session token check (stored in CF KV or just a shared secret)
function checkAuth(request, env) {
  const auth = request.headers.get('Authorization') || '';
  return auth === `Bearer ${env.APP_SECRET}`;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const url  = new URL(request.url);
  const path = url.pathname.replace('/api/', '').replace(/\/$/, '');

  // Preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // LOGIN — returns a session token
  if (path === 'login' && request.method === 'POST') {
    const { email, password } = await request.json();
    if (email === env.APP_EMAIL && password === env.APP_PASSWORD) {
      return json({ token: env.APP_SECRET });
    }
    return err('Incorrect email or password.', 401);
  }

  // All other routes require auth
  if (!checkAuth(request, env)) return err('Unauthorised', 401);

  try {
    // ── GET /api/definitions ─────────────────────────────────────
    if (path === 'definitions' && request.method === 'GET') {
      const result = await sql(env, 'SELECT * FROM payment_definitions ORDER BY id');
      return json(result.rows);
    }

    // ── POST /api/definitions ────────────────────────────────────
    if (path === 'definitions' && request.method === 'POST') {
      const b = await request.json();
      const result = await sql(env,
        `INSERT INTO payment_definitions (name,category,freq,weekday,day_of_month,next_date,amount,credit_bal,credit_max,priority)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [b.name, b.category, b.freq, b.weekday||null, b.day_of_month||null, b.next_date||null,
         b.amount, b.credit_bal||null, b.credit_max||null, b.priority||'']
      );
      return json(result.rows[0]);
    }

    // ── PUT /api/definitions/:id ─────────────────────────────────
    const defMatch = path.match(/^definitions\/(\d+)$/);
    if (defMatch && request.method === 'PUT') {
      const id = parseInt(defMatch[1]);
      const b  = await request.json();
      const result = await sql(env,
        `UPDATE payment_definitions SET
          name=$1, category=$2, freq=$3, weekday=$4, day_of_month=$5,
          next_date=$6, amount=$7, credit_bal=$8, credit_max=$9,
          priority=$10, updated_at=NOW()
         WHERE id=$11 RETURNING *`,
        [b.name, b.category, b.freq, b.weekday||null, b.day_of_month||null,
         b.next_date||null, b.amount, b.credit_bal??null, b.credit_max??null,
         b.priority||'', id]
      );
      return json(result.rows[0]);
    }

    // ── DELETE /api/definitions/:id ──────────────────────────────
    if (defMatch && request.method === 'DELETE') {
      const id = parseInt(defMatch[1]);
      await sql(env, 'DELETE FROM payment_definitions WHERE id=$1', [id]);
      return json({ ok: true });
    }

    // ── GET /api/instances ───────────────────────────────────────
    if (path === 'instances' && request.method === 'GET') {
      const result = await sql(env, 'SELECT * FROM payment_instances ORDER BY date');
      return json(result.rows);
    }

    // ── POST /api/instances ──────────────────────────────────────
    if (path === 'instances' && request.method === 'POST') {
      const b = await request.json();
      // Single insert or bulk upsert
      if (Array.isArray(b)) {
        if (!b.length) return json([]);
        // Build bulk upsert
        const values = b.map((r, i) => `($${i*3+1},$${i*3+2},$${i*3+3})`).join(',');
        const flat   = b.flatMap(r => [r.def_id, r.date, r.amount]);
        const result = await sql(env,
          `INSERT INTO payment_instances (def_id,date,amount,status)
           VALUES ${b.map((_,i)=>`($${i*4+1},$${i*4+2},$${i*4+3},$${i*4+4})`).join(',')}
           ON CONFLICT (def_id,date) DO NOTHING RETURNING *`,
          b.flatMap(r => [r.def_id, r.date, r.amount, r.status||''])
        );
        return json(result.rows);
      } else {
        const result = await sql(env,
          `INSERT INTO payment_instances (def_id,date,amount,status)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (def_id,date) DO UPDATE SET amount=EXCLUDED.amount, status=EXCLUDED.status
           RETURNING *`,
          [b.def_id, b.date, b.amount, b.status||'']
        );
        return json(result.rows[0]);
      }
    }

    // ── PUT /api/instances/:id ───────────────────────────────────
    const instMatch = path.match(/^instances\/(\d+)$/);
    if (instMatch && request.method === 'PUT') {
      const id = parseInt(instMatch[1]);
      const b  = await request.json();
      const result = await sql(env,
        `UPDATE payment_instances SET status=$1, amount=$2, updated_at=NOW() WHERE id=$3 RETURNING *`,
        [b.status||'', b.amount, id]
      );
      return json(result.rows[0]);
    }

    // ── PUT /api/instances/cascade ───────────────────────────────
    // Updates all future unpaid instances for a def to a new amount
    if (path === 'instances/cascade' && request.method === 'PUT') {
      const { def_id, amount, from_date } = await request.json();
      await sql(env,
        `UPDATE payment_instances SET amount=$1, updated_at=NOW()
         WHERE def_id=$2 AND status != 'Paid' AND date >= $3`,
        [amount, def_id, from_date]
      );
      return json({ ok: true });
    }

    // ── DELETE /api/instances/future ─────────────────────────────
    // Deletes future unpaid instances for a def (when freq changes)
    if (path === 'instances/future' && request.method === 'DELETE') {
      const { def_id, from_date } = await request.json();
      await sql(env,
        `DELETE FROM payment_instances WHERE def_id=$1 AND status != 'Paid' AND date >= $2`,
        [def_id, from_date]
      );
      return json({ ok: true });
    }

    return err('Not found', 404);

  } catch (e) {
    console.error(e);
    return err(e.message, 500);
  }
}
