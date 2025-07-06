-- Create leagues table
CREATE TABLE leagues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    invite_only BOOLEAN DEFAULT false,
    draft_start_date TIMESTAMP WITH TIME ZONE,
    draft_end_date TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'setup' CHECK (status IN ('setup', 'drafting', 'active', 'completed')),
    max_participants INTEGER DEFAULT 8,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for leagues table
CREATE TRIGGER update_leagues_updated_at 
    BEFORE UPDATE ON leagues
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Note: For now, users can only view leagues they own
-- This will be updated when league_participants table is created
CREATE POLICY "Users can view leagues they own" ON leagues
    FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY "Users can create leagues" ON leagues
    FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "League owners can update their leagues" ON leagues
    FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "League owners can delete their leagues" ON leagues
    FOR DELETE USING (owner_id = auth.uid());

-- Create indexes for better performance
CREATE INDEX idx_leagues_owner_id ON leagues(owner_id);
CREATE INDEX idx_leagues_status ON leagues(status);
CREATE INDEX idx_leagues_created_at ON leagues(created_at);