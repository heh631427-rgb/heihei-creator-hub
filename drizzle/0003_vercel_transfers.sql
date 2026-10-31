CREATE TABLE transfer_jobs (
 id TEXT PRIMARY KEY NOT NULL,
 owner TEXT NOT NULL,
 owner_role TEXT NOT NULL,
 direction TEXT NOT NULL,
 chunk_count INTEGER NOT NULL,
 byte_length INTEGER NOT NULL,
 expected_revision INTEGER,
 reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open',
 result TEXT,
 expires_at INTEGER NOT NULL
);
CREATE INDEX transfer_jobs_expiry ON transfer_jobs(expires_at);
CREATE TABLE transfer_chunks (
 transfer_id TEXT NOT NULL,
 chunk_index INTEGER NOT NULL,
 content TEXT NOT NULL,
 PRIMARY KEY(transfer_id, chunk_index)
);
