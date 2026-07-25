// Crea (o actualiza la contraseña de) un usuario del equipo. Sin auto-registro público: esto
// es lo único que da de alta cuentas.
// Uso: pnpm --filter @trademe/api exec tsx scripts/create-user.ts correo@equipo.com 'una-clave-fuerte'
import { createPool } from '../src/db/pool.js';
import { UsersRepo } from '../src/db/users-repo.js';
import { hashPassword } from '../src/auth/password.js';

async function main(): Promise<void> {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Uso: tsx scripts/create-user.ts <email> <password>");
    process.exit(1);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Falta DATABASE_URL en el entorno.');
    process.exit(1);
  }
  const pool = createPool(databaseUrl);
  const repo = new UsersRepo(pool);
  const existing = await repo.findByEmail(email);
  const hash = hashPassword(password);
  if (existing) {
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, existing.id]);
    console.log(`Contraseña actualizada para ${email}.`);
  } else {
    const user = await repo.create(email, hash);
    console.log(`Usuario creado: ${user.email} (${user.id}).`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
