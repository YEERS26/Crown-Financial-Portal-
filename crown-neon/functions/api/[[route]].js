import { neon } from '@neondatabase/serverless';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
function err(msg, status = 400) { return json({ error: msg }, status); }
function checkAuth(req, env) { return req.headers.get('Authorization') === `Bearer ${env.APP_SECRET}`; }

export async function onRequest(context) {
  const { request, env } = context;
  const path = new URL(request.url).pathname.replace(/^\/api\//, '').replace(/\/$/, '');

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  if (path === 'login' && request.method === 'POST') {
    const { email, password } = await request.json().catch(() => ({}));
    if (email === env.APP_EMAIL && password === env.APP_PASSWORD) return json({ token: env.APP_SECRET });
    return err('Incorrect email or password.', 401);
  }

  if (!checkAuth(request, env)) return err('Unauthorised', 401);

  const sql = neon(env.NEON_CONNECTION_STRING);

  try {
    if (path === 'definitions' && request.method === 'GET')
      return json(await sql`SELECT * FROM payment_definitions ORDER BY id`);

    if (path === 'definitions' && request.method === 'POST') {
      const b = await request.json();
      const rows = await sql`INSERT INTO payment_definitions (name,category,freq,weekday,day_of_month,next_date,amount,credit_bal,credit_max,priority,start_date,end_date) VALUES (${b.name},${b.category},${b.freq},${b.weekday||null},${b.day_of_month||null},${b.next_date||null},${b.amount},${b.credit_bal??null},${b.credit_max??null},${b.priority||''},${b.start_date||null},${b.end_date||null}) RETURNING *`;
      return json(rows[0]);
    }

    const defMatch = path.match(/^definitions\/(\d+)$/);
    if (defMatch && request.method === 'PUT') {
      const b = await request.json();
      const rows = await sql`UPDATE payment_definitions SET name=${b.name},category=${b.category},freq=${b.freq},weekday=${b.weekday||null},day_of_month=${b.day_of_month||null},next_date=${b.next_date||null},amount=${b.amount},credit_bal=${b.credit_bal??null},credit_max=${b.credit_max??null},priority=${b.priority||''},start_date=${b.start_date||null},end_date=${b.end_date||null},updated_at=NOW() WHERE id=${parseInt(defMatch[1])} RETURNING *`;
      return json(rows[0]);
    }

    if (defMatch && request.method === 'DELETE') {
      await sql`DELETE FROM payment_definitions WHERE id=${parseInt(defMatch[1])}`;
      return json({ ok: true });
    }

    if (path === 'instances' && request.method === 'GET')
      return json(await sql`SELECT * FROM payment_instances ORDER BY date`);

    if (path === 'instances' && request.method === 'POST') {
      const b = await request.json();
      if (Array.isArray(b)) {
        if (!b.length) return json([]);
        const inserted = [];
        for (const r of b) {
          const rows = await sql`INSERT INTO payment_instances (def_id,date,amount,status) VALUES (${r.def_id},${r.date},${r.amount},${r.status||''}) ON CONFLICT (def_id,date) DO NOTHING RETURNING *`;
          if (rows[0]) inserted.push(rows[0]);
        }
        return json(inserted);
      }
      const rows = await sql`INSERT INTO payment_instances (def_id,date,amount,status) VALUES (${b.def_id},${b.date},${b.amount},${b.status||''}) ON CONFLICT (def_id,date) DO UPDATE SET amount=EXCLUDED.amount,status=EXCLUDED.status RETURNING *`;
      return json(rows[0]);
    }

    const instMatch = path.match(/^instances\/(\d+)$/);
    if (instMatch && request.method === 'PUT') {
      const b = await request.json();
      const rows = await sql`UPDATE payment_instances SET status=${b.status||''},amount=${b.amount},updated_at=NOW() WHERE id=${parseInt(instMatch[1])} RETURNING *`;
      return json(rows[0]);
    }

    if (path === 'instances/cascade' && request.method === 'PUT') {
      const { def_id, amount, from_date } = await request.json();
      await sql`UPDATE payment_instances SET amount=${amount},updated_at=NOW() WHERE def_id=${def_id} AND status!='Paid' AND date>=${from_date}`;
      return json({ ok: true });
    }

    if (path === 'instances/future' && request.method === 'DELETE') {
      const { def_id, from_date } = await request.json();
      await sql`DELETE FROM payment_instances WHERE def_id=${def_id} AND status!='Paid' AND date>=${from_date}`;
      return json({ ok: true });
    }

    return err('Not found', 404);
  } catch(e) {
    console.error(e);
    return err(e.message, 500);
  }
}
