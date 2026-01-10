-- Migration: Create remaining tables for Fantasy Reels
-- Tables: profiles, league_participants, teams, movies, draft_picks, reviews, team_scores, invitations

-- ============================================================================
-- PROFILES TABLE
-- Extends auth.users with additional user profile data
-- ============================================================================
CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name VARCHAR(100),
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_profiles_user_id ON profiles(user_id);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view any profile" ON profiles
    FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile" ON profiles
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own profile" ON profiles
    FOR UPDATE USING (user_id = auth.uid());

-- Function to auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile when user signs up
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_user();

-- ============================================================================
-- LEAGUE PARTICIPANTS TABLE
-- Tracks users who have joined a league
-- ============================================================================
CREATE TABLE league_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('pending', 'active', 'left', 'kicked')),
    draft_order INTEGER,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(league_id, user_id)
);

CREATE TRIGGER update_league_participants_updated_at
    BEFORE UPDATE ON league_participants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_league_participants_league_id ON league_participants(league_id);
CREATE INDEX idx_league_participants_user_id ON league_participants(user_id);
CREATE INDEX idx_league_participants_status ON league_participants(status);

ALTER TABLE league_participants ENABLE ROW LEVEL SECURITY;

-- Participants can view other participants in their leagues
CREATE POLICY "Users can view participants in their leagues" ON league_participants
    FOR SELECT USING (
        league_id IN (
            SELECT league_id FROM league_participants WHERE user_id = auth.uid()
        )
    );

-- League owners can manage participants
CREATE POLICY "League owners can insert participants" ON league_participants
    FOR INSERT WITH CHECK (
        league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid())
        OR user_id = auth.uid()  -- Users can join open leagues
    );

CREATE POLICY "League owners can update participants" ON league_participants
    FOR UPDATE USING (
        league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid())
    );

CREATE POLICY "League owners can remove participants" ON league_participants
    FOR DELETE USING (
        league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid())
        OR user_id = auth.uid()  -- Users can leave leagues
    );

-- ============================================================================
-- TEAMS TABLE
-- Each participant has one team (Production Company) per league
-- ============================================================================
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID NOT NULL UNIQUE REFERENCES league_participants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TRIGGER update_teams_updated_at
    BEFORE UPDATE ON teams
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_teams_participant_id ON teams(participant_id);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

-- Anyone in the league can view teams
CREATE POLICY "Users can view teams in their leagues" ON teams
    FOR SELECT USING (
        participant_id IN (
            SELECT lp.id FROM league_participants lp
            WHERE lp.league_id IN (
                SELECT league_id FROM league_participants WHERE user_id = auth.uid()
            )
        )
    );

-- Users can create their own team
CREATE POLICY "Users can create their own team" ON teams
    FOR INSERT WITH CHECK (
        participant_id IN (
            SELECT id FROM league_participants WHERE user_id = auth.uid()
        )
    );

-- Users can update their own team
CREATE POLICY "Users can update their own team" ON teams
    FOR UPDATE USING (
        participant_id IN (
            SELECT id FROM league_participants WHERE user_id = auth.uid()
        )
    );

-- ============================================================================
-- MOVIES TABLE
-- Movies available for drafting, synced from TMDb
-- ============================================================================
CREATE TABLE movies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tmdb_id INTEGER NOT NULL UNIQUE,
    imdb_id VARCHAR(20),
    title VARCHAR(500) NOT NULL,
    overview TEXT,
    release_date DATE,
    poster_url TEXT,
    backdrop_url TEXT,
    popularity DECIMAL(10, 3),
    vote_average DECIMAL(3, 1),
    vote_count INTEGER,
    status VARCHAR(50) DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'released', 'canceled')),
    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TRIGGER update_movies_updated_at
    BEFORE UPDATE ON movies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_movies_tmdb_id ON movies(tmdb_id);
CREATE INDEX idx_movies_imdb_id ON movies(imdb_id);
CREATE INDEX idx_movies_release_date ON movies(release_date);
CREATE INDEX idx_movies_status ON movies(status);

ALTER TABLE movies ENABLE ROW LEVEL SECURITY;

-- Movies are public read
CREATE POLICY "Anyone can view movies" ON movies
    FOR SELECT USING (true);

-- Only service role can insert/update movies (via Edge Functions)
CREATE POLICY "Service role can manage movies" ON movies
    FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- DRAFT PICKS TABLE
-- Records each pick made during the draft
-- ============================================================================
CREATE TABLE draft_picks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    round INTEGER NOT NULL,
    pick_number INTEGER NOT NULL,
    picked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(league_id, movie_id),  -- Each movie can only be picked once per league
    UNIQUE(league_id, round, pick_number)  -- Each pick slot is unique
);

CREATE INDEX idx_draft_picks_league_id ON draft_picks(league_id);
CREATE INDEX idx_draft_picks_team_id ON draft_picks(team_id);
CREATE INDEX idx_draft_picks_movie_id ON draft_picks(movie_id);

ALTER TABLE draft_picks ENABLE ROW LEVEL SECURITY;

-- Anyone in the league can view draft picks
CREATE POLICY "Users can view draft picks in their leagues" ON draft_picks
    FOR SELECT USING (
        league_id IN (
            SELECT league_id FROM league_participants WHERE user_id = auth.uid()
        )
    );

-- Draft picks are created via Edge Function (service role)
-- This ensures atomic transactions and proper validation
CREATE POLICY "Service role can manage draft picks" ON draft_picks
    FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- REVIEWS TABLE
-- Stores review scores from various sources (IMDb, RT, Metacritic)
-- ============================================================================
CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    source VARCHAR(50) NOT NULL CHECK (source IN ('imdb', 'rotten_tomatoes', 'metacritic')),
    score DECIMAL(5, 2),  -- Normalized to 0-100 scale
    raw_score VARCHAR(20),  -- Original format (e.g., "8.5/10", "85%")
    review_count INTEGER,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(movie_id, source)
);

CREATE TRIGGER update_reviews_updated_at
    BEFORE UPDATE ON reviews
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_reviews_movie_id ON reviews(movie_id);
CREATE INDEX idx_reviews_source ON reviews(source);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Reviews are public read
CREATE POLICY "Anyone can view reviews" ON reviews
    FOR SELECT USING (true);

-- Only service role can manage reviews (via Edge Functions)
CREATE POLICY "Service role can manage reviews" ON reviews
    FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- TEAM SCORES TABLE
-- Aggregated scores for each team
-- ============================================================================
CREATE TABLE team_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
    total_points DECIMAL(10, 2) DEFAULT 0,
    movies_scored INTEGER DEFAULT 0,
    movies_pending INTEGER DEFAULT 0,
    average_score DECIMAL(5, 2) DEFAULT 0,
    last_calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TRIGGER update_team_scores_updated_at
    BEFORE UPDATE ON team_scores
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_team_scores_team_id ON team_scores(team_id);
CREATE INDEX idx_team_scores_total_points ON team_scores(total_points DESC);

ALTER TABLE team_scores ENABLE ROW LEVEL SECURITY;

-- Anyone in the league can view team scores
CREATE POLICY "Users can view team scores in their leagues" ON team_scores
    FOR SELECT USING (
        team_id IN (
            SELECT t.id FROM teams t
            JOIN league_participants lp ON t.participant_id = lp.id
            WHERE lp.league_id IN (
                SELECT league_id FROM league_participants WHERE user_id = auth.uid()
            )
        )
    );

-- Only service role can manage team scores (via Edge Functions)
CREATE POLICY "Service role can manage team scores" ON team_scores
    FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- INVITATIONS TABLE
-- Tracks invitations sent to join leagues
-- ============================================================================
CREATE TABLE invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days'),
    responded_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(league_id, email)  -- One invite per email per league
);

CREATE TRIGGER update_invitations_updated_at
    BEFORE UPDATE ON invitations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_invitations_league_id ON invitations(league_id);
CREATE INDEX idx_invitations_email ON invitations(email);
CREATE INDEX idx_invitations_token ON invitations(token);
CREATE INDEX idx_invitations_status ON invitations(status);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- Users can view invitations for leagues they own or invitations sent to them
CREATE POLICY "Users can view relevant invitations" ON invitations
    FOR SELECT USING (
        league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid())
        OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
    );

-- League owners/admins can create invitations
CREATE POLICY "League owners can create invitations" ON invitations
    FOR INSERT WITH CHECK (
        league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid())
        AND invited_by = auth.uid()
    );

-- League owners can update invitations (e.g., resend)
CREATE POLICY "League owners can update invitations" ON invitations
    FOR UPDATE USING (
        league_id IN (SELECT id FROM leagues WHERE owner_id = auth.uid())
    );

-- Invitees can update their own invitation (accept/decline)
CREATE POLICY "Invitees can respond to invitations" ON invitations
    FOR UPDATE USING (
        email = (SELECT email FROM auth.users WHERE id = auth.uid())
    );

-- ============================================================================
-- UPDATE LEAGUES RLS POLICIES
-- Allow participants to view leagues they've joined
-- ============================================================================
DROP POLICY IF EXISTS "Users can view leagues they own" ON leagues;

CREATE POLICY "Users can view leagues they participate in" ON leagues
    FOR SELECT USING (
        owner_id = auth.uid()
        OR id IN (
            SELECT league_id FROM league_participants
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to calculate team score from draft picks
CREATE OR REPLACE FUNCTION calculate_team_score(p_team_id UUID)
RETURNS TABLE(
    total_points DECIMAL,
    movies_scored INTEGER,
    movies_pending INTEGER,
    average_score DECIMAL
) AS $$
DECLARE
    v_total DECIMAL := 0;
    v_scored INTEGER := 0;
    v_pending INTEGER := 0;
BEGIN
    SELECT
        COALESCE(SUM(
            CASE WHEN r.id IS NOT NULL THEN
                (SELECT AVG(score) FROM reviews WHERE movie_id = m.id)
            ELSE 0 END
        ), 0),
        COUNT(CASE WHEN EXISTS (SELECT 1 FROM reviews WHERE movie_id = m.id) THEN 1 END),
        COUNT(CASE WHEN NOT EXISTS (SELECT 1 FROM reviews WHERE movie_id = m.id) THEN 1 END)
    INTO v_total, v_scored, v_pending
    FROM draft_picks dp
    JOIN movies m ON dp.movie_id = m.id
    LEFT JOIN reviews r ON m.id = r.movie_id
    WHERE dp.team_id = p_team_id
    GROUP BY dp.team_id;

    RETURN QUERY SELECT
        v_total,
        v_scored,
        v_pending,
        CASE WHEN v_scored > 0 THEN v_total / v_scored ELSE 0 END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get next pick in draft
CREATE OR REPLACE FUNCTION get_next_draft_pick(p_league_id UUID)
RETURNS TABLE(
    round INTEGER,
    pick_number INTEGER,
    team_id UUID,
    participant_id UUID,
    user_id UUID
) AS $$
DECLARE
    v_total_participants INTEGER;
    v_total_rounds INTEGER;
    v_picks_made INTEGER;
    v_next_round INTEGER;
    v_next_pick INTEGER;
    v_draft_order INTEGER;
BEGIN
    -- Get league configuration
    SELECT COUNT(*) INTO v_total_participants
    FROM league_participants
    WHERE league_id = p_league_id AND status = 'active';

    -- Default to 5 rounds (could be configurable)
    v_total_rounds := 5;

    -- Count picks made
    SELECT COUNT(*) INTO v_picks_made
    FROM draft_picks
    WHERE league_id = p_league_id;

    -- Calculate next pick position
    v_next_round := (v_picks_made / v_total_participants) + 1;
    v_next_pick := (v_picks_made % v_total_participants) + 1;

    -- Snake draft: reverse order on odd rounds after first
    IF v_next_round % 2 = 0 THEN
        v_draft_order := v_total_participants - v_next_pick + 1;
    ELSE
        v_draft_order := v_next_pick;
    END IF;

    -- Return the team that should pick next
    RETURN QUERY
    SELECT
        v_next_round,
        v_next_pick,
        t.id,
        lp.id,
        lp.user_id
    FROM league_participants lp
    JOIN teams t ON t.participant_id = lp.id
    WHERE lp.league_id = p_league_id
      AND lp.status = 'active'
      AND lp.draft_order = v_draft_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
