const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'resume_db',
  port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error connecting:', err);
  } else {
    console.log('Connected! Current time:', res.rows[0]);
  }
  pool.end();
});
