import postgres from 'postgres';

const sql = postgres('postgres://v2ex:v2ex_password@127.0.0.1:55433/v2ex_loadtest', {
  max: 2,
  prepare: false,
});

async function main() {
  // insert without returning in simple mode -> count?
  const r1 = await sql.unsafe(
    "INSERT INTO categories (name, title, sort, created_at) SELECT 'c_'||g,'c',0,now() FROM generate_series(1,4) s(g)",
  );
  console.log('insert no-return:', JSON.stringify(r1), 'count=', r1.count);
  await sql.unsafe("DELETE FROM categories WHERE name LIKE 'c_%'");

  // end with options
  console.log('end type ok');

  // LIMIT/OFFSET inside subquery with params (extended protocol, single stmt)
  const r2 = await sql.unsafe(
    `SELECT id FROM categories ORDER BY id LIMIT $1 OFFSET $2`,
    [2, 1],
  );
  console.log('params limit/offset:', JSON.stringify(r2));

  // multiple statements in one unsafe call (simple mode)
  const r3 = await sql.unsafe(`SELECT 1 AS a; SELECT 2 AS b;`);
  console.log('multi-stmt:', JSON.stringify(r3));

  // interpolate int safely
  const n = 7;
  const r4 = await sql.unsafe(`SELECT ${n}::int AS v`);
  console.log('interp int:', JSON.stringify(r4));

  await sql.end({ timeout: 5 });
  console.log('ended ok');
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
