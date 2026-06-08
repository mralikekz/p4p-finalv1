-- SQL Schema for P4P Persistent Database (Supabase PostgreSQL)
-- 
-- COPY AND PASTE THIS ENTIRE SCRIPT INTO YOUR SUPABASE SQL EDITOR (shown in your screenshot)
-- AND CLICK THE GREEN "RUN" BUTTON IN THE BOTTOM RIGHT.

-- 1. Pioneers Table (users authenticated via Pi SDK)
CREATE TABLE IF NOT EXISTS pioneers (
    username VARCHAR(100) PRIMARY KEY,
    wallet_address VARCHAR(255) DEFAULT 'Simulated Wallet Address',
    uid VARCHAR(100) DEFAULT '',
    registered_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS) or public policies as needed
ALTER TABLE pioneers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable read/write access for all users" ON pioneers;
CREATE POLICY "Enable read/write access for all users" ON pioneers
    FOR ALL USING (true) WITH CHECK (true);

-- 2. Votes Table (MMA Fighters and their current voter scores)
CREATE TABLE IF NOT EXISTS votes (
    fighter_key VARCHAR(100) PRIMARY KEY,
    fighter_name VARCHAR(100) NOT NULL,
    division VARCHAR(100) DEFAULT 'Unknown Class',
    points INTEGER DEFAULT 0,
    pi_amount NUMERIC(10, 2) DEFAULT 0.00
);

-- Enable RLS or public policies for votes
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable public access to votes" ON votes;
CREATE POLICY "Enable public access to votes" ON votes
    FOR ALL USING (true) WITH CHECK (true);

-- Populate with some initial MMA fighter rankings if the table is empty
INSERT INTO votes (fighter_key, fighter_name, division, points, pi_amount)
VALUES 
  ('islam_makhachev', 'Islam Makhachev', 'Lightweight', 1500, 15),
  ('jon_jones', 'Jon Jones', 'Heavyweight', 1400, 14),
  ('alex_pereira', 'Alex Pereira', 'Light Heavyweight', 1800, 18),
  ('ilona_mendes', 'Ilona Mendes', 'Bantamweight', 300, 3),
  ('leon_edwards', 'Leon Edwards', 'Welterweight', 800, 8),
  ('alexander_volkanovski', 'Alexander Volkanovski', 'Featherweight', 1100, 11),
  ('sean_omalley', 'Sean O''Malley', 'Bantamweight', 950, 9.5)
ON CONFLICT (fighter_key) DO NOTHING;

-- 3. Payouts Table (outgoing App-to-User payouts tracking for checklists)
CREATE TABLE IF NOT EXISTS payouts (
    payment_id VARCHAR(100) PRIMARY KEY,
    txid VARCHAR(255) NOT NULL,
    recipient_uid VARCHAR(100) NOT NULL,
    amount NUMERIC(10, 4) DEFAULT 0.0000,
    memo VARCHAR(255) DEFAULT 'Developer test payout',
    status VARCHAR(50) DEFAULT 'completed',
    completed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS for payouts
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable read/write access to payouts" ON payouts;
CREATE POLICY "Enable read/write access to payouts" ON payouts
    FOR ALL USING (true) WITH CHECK (true);

