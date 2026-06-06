-- تشغيل هذا في Supabase SQL Editor

CREATE TABLE IF NOT EXISTS templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  drive_folder_id TEXT DEFAULT '',
  drive_file_id TEXT NOT NULL,
  fields JSONB NOT NULL DEFAULT '[]',
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS filled_documents (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL,
  user_id BIGINT NOT NULL,
  filled_data JSONB NOT NULL DEFAULT '{}',
  drive_file_id TEXT DEFAULT '',
  drive_link TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fill_sessions (
  user_id BIGINT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'idle',
  template_id INTEGER,
  collected_data JSONB DEFAULT '{}',
  current_field_index INTEGER DEFAULT 0,
  admin_state TEXT DEFAULT '',
  temp_template_name TEXT DEFAULT '',
  temp_template_fields JSONB DEFAULT '[]',
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);
