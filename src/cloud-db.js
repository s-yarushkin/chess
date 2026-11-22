import pg from 'pg';
const {Pool}=pg;
let pool,ready;
export function getPool(){
  if(!process.env.DATABASE_URL)throw Error('DATABASE_URL not configured');
  if(!pool)pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});
  return pool;
}
export async function initDb(){
  if(ready)return ready;
  // Concurrent cold starts use IF NOT EXISTS. Failed initialization can retry.
  ready=(async()=>{
    const db=getPool();
    await db.query(`CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY, telegram_id TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL DEFAULT '',
      friends_opt_in BOOLEAN NOT NULL DEFAULT FALSE, leaderboard_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
      points INTEGER NOT NULL DEFAULT 0 CHECK(points>=0),solved_count INTEGER NOT NULL DEFAULT 0 CHECK(solved_count>=0),
      skill_rating INTEGER NOT NULL DEFAULT 800, clean_streak INTEGER NOT NULL DEFAULT 0, best_streak INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL)`);
    await db.query(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL)`);
    await db.query(`CREATE TABLE IF NOT EXISTS attempts (
      id UUID PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      puzzle_id TEXT NOT NULL,current_fen TEXT NOT NULL,cursor INTEGER NOT NULL DEFAULT 0,
      hints INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'active',
      started_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)`);
    await db.query(`CREATE TABLE IF NOT EXISTS completions (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,puzzle_id TEXT NOT NULL,
      category TEXT NOT NULL,points INTEGER NOT NULL,solved_at BIGINT NOT NULL,
      PRIMARY KEY (user_id,puzzle_id))`);
    await db.query(`CREATE TABLE IF NOT EXISTS friend_invites (
      id UUID PRIMARY KEY, owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL UNIQUE, created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL, used_at BIGINT)`);
    await db.query(`CREATE TABLE IF NOT EXISTS friend_requests (
      id UUID PRIMARY KEY, requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),
      created_at BIGINT NOT NULL, responded_at BIGINT,
      CHECK(requester_id<>recipient_id))`);
    await db.query(`CREATE TABLE IF NOT EXISTS friendships (
      user_a UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL, PRIMARY KEY(user_a,user_b),
      CHECK(user_a<>user_b))`);
    await db.query('CREATE INDEX IF NOT EXISTS idx_friend_invites_owner ON friend_invites(owner_id,created_at DESC)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_friend_requests_recipient ON friend_requests(recipient_id,status,created_at DESC)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_friend_requests_sender ON friend_requests(requester_id,status,created_at DESC)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_friendships_reverse ON friendships(user_b)');
    await db.query("CREATE TABLE IF NOT EXISTS leagues ("+
      "id UUID PRIMARY KEY,name TEXT NOT NULL,owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,"+
      "created_at BIGINT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE)");
    await db.query("CREATE TABLE IF NOT EXISTS league_members ("+
      "league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,"+
      "user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,"+
      "role TEXT NOT NULL CHECK(role IN ('owner','member')),joined_at BIGINT NOT NULL,"+
      "PRIMARY KEY(league_id,user_id))");
    await db.query("CREATE TABLE IF NOT EXISTS league_invites ("+
      "id UUID PRIMARY KEY,league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,"+
      "code_hash TEXT NOT NULL UNIQUE,created_at BIGINT NOT NULL,expires_at BIGINT NOT NULL,"+
      "uses INTEGER NOT NULL DEFAULT 0,max_uses INTEGER NOT NULL DEFAULT 20)");
    await db.query("CREATE TABLE IF NOT EXISTS league_requests ("+
      "id UUID PRIMARY KEY,league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,"+
      "user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,"+
      "status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),"+
      "created_at BIGINT NOT NULL,decided_at BIGINT,UNIQUE(league_id,user_id))");
    await db.query('CREATE INDEX IF NOT EXISTS idx_league_members_user ON league_members(user_id)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_league_invites_recent ON league_invites(league_id,created_at DESC)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_league_requests_pending ON league_requests(league_id,status,created_at)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_attempts_active ON attempts(user_id,status,started_at)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_completions_recent_pg ON completions(user_id,solved_at DESC)');
    return db;
  })().catch(err=>{ready=null;throw err;});
  return ready;
}
export async function tx(work){const client=await getPool().connect();try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
