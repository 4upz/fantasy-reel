-- Migration: Add Google OAuth support
-- Updates handle_new_user() and sync_oauth_profile() to handle Google's 'picture' field
-- Google uses 'picture' instead of 'avatar_url' for avatar URLs

-- ============================================================================
-- UPDATE PROFILE CREATION TRIGGER FOR GOOGLE OAUTH SUPPORT
-- ============================================================================

-- Update the function to handle Google's 'picture' field
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_display_name TEXT;
    v_avatar_url TEXT;
BEGIN
    -- Extract display name from various possible sources
    -- Priority: display_name (email signup) > global_name (Discord) > full_name (Google) > name > email
    v_display_name := COALESCE(
        NEW.raw_user_meta_data->>'display_name',      -- Email signup
        NEW.raw_user_meta_data->>'global_name',       -- Discord global display name
        NEW.raw_user_meta_data->>'full_name',         -- Google / OAuth full name
        NEW.raw_user_meta_data->>'name',              -- OAuth name
        NEW.raw_user_meta_data->>'preferred_username', -- Some OAuth providers
        split_part(NEW.email, '@', 1)                 -- Fallback to email prefix
    );

    -- Extract avatar URL from OAuth metadata
    -- Discord/GitHub use 'avatar_url', Google uses 'picture'
    v_avatar_url := COALESCE(
        NEW.raw_user_meta_data->>'avatar_url',  -- Discord, GitHub
        NEW.raw_user_meta_data->>'picture'       -- Google
    );

    -- Insert the profile
    INSERT INTO public.profiles (user_id, display_name, avatar_url)
    VALUES (NEW.id, v_display_name, v_avatar_url);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- UPDATE SYNC FUNCTION FOR GOOGLE OAUTH SUPPORT
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_oauth_profile()
RETURNS TRIGGER AS $$
DECLARE
    v_avatar_url TEXT;
BEGIN
    -- Extract avatar URL from OAuth metadata
    -- Discord/GitHub use 'avatar_url', Google uses 'picture'
    v_avatar_url := COALESCE(
        NEW.raw_user_meta_data->>'avatar_url',  -- Discord, GitHub
        NEW.raw_user_meta_data->>'picture'       -- Google
    );

    IF v_avatar_url IS NOT NULL THEN
        UPDATE public.profiles
        SET avatar_url = v_avatar_url,
            updated_at = NOW()
        WHERE user_id = NEW.id
          AND (avatar_url IS NULL OR avatar_url != v_avatar_url);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
