create table if not exists secretary_vault (
  user_id text primary key,
  cipher text not null,
  version bigint not null default 1,
  webhook_hash text,
  updated_at timestamptz not null default now()
);

create unique index if not exists secretary_vault_webhook_hash_idx
  on secretary_vault (webhook_hash);
