-- Run this in Supabase SQL Editor to create the booking_requests table

CREATE TABLE IF NOT EXISTS booking_requests (
  id TEXT PRIMARY KEY,
  restaurant TEXT NOT NULL,
  venue_slug TEXT,
  venue_id INTEGER,
  drop_days INTEGER,
  drop_hour INTEGER,
  target_dates TEXT[], -- array of date strings
  party_size INTEGER DEFAULT 2,
  time_pref TEXT DEFAULT 'any',
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  resy_email TEXT,
  resy_token TEXT,
  resy_payment_id INTEGER,
  status TEXT DEFAULT 'pending', -- pending, sniping, booked, failed
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allow anon to insert (from booking page) and select (from admin)
ALTER TABLE booking_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow insert for all" ON booking_requests
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow select for all" ON booking_requests
  FOR SELECT TO anon USING (true);

CREATE POLICY "Allow update for all" ON booking_requests
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
