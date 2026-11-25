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
    await db.query(`CREATE TABLE IF NOT EXISTS linked_telegram_identities (
      telegram_id TEXT PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      linked_at BIGINT NOT NULL)`);
    await db.query(`CREATE TABLE IF NOT EXISTS admin_merge_requests (
      id UUID PRIMARY KEY,source_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      code_hash TEXT NOT NULL UNIQUE,created_at BIGINT NOT NULL,expires_at BIGINT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','cancelled','used')),
      used_at BIGINT)`);
    await db.query(`CREATE TABLE IF NOT EXISTS admin_account_merges (
      source_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
      target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      source_telegram_id TEXT NOT NULL UNIQUE,target_telegram_id TEXT NOT NULL,
      merged_at BIGINT NOT NULL,summary JSONB NOT NULL)`);
    await db.query('CREATE INDEX IF NOT EXISTS idx_admin_merge_requests_source ON admin_merge_requests(source_user_id,created_at DESC)');
    // Nullable keys preserve existing duplicate accounts until nickname is changed.
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname_key TEXT');
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS directory_visible BOOLEAN NOT NULL DEFAULT FALSE');
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS users_unique_nickname ON users(nickname_key) WHERE nickname_key IS NOT NULL');
    await db.query(`WITH eligible AS (
      SELECT u.id,lower(btrim(u.display_name)) AS nick,
        ROW_NUMBER() OVER(PARTITION BY lower(btrim(u.display_name)) ORDER BY u.created_at,u.id) AS rn
      FROM users u
      WHERE u.nickname_key IS NULL AND btrim(u.display_name) ~ '^[A-Za-zА-Яа-яЁё0-9_-]{2,24}$'
        AND NOT EXISTS(SELECT 1 FROM admin_account_merges m WHERE m.source_user_id=u.id)
    ) UPDATE users u SET nickname_key=e.nick FROM eligible e
    WHERE e.id=u.id AND e.rn=1
      AND NOT EXISTS(SELECT 1 FROM users taken WHERE taken.nickname_key=e.nick)`);
    await db.query('CREATE INDEX IF NOT EXISTS idx_users_directory ON users(directory_visible,nickname_key) WHERE directory_visible=TRUE');
    await db.query(`CREATE TABLE IF NOT EXISTS league_direct_invitations (
      id UUID PRIMARY KEY,league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined')),
      created_at BIGINT NOT NULL,responded_at BIGINT,
      UNIQUE(league_id,user_id))`);
    await db.query('CREATE INDEX IF NOT EXISTS idx_league_direct_inbox ON league_direct_invitations(user_id,status,created_at DESC)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_attempts_active ON attempts(user_id,status,started_at)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_completions_recent_pg ON completions(user_id,solved_at DESC)');
    return db;
  })().catch(err=>{ready=null;throw err;});
  return ready;
}
export async function tx(work){const client=await getPool().connect();try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
