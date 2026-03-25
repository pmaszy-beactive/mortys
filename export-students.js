const { Pool } = require('@neondatabase/serverless');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function exportStudents() {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM students ORDER BY id');
    const students = result.rows;
    
    console.log(`-- Students Export (${students.length} records)`);
    console.log('-- Run in production database console');
    console.log('');
    
    for (const s of students) {
      const esc = (v) => v ? `'${String(v).replace(/'/g, "''")}'` : 'NULL';
      const num = (v) => v === null || v === undefined ? 'NULL' : v;
      
      const cols = 'id, user_id, first_name, last_name, email, phone, date_of_birth, address, course_type, status, progress, instructor_id, city, postal_code, province, country, enrollment_date, total_amount_due, amount_paid, phase, account_status, location_id';
      const vals = [
        num(s.id),
        num(s.user_id),
        esc(s.first_name),
        esc(s.last_name),
        esc(s.email),
        esc(s.phone),
        esc(s.date_of_birth),
        esc(s.address),
        esc(s.course_type),
        s.status ? esc(s.status) : "'active'",
        num(s.progress) || 0,
        num(s.instructor_id),
        esc(s.city),
        esc(s.postal_code),
        esc(s.province),
        esc(s.country),
        esc(s.enrollment_date),
        num(s.total_amount_due) || 0,
        num(s.amount_paid) || 0,
        esc(s.phase),
        s.account_status ? esc(s.account_status) : "'pending_invite'",
        num(s.location_id)
      ];
      
      console.log(`INSERT INTO students (${cols}) VALUES (${vals.join(', ')});`);
    }
    
    console.log('');
    console.log("SELECT setval('students_id_seq', (SELECT MAX(id) FROM students));");
    
  } finally {
    client.release();
    await pool.end();
  }
}

exportStudents().catch(console.error);
