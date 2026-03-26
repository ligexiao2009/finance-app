// Test PostgreSQL database connection
const { Pool } = require('pg');
console.log('ENV:', process.env.DATABASE_URL);
console.log('Testing PostgreSQL connection...');

let poolConfig;
if (process.env.DATABASE_URL) {
  // Use connection string (e.g., from Supabase)
  console.log('Using DATABASE_URL connection string');
  poolConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  };
} else {
  // Use individual environment variables (for local development)
  console.log('Using individual environment variables');
  poolConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'stockdb',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  };
}

const pool = new Pool(poolConfig);

async function testConnection() {
  let client;
  try {
    client = await pool.connect();
    console.log('✅ PostgreSQL connection successful!');

    // Check if database exists
    const dbRes = await client.query('SELECT current_database()');
    console.log(`✅ Connected to database: ${dbRes.rows[0].current_database}`);

    // Check PostgreSQL version
    const versionRes = await client.query('SELECT version()');
    console.log(`✅ PostgreSQL version: ${versionRes.rows[0].version.split(',')[0]}`);

    // List tables to check if schema exists
    const tablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log(`✅ Found ${tablesRes.rows.length} tables in public schema`);

    return true;
  } catch (error) {
    console.error('❌ PostgreSQL connection failed:');
    console.error(`   Error: ${error.message}`);
    console.error(`   Error code: ${error.code}`);

    if (error.code === 'ECONNREFUSED') {
      console.error('\n📋 Troubleshooting steps:');
      console.error('   1. Make sure PostgreSQL is installed and running');
      console.error('   2. Check if PostgreSQL service is started:');
      console.error('      - macOS: brew services start postgresql');
      console.error('      - Linux: sudo systemctl start postgresql');
      console.error('      - Windows: Start PostgreSQL service in Services');
      console.error('   3. Create database if not exists:');
      console.error('      createdb stockdb');
      console.error('   4. Or use environment variables to configure connection:');
      console.error('      DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD');
    } else if (error.code === '3D000') {
      console.error('\n📋 Database does not exist. Create it with:');
      console.error('      createdb stockdb');
    } else if (error.code === '28P01') {
      console.error('\n📋 Authentication failed. Check username/password.');
    } else if (error.code === '28000') {
      console.error('\n📋 Invalid authorization specification. Check connection string.');
    }

    return false;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

// Run test
testConnection().then(success => {
  if (success) {
    console.log('\n✅ Database connection test passed!');
    console.log('\nNext steps:');
    console.log('   1. Run: node init-db.js (to initialize tables)');
    console.log('   2. Run: node migrate-data.js (to migrate JSON data)');
    console.log('   3. Run: node server.js (to start the server)');
    process.exit(0);
  } else {
    console.log('\n❌ Database connection test failed.');
    console.log('\n📖 For Supabase connection:');
    console.log('   Set DATABASE_URL environment variable:');
    console.log('   export DATABASE_URL="postgresql://postgres:password@host:5432/dbname"');
    console.log('\n📖 For local PostgreSQL:');
    console.log('   macOS: brew install postgresql@14');
    console.log('   Ubuntu/Debian: sudo apt-get install postgresql postgresql-contrib');
    console.log('   Windows: Download from https://www.postgresql.org/download/windows/');
    console.log('\n   After installation, create database:');
    console.log('      createdb stockdb');
    process.exit(1);
  }
});