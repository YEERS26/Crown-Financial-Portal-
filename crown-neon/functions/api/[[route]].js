// functions/api/[[route]].js
// Cloudflare Pages Function — uses Neon HTTP API correctly

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

// Neon HTTP API - correct format
async function sql(env, query, params = []) {
  const connStr = env.NEON_CONNECTION_STRING;
  const match = connStr.match(/postgresql:\/\/([^:]+):([^@]+)@([^/]+)\/(.+?)(\?.*)?$/);
  if (!match) throw new Error('Invalid connection string');
  const [, user, password, host] = match;

  const res = await fetch(`https://${host}/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + btoa(`${user}:${password}`),
      'Neon-Connection-String': connStr,
    },
    body: JSON.stringify({ query, params: params.map(p => p === null ? null : p) }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Neon error: ${text}`);
  const data = JSON.parse(text);
  return { rows: data.rows || [] };
}

function checkAuth(request, env) {
  return request.headers.get('Authorization') === `Bearer ${env.APP_SECRET}`;
}

export async function onRequest(context) {
  const { request, env } = context;
  const path = new URL(request.url).pathname.replace(/^\/api\//, '').replace(/\/$/, '');

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  // LOGIN
  if (path === 'login' && request.method === 'POST') {
    const { email, password } = await request.json().catch(() => ({}));
    if (email === env.APP_EMAIL && password === env.APP_PASSWORD) return json({ token: env.APP_SECRET });
    return err('Incorrect email or password.', 401);
  }

  if (!checkAuth(request, env)) return err('Unauthorised', 401);

  try {
    if (path === 'definitions' && request.method === 'GET') {
      return json((await sql(env, 'SELECT * FROM payment_definitions ORDER BY id')).rows);
    }

    if (path === 'definitions' && request.method === 'POST') {
      const b = await request.json();
      const r = await sql(env,
        `INSERT INTO payment_definitions (name,category,freq,weekday,day_of_month,next_date,amount,credit_bal,credit_max,priority)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [b.name,b.category,b.freq,b.weekday||null,b.day_of_month||null,b.next_date||null,b.amount,b.credit_bal??null,b.credit_max??null,b.priority||'']
      );
      return json(r.rows[0]);
    }

    const defMatch = path.match(/^definitions\/(\d+)$/);
    if (defMatch && request.method === 'PUT') {
      const b = await request.json();
      const r = await sql(env,
        `UPDATE payment_definitions SET name=$1,category=$2,freq=$3,weekday=$4,day_of_month=$5,next_date=$6,amount=$7,credit_bal=$8,credit_max=$9,priority=$10,updated_at=NOW() WHERE id=$11 RETURNING *`,
        [b.name,b.category,b.freq,b.weekday||null,b.day_of_month||null,b.next_date||null,b.amount,b.credit_bal??null,b.credit_max??null,b.priority||'',defMatch[1]]
      );
      return json(r.rows[0]);
    }

    if (defMatch && request.method === 'DELETE') {
      await sql(env, 'DELETE FROM payment_definitions WHERE id=$1', [defMatch[1]]);
      return json({ ok: true });
    }

    if (path === 'instances' && request.method === 'GET') {
      return json((await sql(env, 'SELECT * FROM payment_instances ORDER BY date')).rows);
    }

    if (path === 'instances' && request.method === 'POST') {
      const b = await request.json();
      if (Array.isArray(b)) {
        if (!b.length) return json([]);
        const vals = b.map((_,i) => `($${i*4+1},$${i*4+2},$${i*4+3},$${i*4+4})`).join(',');
        const r = await sql(env,
          `INSERT INTO payment_instances (def_id,date,amount,status) VALUES ${vals} ON CONFLICT (def_id,date) DO NOTHING RETURNING *`,
          b.flatMap(r => [r.def_id,r.date,r.amount,r.status||''])
        );
        return json(r.rows);
      }
      const r = await sql(env,
        `INSERT INTO payment_instances (def_id,date,amount,status) VALUES ($1,$2,$3,$4) ON CONFLICT (def_id,date) DO UPDATE SET amount=EXCLUDED.amount,status=EXCLUDED.status RETURNING *`,
        [b.def_id,b.date,b.amount,b.status||'']
      );
      return json(r.rows[0]);
    }

    const instMatch = path.match(/^instances\/(\d+)$/);
    if (instMatch && request.method === 'PUT') {
      const b = await request.json();
      const r = await sql(env, `UPDATE payment_instances SET status=$1,amount=$2,updated_at=NOW() WHERE id=$3 RETURNING *`, [b.status||'',b.amount,instMatch[1]]);
      return json(r.rows[0]);
    }

    if (path === 'instances/cascade' && request.method === 'PUT') {
      const { def_id, amount, from_date } = await request.json();
      await sql(env, `UPDATE payment_instances SET amount=$1,updated_at=NOW() WHERE def_id=$2 AND status!='Paid' AND date>=$3`, [amount,def_id,from_date]);
      return json({ ok: true });
    }

    if (path === 'instances/future' && request.method === 'DELETE') {
      const { def_id, from_date } = await request.json();
      await sql(env, `DELETE FROM payment_instances WHERE def_id=$1 AND status!='Paid' AND date>=$2`, [def_id,from_date]);
      return json({ ok: true });
    }

    return err('Not found', 404);
  } catch(e) {
    console.error(e);
    return err(e.message, 500);
  }
}
