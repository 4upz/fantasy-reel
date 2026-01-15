-- Migration: Add OAuth profile support
-- Updates the handle_new_user function to support OAuth providers (Discord, etc.)
-- OAuth providers include different metadata fields than email signup

-- ============================================================================
-- UPDATE PROFILE CREATION TRIGGER FOR OAUTH SUPPORT
-- ============================================================================

-- Drop the existing trigger first
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Update the function to handle OAuth metadata
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_display_name TEXT;
    v_avatar_url TEXT;
BEGIN
    -- Extract display name from various possible sources
    -- Priority: display_name (email signup) > global_name (Discord) > full_name > name > email
    v_display_name := COALESCE(
        NEW.raw_user_meta_data->>'display_name',      -- Email signup
        NEW.raw_user_meta_data->>'global_name',       -- Discord global display name
        NEW.raw_user_meta_data->>'full_name',         -- OAuth full name
        NEW.raw_user_meta_data->>'name',              -- OAuth name
        NEW.raw_user_meta_data->>'preferred_username', -- Some OAuth providers
        split_part(NEW.email, '@', 1)                 -- Fallback to email prefix
    );

    -- Extract avatar URL from OAuth metadata (null for email signup)
    v_avatar_url := NEW.raw_user_meta_data->>'avatar_url';

    -- Insert the profile
    INSERT INTO public.profiles (user_id, display_name, avatar_url)
    VALUES (NEW.id, v_display_name, v_avatar_url);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_user();

-- ============================================================================
-- ADD FUNCTION TO UPDATE PROFILE FROM OAUTH DATA
-- Can be called to sync OAuth avatar/display name on subsequent logins
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_oauth_profile()
RETURNS TRIGGER AS $$
DECLARE
    v_avatar_url TEXT;
BEGIN
    -- Only sync if this is an OAuth update (avatar_url present in metadata)
    v_avatar_url := NEW.raw_user_meta_data->>'avatar_url';

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

-- Trigger to sync OAuth profile on user update (e.g., when user logs in again)
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
    AFTER UPDATE ON auth.users
    FOR EACH ROW
    WHEN (OLD.raw_user_meta_data IS DISTINCT FROM NEW.raw_user_meta_data)
    EXECUTE FUNCTION sync_oauth_profile();
